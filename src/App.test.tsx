// @vitest-environment jsdom
// R3-826 — the invocation read is REACTIVE: a `task-input` delivered after first
// render must reach the picker (found live on the venue 2026-09-29, R3-518's
// round-trip: the one-shot `useMemo(getTaskInput)` read froze `kinds` at [] —
// "Open a bundle", every marker-bearing directory unpickable, forever).
//
// The SDK is mocked with the real hook's semantics (state + listener + replay)
// over a controllable store: with the old one-shot read the late delivery in
// the first test could never re-render the component, and the test fails.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import type { MountFs, SandboxMount, TaskInput } from '@immediately-run/sdk';

// ── The controllable SDK double (vi.hoisted: the mock factory is hoisted above
// module scope, so everything it closes over must be too) ────────────────────
const { store, completeTaskMock } = vi.hoisted(() => ({
  store: { current: null as TaskInput | null, listeners: new Set<(i: TaskInput) => void>() },
  completeTaskMock: vi.fn(),
}));
const deliver = (i: TaskInput) => {
  store.current = i;
  for (const l of [...store.listeners]) l(i);
};

vi.mock('@immediately-run/sdk', () => ({
  // The hook as the SDK documents it: current value, re-render on arrival.
  useTaskInput: () => {
    const [input, setInput] = useState<TaskInput | null>(store.current);
    useEffect(() => {
      const l = (i: TaskInput) => setInput(i);
      store.listeners.add(l);
      if (store.current) setInput(store.current);
      return () => {
        store.listeners.delete(l);
      };
    }, []);
    return input;
  },
  // Kept faithful so the regression is what fails this suite: the old code read
  // this once in a useMemo and could never see `deliver()` after first render.
  getTaskInput: () => store.current,
  cancelTask: vi.fn(),
  completeTask: completeTaskMock,
  mount: vi.fn(async () => ({ id: 'github:o/r@main', path: '/mnt/x' }) as unknown as SandboxMount),
  openFs: () => fakeFs,
}));

// themes/nord carries a `kind: "theme"` marker; themes/plain does not.
const fakeFs = {
  readdir: async (rel = '') => {
    if (rel === '') return [{ name: 'themes', kind: 'dir' as const }];
    if (rel === 'themes') return [{ name: 'nord', kind: 'dir' as const }, { name: 'plain', kind: 'dir' as const }];
    return [];
  },
  readFile: async (p: string) => {
    if (p === 'themes/nord/immediately.run.json') return JSON.stringify({ kind: 'theme' });
    throw new Error('not found');
  },
} as unknown as MountFs;

import App from './App';

beforeEach(() => {
  store.current = null;
  store.listeners.clear();
  completeTaskMock.mockClear();
});
afterEach(cleanup);

describe('the invocation read (R3-826)', () => {
  it('a task input arriving AFTER first render re-renders the picker with its kinds', async () => {
    render(<App />);
    // No invocation yet: the honest waiting state, not the generic picker chrome.
    expect(screen.getByRole('status').textContent).toContain('Waiting for the invocation');
    expect(screen.queryByLabelText('Repository location')).toBeNull();

    act(() => deliver({ task: 'open-bundle', params: { kinds: ['theme'] } }));

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe('Open theme');
    expect(screen.getByLabelText('Repository location')).toBeTruthy();
  });

  it('late-delivered kinds make marker-matching directories pickable', async () => {
    render(<App />);
    act(() => deliver({ task: 'open-bundle', params: { kinds: ['theme'] } }));

    fireEvent.change(screen.getByLabelText('Repository location'), { target: { value: 'github:o/r' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open repository' }));
    await screen.findByRole('button', { name: 'themes/' });
    fireEvent.click(screen.getByRole('button', { name: 'themes/' }));

    // nord's marker kind ∈ kinds → "Open this theme"; plain has no marker → not pickable.
    const pick = await screen.findByRole('button', { name: 'Open this theme' });
    expect(screen.queryByRole('button', { name: 'plain/' })).toBeTruthy();

    fireEvent.click(pick);
    expect(completeTaskMock).toHaveBeenCalledWith({
      location: { kind: 'repo', repo: 'github:o/r', path: 'themes/nord' },
    });
  });

  it('an input that never arrives leaves the waiting state and nothing pickable', () => {
    render(<App />);
    expect(screen.getByRole('status').textContent).toContain('Waiting for the invocation');
    expect(screen.queryByLabelText('Repository location')).toBeNull();
    expect(document.querySelector('.bp-pick')).toBeNull();
  });
});
