// The open-bundle picker app (OPEN_BUNDLE_SPEC §2/§3, R3-499) — the default
// provider bound at `task.open-bundle`. A transient task app: read the invocation
// (`kinds`), let the user navigate (paste a repo location — the host's runtime
// mount verb mounts it `ro` after per-repo consent — then browse), reveal bundles
// by marker `kind`, and complete with ONE `{ location }` — a pointer, never
// authority. The host independently re-probes the pick (G-OB-7); our job is an
// honest, bounded UI.
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { cancelTask, completeTask, getMounts, mount, openFs, useMounts, useTaskInput, type SandboxMount } from '@immediately-run/sdk';
import {
  MAX_DEPTH,
  locationForPick,
  navigationStep,
  pathFromSegments,
  pickable,
  spaceRootsOf,
  type PickerSource,
  type RevealedEntry,
  type StepResult,
} from './lib/navigation';

interface PickerState {
  mount: SandboxMount | null;
  /** Identity token of the LATEST issued navigation; a resolving listing
   *  applies only when it still holds the token (staleness guard). */
  navToken: object;
  /** What `mount` is: the pasted repo, or a space the user picked in the host's
   *  spaces strip (announced mid-task, `ro`, dies with the invocation). */
  source: PickerSource | null;
  /** The repo locator the user pasted (`github:ns/repo[@ref]`). */
  locator: string;
  segments: string[];
  step: StepResult | null;
  busy: string | null;
  error: string | null;
  done: boolean;
}

/** The chrome both render states share: the head block and the Cancel footer. */
function Chrome({ title, sub, done, children }: { title: string; sub: ReactNode; done?: boolean; children?: ReactNode }) {
  return (
    <main className="bp-root">
      <header className="bp-head">
        <h1>{title}</h1>
        {sub}
      </header>
      {children}
      <footer className="bp-foot">
        <button type="button" className="bp-cancel" onClick={() => cancelTask()} disabled={done}>
          Cancel
        </button>
      </footer>
    </main>
  );
}

