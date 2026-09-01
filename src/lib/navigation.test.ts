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
