# Known limitations

Honest constraints. Nothing here is hidden behind a "success" message at runtime.

## Browser sessions

- A saved session is **URLs + tab/window state only**: order, pinned tabs, active
  tab, window bounds. It does **not** capture form inputs, in-page state, unsaved
  text, or scroll position. This is by design.
- Un-restorable internal URLs (`chrome://…`, `chrome-extension://…`, `devtools:`,
  `about:` except `about:blank`) are **saved** but **skipped on restore** — Chrome
  forbids extensions from re-opening them. The launch result reports how many were
  skipped.
- Save-on-close relies on the debounced save (1.5 s) having captured recent
  activity. Once `windows.onRemoved` fires the window is already gone and its
  final tabs can't be re-queried, so changes in the last ~1.5 s before an abrupt
  close may not be in the very latest save. Recovery snapshots mitigate accidental
  loss.

## VS Code

- Detection prefers the `code` CLI (checked at `/usr/local/bin`, `/opt/homebrew/
bin`, inside the VS Code app bundle, and on `PATH`), then falls back to opening
  the app by bundle id. If neither is available the action returns an actionable
  setup error ("install VS Code and run _Shell Command: Install 'code' command in
  PATH_").
- "Reuse an existing window instead of duplicating" is delegated to the `code`
  CLI, which already focuses/reuses a window for the same folder. We do not manage
  VS Code editor tabs ourselves; VS Code's own session restore handles that.
- **On this build machine VS Code is not installed**, so the VS Code launch path
  was verified via unit/integration tests with a mocked runner and the
  missing-CLI setup-error path — not by launching the real editor. See
  `TEST_REPORT.md`.

## Discord

- We attempt a `discord://-/channels/<guild>/<channel>` deep link into the Discord
  desktop app (bundle id `com.hnc.Discord`). If the app isn't installed or the
  deep link doesn't resolve, we **fall back** to opening the channel URL in the
  browser and report `status: "fallback"` — we never claim the app opened when it
  didn't.
- macOS/Discord do not expose a reliable public "navigate an already-running
  client to this channel and confirm it" API. Deep-link success is best-effort;
  the browser fallback is the guaranteed path.

## Generic applications

- Launch/focus uses `open -a`/`open -b`, which brings a running instance to the
  front or launches a new one. macOS does not expose reliable per-window focus
  control for arbitrary apps, so "focus the exact window" isn't guaranteed beyond
  activating the app.

## Window ownership

- After a full **browser restart**, `chrome.storage.session` is cleared, so all
  workspaces show as closed until you launch them again. This is deliberate: it is
  the only way to guarantee we never adopt an unrelated window that happened to be
  assigned a recycled window id.

## Platform

- macOS only. The native host and launch logic are macOS-specific
  (`/usr/bin/open`, bundle ids). Interfaces are modular enough to add platform
  adapters later, but Windows/Linux are not implemented.

## Testing environment

- End-to-end tests that drive a real Chrome with the unpacked extension loaded
  are **not run in this headless build environment** (loading an unpacked
  extension + granting native-messaging is a manual, GUI-gated step). The domain
  is covered by extensive unit/integration tests against a faithful in-memory
  `BrowserApi`. The real-Chrome checklist is in `TEST_REPORT.md`.