export default function App() {
  // The invocation arrives as a host→frame `task-input` push whose delivery is
  // observed-unreliable at mount (site-main's taskInputDelivery, R3-550 — the
  // replayable poll is R3-787). Read it reactively (`useTaskInput`, the SDK's
  // hook for exactly this) so a delivery landing after first render still
  // reaches the UI; a one-shot `getTaskInput()` in a useMemo froze `kinds` at
  // [] forever and rendered every marker-bearing directory unpickable (found
  // live on the venue, R3-518's round-trip 2026-09-29).
  const input = useTaskInput();
  const kinds: readonly string[] = useMemo(
    () => (Array.isArray((input?.params as { kinds?: unknown })?.kinds) ? ((input?.params as { kinds?: string[] }).kinds ?? []) : []),
    [input],
  );
  const [state, setState] = useState<PickerState>({
    mount: null,
    navToken: {},
    source: null,
    locator: '',
    segments: [],
    step: null,
    busy: null,
    error: null,
    done: false,
  });

  // The spaces leg (spec §4): the host's spaces strip pushes a scoped `ro`
  // navigation root into this frame per pick, announced as an ordinary
  // mount-add; `useMounts()` is how we see it. We never enumerate spaces — the
  // strip (host chrome) did that; we navigate only what we were handed.
  const mounts = useMounts();
  const spaceRoots = useMemo(() => spaceRootsOf(mounts), [mounts]);

  // A granted root can vanish mid-task (the space was unshared — the host
  // tears the mount down within one snapshot). Derived at RENDER, not an
  // effect: while the navigated root is gone the nav is not rendered and the
  // loss is named; in-flight listings of the dead root are dropped by the
  // token + the still-held check in loadStep (its reads reject at the revoked
  // port anyway).
  const currentSpaceId = state.source?.kind === 'space' ? state.source.spaceId : null;
  const currentRootGone = currentSpaceId !== null && !spaceRoots.some((m) => m.id === currentSpaceId);
  const shownError = currentRootGone ? 'That space is no longer available.' : state.error;

  // Staleness: every navigation issues a fresh token, and a resolving listing
  // applies only while it still holds it AND its mount is still held — a slow
  // read of space A must never render under space B's source (a pick would
  // then return B's spaceId with A's path — the misdirection class the host's
  // G-OB-7 re-probe exists to catch, and this app refuses to produce in the
  // first place), and a revoked root's late reads land nowhere.
  const loadStep = useCallback(
    async (m: SandboxMount, segments: string[]) => {
      const token = {};
      setState((s) => ({ ...s, navToken: token, busy: 'listing', error: null }));
      try {
        const step = await navigationStep(openFs(m), pathFromSegments(segments), segments.length);
        const stillHeld = getMounts().some((g) => g.path === m.path);
        setState((s) => (s.navToken === token && stillHeld ? { ...s, segments, step, busy: null } : { ...s, busy: s.navToken === token ? null : s.busy }));
      } catch (e) {
        const message = String((e as Error)?.message ?? e);
        // A failure on a mount that is already gone is the revocation path —
        // the derived 'no longer available' wording covers it; don't overwrite
        // it with a raw port error.
        const stillHeld = getMounts().some((g) => g.path === m.path);
        setState((s) =>
          s.navToken !== token ? s : stillHeld ? { ...s, busy: null, error: message } : { ...s, busy: null },
        );
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
      setState((s) => ({ ...s, mount: m, source: { kind: 'repo', locator }, segments: [], step: null, busy: null }));
      await loadStep(m, []);
    } catch (e) {
      const err = e as Error & { code?: string };
      setState((s) => ({ ...s, busy: null, error: err.code ? `${err.code}: ${err.message}` : err.message }));
    }
  }, [state.locator, loadStep]);

  // Navigate a strip-granted space root (the host already consented this pick —
  // the strip IS the user's gesture; nothing here prompts again).
  const openSpace = useCallback(
    (m: SandboxMount) => {
      const spaceId = m.id;
      if (typeof spaceId !== 'string' || state.done) return;
      setState((s) => ({ ...s, mount: m, source: { kind: 'space', spaceId }, segments: [], step: null, error: null }));
      void loadStep(m, []);
    },
    [loadStep, state.done],
  );

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
      if (!pickable(entry, kinds) || !state.mount || !state.source) return;
      const bundlePath = pathFromSegments([...state.segments, entry.name]);
      // ONE pick = ONE bundle (spec §3): the location names the picked directory
      // under the source it was actually navigated from (repo — with its ref —
      // or the strip-granted space), so the host's re-probe checks the SAME
      // bytes the user saw (G-OB-7).
      completeTask({ location: locationForPick(state.source, bundlePath) });
      setState((s) => ({ ...s, done: true }));
    },
    [state.segments, state.mount, state.source, kinds],
  );

  // No invocation yet: say so, with an escape — never the generic picker chrome,
  // which made a dead/late invocation indistinguishable from `kinds: []`
  // (nothing pickable, no explanation). Off-host (`vite dev`) this state simply
  // persists: there is no host to invoke this app as a callee.
  if (input === null) {
    return (
      <Chrome
        title="Open a bundle"
        sub={
          <p className="bp-sub" role="status">
            Waiting for the invocation…
          </p>
        }
      />
    );
  }

  return (
    <Chrome
      title={`Open ${kinds.join(' / ') || 'a bundle'}`}
      sub={<p className="bp-sub">Pick one bundle of a requested kind. Everything else stays where it is.</p>}
      done={state.done}
    >
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

      {spaceRoots.length > 0 && (
        <section className="bp-spaces" aria-label="Spaces you picked">
          <p className="bp-spaces-sub">From your spaces (read-only, this task only):</p>
          <ul className="bp-spaces-list">
            {spaceRoots.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => openSpace(m)}
                  disabled={state.done || state.busy !== null}
                  aria-current={state.source?.kind === 'space' && state.source.spaceId === m.id ? 'true' : undefined}
                >
                  {/* Two nameless spaces must not render identical buttons —
                      fall back to the mount's id, not a constant. */}
                  {m.name ?? m.id ?? 'a granted root'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shownError && <p className="bp-error" role="alert">{shownError}</p>}
      {state.busy === 'listing' && <p className="bp-busy">Listing…</p>}

      {state.step && !currentRootGone && (
        <section className="bp-nav" aria-busy={state.busy === 'listing'}>
          <nav className="bp-crumbs" aria-label="Location">
            <button type="button" onClick={() => jump(0)}>
              {state.mount?.name ?? 'root'}
            </button>
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
    </Chrome>
  );
}
