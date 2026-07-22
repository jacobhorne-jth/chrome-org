# Implementation plan

Status legend: ✅ done · ⬜ not started

## Architecture

Three packages in a pnpm monorepo:

- **`packages/shared`** — the single source of truth for the data model
  (`Workspace`, `SavedTab`, `LaunchAction`, …), the native-messaging protocol
  (Zod-validated request/response schemas), forward-only migrations, and the
  per-component launch-result types. Consumed by both apps so the wire contract
  can never drift.
- **`apps/native-host`** — a stdio native-messaging companion. Pure pipeline:
  `framing → Zod validation (dispatch) → executor`. The executor maps typed
  actions to fixed binaries with argument arrays. No shell, ever.
- **`apps/extension`** — MV3 extension. A **domain layer** (framework-free,
  dependency-injected via a `BrowserApi` interface) holds all logic:
  `repository` (storage + migrations + snapshots + export/import), `capture`
  (tab↔saved-state), `manager` (ownership, reconciliation, launch/focus, save,
  close), `nativeClient`, `saver` (debounce), and `search` (fuzzy). A thin
  **service worker** wires Chrome events to the domain. A **React side panel**
  renders compact rows + a command palette and talks to the worker over a typed
  RPC.

## Slices

1. ✅ Monorepo scaffold, strict TS, ESLint, Prettier, Vitest.
2. ✅ `shared`: types, Zod message + data schemas, migrations, launch results.
3. ✅ `native-host`: framing, executor (open/code/discord), dispatch, stdio
   entry, install/uninstall scripts. Unit + integration tests.
4. ✅ `extension` data model: `repository` (CRUD, snapshots, export/import),
   `capture`/`planRestore`. Tests with a fake `BrowserApi`.
5. ✅ `extension` background domain: `manager` (window ownership map in
   session storage, reconciliation, launch with in-flight lock, restore,
   focusTab, save, close), `nativeClient`, `saver`. Tests.
6. ✅ `search`: fuzzy scorer + grouped results. Tests.
7. ✅ Service worker wiring + typed RPC + React side panel (rows, editor,
   command palette). Component tests.
8. ✅ Docs (README, this plan, test report, known limitations, troubleshooting).
9. ✅ Full validation loop: typecheck, lint, format, unit + integration tests,
   production build, acceptance-criteria pass.

## Window ownership design

- The **authoritative live mapping** `windowId → workspaceId` lives in
  `chrome.storage.session`, which survives service-worker suspension but is
  cleared on a full browser restart. Consequence: after a restart nothing is
  considered "open" and **no unrelated window is ever adopted**.
- Persistent `workspace.runtime` (`isOpen`, `windowId`) is only a hint; startup
  `reconcile()` rewrites it from the validated session map + real windows, and
  drops stale entries.
- Rapid double-launch is de-duplicated by an in-flight `Map<workspaceId,
Promise>` so two clicks share one launch and one window.

## Session saving design

- Chrome tab/window events (create, remove, update-url/pin, move, attach,
  detach, activate, bounds) schedule a **debounced** save (1.5 s) per workspace.
  No polling, no timers otherwise.
- Before overwriting, a rolling **recovery snapshot** (latest 5) is kept per
  workspace so an accidental closure/corruption is recoverable.
- Un-restorable internal URLs (`chrome://`, extension pages, …) are **saved but
  skipped on restore**, never crashing the restore.

## Explicitly out of scope (per brief)

Workspace bundles/templates, team/cloud/subscriptions, aggressive tab
suspension, inactivity auto-close, opening everything on Chrome start, Windows/
Linux adapters (interfaces are modular so they could be added later).
