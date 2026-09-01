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
