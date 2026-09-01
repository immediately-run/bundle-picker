// The open-bundle picker app (OPEN_BUNDLE_SPEC §2/§3, R3-499) — the default
// provider bound at `task.open-bundle`. A transient task app: read the invocation
// (`kinds`), let the user navigate (paste a repo location — the host's runtime
// mount verb mounts it `ro` after per-repo consent — then browse), reveal bundles
// by marker `kind`, and complete with ONE `{ location }` — a pointer, never
// authority. The host independently re-probes the pick (G-OB-7); our job is an
// honest, bounded UI.
import { useCallback, useMemo, useState } from 'react';
import { cancelTask, completeTask, getTaskInput, mount, openFs, type SandboxMount } from '@immediately-run/sdk';
import {
  MAX_DEPTH,
  navigationStep,
  pathFromSegments,
  pickable,
  type RevealedEntry,
  type StepResult,
} from './lib/navigation';

interface PickerState {
  mount: SandboxMount | null;
  /** The repo locator the user pasted (`github:ns/repo[@ref]`). */
  locator: string;
  segments: string[];
  step: StepResult | null;
  busy: string | null;
  error: string | null;
  done: boolean;
}

export default function App() {
  const input = useMemo(() => getTaskInput(), []);
  const kinds: readonly string[] = useMemo(
    () => (Array.isArray((input?.params as { kinds?: unknown })?.kinds) ? ((input?.params as { kinds?: string[] }).kinds ?? []) : []),
    [input],
  );
  const [state, setState] = useState<PickerState>({
    mount: null,
    locator: '',
    segments: [],
    step: null,
    busy: null,
    error: null,
    done: false,
  });

  const loadStep = useCallback(
    async (m: SandboxMount, segments: string[]) => {
      setState((s) => ({ ...s, busy: 'listing', error: null }));
      try {
        const step = await navigationStep(openFs(m), pathFromSegments(segments), segments.length);
        setState((s) => ({ ...s, segments, step, busy: null }));
      } catch (e) {
        setState((s) => ({ ...s, busy: null, error: String((e as Error)?.message ?? e) }));
      }
    },
    [],
  );

  const openRepo = useCallback(async () => {
    const locator = state.locator.trim();
    if (!locator) return;
    setState((s) => ({ ...s, busy: 'mounting', error: null }));
    try {
      // The host's runtime mount verb: `ro` mount + per-repo consent (L1).
      const m = await mount(locator);
      setState((s) => ({ ...s, mount: m, segments: [], step: null, busy: null }));
      await loadStep(m, []);
    } catch (e) {
      const err = e as Error & { code?: string };
      setState((s) => ({ ...s, busy: null, error: err.code ? `${err.code}: ${err.message}` : err.message }));
    }
  }, [state.locator, loadStep]);

  const enter = useCallback(
    (entry: RevealedEntry) => {
      if (!entry.isDir || !state.mount || state.segments.length >= MAX_DEPTH) return;
      void loadStep(state.mount, [...state.segments, entry.name]);
    },
    [state.segments, state.mount, loadStep],
  );

  const jump = useCallback(
    (depth: number) => {
      if (!state.mount) return;
      void loadStep(state.mount, state.segments.slice(0, depth));
    },
    [state.segments, state.mount, loadStep],
  );

  const pick = useCallback(
    (entry: RevealedEntry) => {
      if (!pickable(entry, kinds) || !state.mount) return;
      const bundlePath = pathFromSegments([...state.segments, entry.name]);
      // ONE pick = ONE bundle (spec §3): the location names the picked directory.
      completeTask({
        location: { kind: 'repo', repo: state.locator.replace(/@[^@/]*$/, ''), path: bundlePath },
      });
      setState((s) => ({ ...s, done: true }));
    },
    [state.segments, state.mount, state.locator, kinds],
  );

  return (
    <main className="bp-root">
      <header className="bp-head">
        <h1>Open {kinds.join(' / ') || 'a bundle'}</h1>
        <p className="bp-sub">Pick one bundle of a requested kind. Everything else stays where it is.</p>
      </header>

      <section className="bp-paste">
        <input
          value={state.locator}
          placeholder="github:owner/repository@ref"
          onChange={(e) => setState((s) => ({ ...s, locator: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && void openRepo()}
          disabled={state.busy === 'mounting' || state.done}
          aria-label="Repository location"
        />
        <button type="button" onClick={() => void openRepo()} disabled={state.busy === 'mounting' || state.done || !state.locator.trim()}>
          {state.busy === 'mounting' ? 'Opening…' : 'Open repository'}
        </button>
      </section>

      {state.error && <p className="bp-error" role="alert">{state.error}</p>}
      {state.busy === 'listing' && <p className="bp-busy">Listing…</p>}

      {state.step && (
        <section className="bp-nav" aria-busy={state.busy === 'listing'}>
          <nav className="bp-crumbs" aria-label="Location">
            <button type="button" onClick={() => jump(0)}>root</button>
            {state.segments.map((seg, i) => (
              <button key={i} type="button" onClick={() => jump(i + 1)}>
                {seg}
              </button>
            ))}
          </nav>
          {state.step.truncated && (
            <p className="bp-truncated">Showing the first {state.step.entries.length} entries of a large directory.</p>
          )}
          <ul className="bp-list">
            {state.step.entries.map((e) => (
              <li key={e.name} className={pickable(e, kinds) ? 'bp-bundle' : undefined}>
                {e.isDir ? (
                  pickable(e, kinds) ? (
                    <button type="button" className="bp-pick" onClick={() => pick(e)} disabled={state.done}>
                      Open this {e.kind}
                    </button>
                  ) : (
                    <button type="button" onClick={() => enter(e)} disabled={state.done}>
                      {e.name}/
                    </button>
                  )
                ) : (
                  <span className="bp-file">{e.name}</span>
                )}
                {e.isDir && !pickable(e, kinds) && e.kind && <span className="bp-kind">{e.kind}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="bp-foot">
        <button type="button" className="bp-cancel" onClick={() => cancelTask()} disabled={state.done}>
          Cancel
        </button>
      </footer>
    </main>
  );
}
