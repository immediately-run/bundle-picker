# bundle-picker

The default provider for the `open-bundle` task contract (`OPEN_BUNDLE_SPEC`,
R3-499): a transient, forkable picker app. Invoked with `{ kinds }`; the user
pastes a repo location (mounted `ro` by the host's runtime mount verb, per-repo
consent) and navigates; bundles reveal by their `immediately.run.json` marker
`kind`; one pick completes with `{ location }` — a pointer, never authority. The
host independently re-probes every result (G-OB-7); this app's job is an honest,
bounded UI.

- Navigation is bounded: ≤ 256 children probed / ≤ 100 rendered per step, depth
  ≤ 16 (`src/lib/navigation.ts`, tested — G-OB-2). Never a tree scan.
- Labels come from the marker's `kind`, never a task name.
- The spaces leg (host-drawn strip, spec §4): the host strip grants this
  instance a scoped `ro` navigation root per picked space, announced mid-task
  as an ordinary `mount-add`; the app surfaces those roots (`spaceRootsOf` over
  `useMounts()`) and a pick under one returns `{ kind: 'space', spaceId, path }`
  (`locationForPick`). The app never enumerates spaces — it navigates only the
  roots it was handed.

## Commands

- `npm run dev` — vite dev server (sandbox: host it via the platform CLI).
- `npm run build` — typecheck + build.
- `npm test` — vitest (bounds + pickability rules).
- `npm run lint` — eslint.

## The immediately.run stanza

`package.json` declares `provides: [{ task: "open-bundle", version: "1.0" }]` —
the binding (`task.open-bundle` in site-main's registry) resolves this repo by
default and is user-overridable like any binding.
