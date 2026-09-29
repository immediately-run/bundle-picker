// Bounded marker-reveal navigation — OPEN_BUNDLE_SPEC §3 (R3-499).
//
// The picker NEVER scans filesystems: one navigation step lists a directory's
// immediate children (probe cap / render cap), reveals each child DIRECTORY's
// `immediately.run.json` marker (label from `kind`, never a task name), and stops.
// Numeric bounds are the spec's ("a bound with no number is not a bound"):
// ≤ MAX_PROBE children probed, ≤ MAX_RENDER rendered, depth ≤ MAX_DEPTH.
// A breach degrades (truncate + "showing first N") and surfaces — never silent.

import type { DirEntry, MountFs } from '@immediately-run/sdk';

/** Spec §3: probe ≤ 256 children per step. */
export const MAX_PROBE = 256;
/** Spec §3: render ≤ 100 entries per step. */
export const MAX_RENDER = 100;
/** Spec §3: navigation depth ≤ 16. */
export const MAX_DEPTH = 16;
/** The content marker file (contentMarker.ts's name, mirrored app-side). */
export const MARKER_FILE = 'immediately.run.json';

export interface RevealedEntry {
  name: string;
  isDir: boolean;
  /** The marker's `kind` when the child directory carries one — the LABEL source. */
  kind?: string;
}

export interface StepResult {
  entries: RevealedEntry[];
  /** Degradation notes the UI must surface (spec: a breach is never silent). */
  truncated: boolean;
  /** How many children were actually probed (≤ MAX_PROBE). */
  probed: number;
}

/** Parse a marker's JSON, defensively — a hostile tree full of garbage still navigates. */
export const parseMarkerKind = (text: string): string | undefined => {
  try {
    const parsed = JSON.parse(text) as { kind?: unknown };
    return typeof parsed.kind === 'string' && parsed.kind.length > 0 ? parsed.kind : undefined;
  } catch {
    return undefined;
  }
};

const join = (a: string, b: string): string => (a === '' ? b : `${a}/${b}`);

/**
 * One navigation step: list `path`'s immediate children, probe child DIRECTORIES
 * for markers (≤ MAX_PROBE), cap rendering (≤ MAX_RENDER). Depth is the CALLER's
 * breadcrumb depth; `navigate` refuses beyond MAX_DEPTH (the UI renders no deeper).
 */
export async function navigationStep(fs: MountFs, path: string, depth: number): Promise<StepResult> {
  if (depth > MAX_DEPTH) {
    throw Object.assign(new Error(`navigation depth cap reached (${MAX_DEPTH})`), { code: 'depth-exceeded' });
  }
  const all = await fs.readdir(path || undefined);
  // Directories first (the navigable half), then files — alphabetical within each.
  const dirs = all.filter((e: DirEntry) => isDirEntry(e)).sort((a, b) => a.name.localeCompare(b.name));
  const files = all.filter((e: DirEntry) => !isDirEntry(e)).sort((a, b) => a.name.localeCompare(b.name));
  const ordered = [...dirs, ...files];

  const probed = ordered.slice(0, MAX_PROBE);
  const entries: RevealedEntry[] = [];
  for (const e of probed) {
    let kind: string | undefined;
    if (isDirEntry(e)) {
      try {
        const text = await fs.readFile(join(path, e.name) + '/' + MARKER_FILE, 'utf8');
        kind = parseMarkerKind(text);
      } catch {
        kind = undefined; // no marker — an ordinary directory
      }
    }
    entries.push({ name: e.name, isDir: isDirEntry(e), ...(kind !== undefined ? { kind } : {}) });
  }
  const truncated = ordered.length > MAX_PROBE || entries.length > MAX_RENDER;
  return { entries: entries.slice(0, MAX_RENDER), truncated, probed: probed.length };
}

const isDirEntry = (e: DirEntry): boolean => e.kind === 'dir';

/** A directory is PICKABLE for this invocation iff its marker kind ∈ kinds. */
export const pickable = (entry: RevealedEntry, kinds: readonly string[]): boolean =>
  entry.isDir && entry.kind !== undefined && kinds.includes(entry.kind);

/** `themes/nord` from ['themes','nord'] — the breadcrumb → BundleLocation path. */
export const pathFromSegments = (segs: readonly string[]): string => segs.filter((s) => s.length > 0).join('/');

// ── The spaces leg (R3-499's remainder — OPEN_BUNDLE_SPEC §4) ────────────────
//
// The host-drawn spaces strip grants this instance a scoped `ro` navigation
// root per picked space, announced mid-task as an ordinary mount-add. The app
// learns of it through `useMounts()`: a strip grant is recognizably a
// firestore mount carrying its spaceId as `id` (the pasted repo arrives typed
// `github` via the runtime verb, and the app holds no other space grants —
// anything matching IS a strip grant).

import type { SandboxMount } from '@immediately-run/sdk';

/** The mounts the host's spaces strip has granted this invocation. The
 *  invariant that makes the filter sound: this app requests NO space mounts of
 *  its own (it never calls mountSpace/requestSpace), and the pasted repo
 *  arrives typed 'github' (the runtime verb), so a firestore mount carrying a
 *  spaceId IS the strip's grant — nothing else can produce one here. */
export const spaceRootsOf = (mounts: readonly SandboxMount[]): SandboxMount[] =>
  mounts.filter((m) => m.type === 'firestore' && typeof m.id === 'string' && m.id.length > 0);

/** What the user is navigating: the pasted repo, or a strip-granted space. */
export type PickerSource = { kind: 'repo'; locator: string } | { kind: 'space'; spaceId: string };

/** Split `github:ns/repo[@ref]` into the location's `repo` + optional `ref`
 *  (the ref rides along — navigating a pinned ref but returning the default
 *  branch would misdescribe the pick, G-OB-7).
 *
 *  The split mirrors the host's `parseGithubLocator` (site-main mountUri.ts)
 *  EXACTLY — the FIRST '@': a legal ref may itself contain '@' (`v1@beta`),
 *  and only the first split names the ref the host actually mounted. A
 *  last-'@' split would return a location naming coordinates the user never
 *  navigated, and the G-OB-7 re-probe would check those. */
export const parseRepoLocator = (locator: string): { repo: string; ref?: string } => {
  const at = locator.indexOf('@');
  if (at === -1) return { repo: locator };
  return { repo: locator.slice(0, at), ref: locator.slice(at + 1) };
};

/** The `BundleLocation` for a pick under `source` at `bundlePath` ('' = root). */
export const locationForPick = (source: PickerSource, bundlePath: string) =>
  source.kind === 'repo'
    ? { kind: 'repo' as const, ...parseRepoLocator(source.locator), path: bundlePath }
    : { kind: 'space' as const, spaceId: source.spaceId, path: bundlePath };
