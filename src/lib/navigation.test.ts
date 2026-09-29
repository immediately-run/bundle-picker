// G-OB-2 — navigation never scans, depth AND width bounded (OPEN_BUNDLE_SPEC §3).
// A 10^4-child directory probes ≤ MAX_PROBE; a deep tree stops at MAX_DEPTH;
// labels come from `kind`, never task names; pickability = kind ∈ kinds.
import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, MAX_PROBE, MARKER_FILE, navigationStep, parseMarkerKind, pathFromSegments, pickable } from './navigation';
import type { MountFs } from '@immediately-run/sdk';

const mkFs = (tree: Record<string, 'dir' | 'file'>, markers: Record<string, string> = {}) =>
  ({
    readdir: async (rel = '') => {
      const prefix = rel === '' ? '' : rel.replace(/\/$/, '') + '/';
      const names = new Set<string>();
      for (const p of Object.keys(tree)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (rest === '') continue;
        names.add(rest.split('/')[0]);
      }
      return [...names].map((name) => ({ name, kind: tree[prefix + name] === 'dir' ? ('dir' as const) : ('file' as const) }));
    },
    readFile: async (p: string) => {
      const m = markers[p];
      if (m === undefined) throw new Error('not found');
      return m;
    },
  }) as unknown as MountFs;

describe('navigationStep bounds (G-OB-2)', () => {
  it('probes at most MAX_PROBE children of a wide directory, and says so', async () => {
    const tree: Record<string, 'dir' | 'file'> = {};
    for (let i = 0; i < 10_000; i++) tree[`d${i}`] = 'dir';
    const res = await navigationStep(mkFs(tree), '', 0);
    expect(res.probed).toBe(MAX_PROBE);
    expect(res.entries).toHaveLength(Math.min(res.probed, 100));
    expect(res.truncated).toBe(true);
  });

  it('refuses beyond MAX_DEPTH with a typed error', async () => {
    await expect(navigationStep(mkFs({}), '', MAX_DEPTH + 1)).rejects.toMatchObject({ code: 'depth-exceeded' });
  });

  it('reveals markers: label from kind, directories first, no marker probe on files', async () => {
    const fs = mkFs(
      { readme: 'file', plain: 'dir', nord: 'dir' },
      { [`nord/${MARKER_FILE}`]: JSON.stringify({ kind: 'theme' }), [`plain/${MARKER_FILE}`]: 'not json' },
    );
    const res = await navigationStep(fs, '', 0);
    expect(res.entries.map((e) => e.name)).toEqual(['nord', 'plain', 'readme']);
    const nord = res.entries.find((e) => e.name === 'nord')!;
    expect(nord.kind).toBe('theme');
    expect(res.entries.find((e) => e.name === 'plain')!.kind).toBeUndefined();
    expect(res.entries.find((e) => e.name === 'readme')!.isDir).toBe(false);
  });
});

describe('pickability + labels (G-OB-2 first-party rules)', () => {
  it('a directory is pickable iff its kind ∈ kinds', () => {
    const e = { name: 'nord', isDir: true, kind: 'theme' };
    expect(pickable(e, ['theme'])).toBe(true);
    expect(pickable(e, ['wiki'])).toBe(false);
    expect(pickable({ name: 'x', isDir: true }, ['theme'])).toBe(false);
    expect(pickable({ name: 'x', isDir: false, kind: 'theme' }, ['theme'])).toBe(false);
  });

  it('parseMarkerKind is defensive (garbage ⇒ undefined)', () => {
    expect(parseMarkerKind('{"kind":"theme"}')).toBe('theme');
    expect(parseMarkerKind('{"kind":42}')).toBeUndefined();
    expect(parseMarkerKind('{')).toBeUndefined();
    expect(parseMarkerKind('{"kind":""}')).toBeUndefined();
  });

  it('pathFromSegments joins breadcrumbs', () => {
    expect(pathFromSegments(['themes', 'nord'])).toBe('themes/nord');
    expect(pathFromSegments([])).toBe('');
  });
});

// The spaces leg (R3-499): strip-granted root recognition + the location a pick
// returns for each source (G-OB-7 — the location names the SAME bytes the user
// navigated: the repo WITH its ref, or the picked space's id).
import { locationForPick, parseRepoLocator, spaceRootsOf } from './navigation';
import type { SandboxMount } from '@immediately-run/sdk';

// Fixture mounts arrive typed 'github' by default (the runtime verb's repo
// mount) — the strip's space grant is exactly and only 'firestore' + id.
const m = (over: Partial<SandboxMount>): SandboxMount => ({ path: '/mnt/x', type: 'github', ...over }) as SandboxMount;

describe('spaceRootsOf', () => {
  it('keeps firestore mounts carrying a spaceId; drops the repo mount and id-less mounts', () => {
    const roots = spaceRootsOf([
      m({ type: 'github' }), // a pasted repo the user opened (the runtime verb)
      m({ type: 'firestore' }), // no id — not a space root
      m({ type: 'firestore', id: 'space-1', mode: 'ro', name: 'Team' }),
    ]);
    expect(roots.map((r) => r.id)).toEqual(['space-1']);
  });
});

describe('parseRepoLocator', () => {
  it('splits repo and ref at the FIRST @ (the host grammar); the default branch stays absent', () => {
    expect(parseRepoLocator('github:acme/themes')).toEqual({ repo: 'github:acme/themes' });
    expect(parseRepoLocator('github:acme/themes@v2')).toEqual({ repo: 'github:acme/themes', ref: 'v2' });
    // A legal ref may itself contain '@' (isSafeMountSegment admits it): the
    // host mounts ref 'v1@beta', and the location must name THAT ref — a
    // last-'@' split would return coordinates the user never navigated (G-OB-7).
    expect(parseRepoLocator('github:acme/themes@v1@beta')).toEqual({
      repo: 'github:acme/themes',
      ref: 'v1@beta',
    });
  });
});


describe('locationForPick (G-OB-7)', () => {
  it('a repo pick names the repo AND its ref', () => {
    expect(locationForPick({ kind: 'repo', locator: 'github:acme/themes@v2' }, 'themes/nord')).toEqual({
      kind: 'repo',
      repo: 'github:acme/themes',
      ref: 'v2',
      path: 'themes/nord',
    });
    expect(locationForPick({ kind: 'repo', locator: 'github:acme/themes' }, '')).toEqual({
      kind: 'repo',
      repo: 'github:acme/themes',
      path: '',
    });
  });

  it('a space pick names the space the strip granted', () => {
    expect(locationForPick({ kind: 'space', spaceId: 'space-1' }, 'themes/nord')).toEqual({
      kind: 'space',
      spaceId: 'space-1',
      path: 'themes/nord',
    });
  });
});
