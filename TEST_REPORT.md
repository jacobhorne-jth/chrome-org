# Test report

Environment: macOS (Darwin 25.4.0), Node v20.20.2, pnpm 10.33.2, Chrome present,
Discord present, **VS Code not installed** on the build machine.

## Commands run

```bash
pnpm install
pnpm typecheck        # all three packages: PASS
pnpm lint             # eslint: PASS (0 problems)
pnpm format:check     # prettier: all files formatted
pnpm test:run         # all suites, see below
pnpm build            # shared -> native-host + extension: PASS
```

## Automated test results (all passing)

| Package                 | Test files | Tests |
| ----------------------- | ---------- | ----- |
| `@chrome-org/shared`    | 2          | 17    |
| `@chrome-org/native-host` | 4        | 27    |
| `@chrome-org/extension` | 6          | 54    |
| **Total**               | **12**     | **98** |

### What the automated tests cover

**shared** — path/URL Zod validation (spaces, encoded chars, traversal, shell
metacharacters, scheme allowlist), discriminated-union request validation
(unknown action rejection, injection rejection), and migrations (null/garbage
input, unversioned upgrade, snapshot-field repair).

**native-host** — native-messaging framing (round-trip, split across chunks,
multiple messages per chunk, over-limit length, invalid JSON), executor
(`expandHome`, Discord deep-link conversion), dispatch/validation (health check
without spawning, unknown/ malformed/injection rejection, requestId preservation,
VS Code CLI vs missing-CLI setup error, missing-path error, app-not-found error,
Discord fallback, spaced/encoded URLs), and a full **integration pipeline**
(raw framed bytes → reader → validation → executor → framed response) for health
check, vscode, injection rejection, unknown action.

**extension** — repository (create/rename/delete, save order + pinned + active,
rolling 5 snapshots newest-first, snapshot restore, export/import round-trip,
malformed + structurally-invalid import rejection, runtime reset on import),
capture/planRestore (index ordering, pinned/active preservation, pendingUrl,
skipping un-restorable URLs, active-index clamping), manager (create-from-window,
restore dedicated window, restore pinned/order/active, **focus on 2nd launch —
no duplicate window**, **rapid double-launch → one window**, multiple workspaces
in separate windows, skip unsupported URLs, per-component results with browser
success despite action failure, discord fallback surfaced, native-unavailable
error, focusTab activates matching tab, close marks closed, **reconcile removes
stale mappings**, **unmanaged window not adopted**, unrelated windows untouched
during launch), saver (burst coalescing, independent per-workspace debounce,
flush, cancel), search (fuzzy subsequence + exact/prefix ranking, folder-name
extraction, name/description/tab-title/tab-URL/action matching, empty-query
returns recent workspaces with no tab noise, stable flatten order), and UI
(palette filter/highlight, arrow+enter, escape, tab-result pick; row keeps tabs
collapsed by default and expands on click; Open vs Focus label).

## Manual / live verifications performed on the build machine

- **Native host runs as a real subprocess** with correct Chrome framing. A live
  `healthCheck` over stdin/stdout returned:
  `{"action":"healthCheck","status":"success","version":1,"hostName":"com.chrome_org.host","requestId":"report"}`
- **Install script** writes `com.chrome_org.host.json` with the correct
  `allowed_origins` into Chrome's `NativeMessagingHosts` dir (verified with a
  placeholder ID, then removed). It rejects invalid IDs.
- **Uninstall script** removes the manifest(s) and the generated launcher.
- **Production build** emits a valid unpacked extension: `manifest.json`,
  `background.js` (module service worker importing `./chunks/…`), `sidepanel.html`
  + hashed assets.

## Manual steps that require your GUI (not automatable here)

These are GUI/permission-gated and must be done once on your machine. Record
results here as you go.

1. Load `apps/extension/dist` unpacked in each Chrome profile — ☐ verified by you
2. Run `install-native-host.mjs` with the real extension ID; side panel footer
   shows **companion: connected** — ☐
3. Create a workspace from the current window; close it → tabs saved — ☐
4. Launch it → dedicated window restored; launch again → same window focused — ☐
5. Multiple workspaces open in separate windows simultaneously — ☐
6. A VS Code launch action opens/focuses the project (requires VS Code + `code`
   CLI installed) — ☐
7. A Discord launch action opens the app/channel or falls back to the browser — ☐
8. `⌘⇧K` opens the command palette; selecting a tab activates it — ☐

## Notes

- The VS Code launch path is exercised by unit/integration tests with a mocked
  runner and by the missing-CLI setup-error path; it was **not** verified against
  a real editor because VS Code is not installed on this machine.
- Real-Chrome E2E (Playwright with a persistent context loading the unpacked
  extension) is not run in this headless environment; the domain logic that E2E
  would exercise is covered by the manager/reconcile/repository suites against a
  faithful in-memory `BrowserApi`.
