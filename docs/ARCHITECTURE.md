# Architecture

```
┌─────────────────────────── Chrome profile ───────────────────────────┐
│                                                                       │
│  Side panel (React)  ──typed RPC──▶  Service worker (MV3, event-only) │
│   - compact rows                       - wires chrome.* events        │
│   - command palette                    - owns domain singletons       │
│                                              │                        │
│                                     ┌────────┴─────────┐              │
│                                     │  Domain layer    │              │
│                                     │  (BrowserApi DI) │              │
│                                     │  repository      │              │
│                                     │  manager         │              │
│                                     │  capture/search  │              │
│                                     │  saver/native    │              │
│                                     └────────┬─────────┘              │
│  chrome.storage.local (persistent)  ◀────────┤                        │
│  chrome.storage.session (live map)  ◀────────┘                        │
└───────────────────────────────────────────────────────────────────────┘
                                      │ native messaging (one-shot, framed JSON)
                                      ▼
                    ┌──────────────────────────────────┐
                    │  native-host (Node, stdio)       │
                    │  framing → Zod dispatch → executor│
                    │  /usr/bin/open, code CLI (argv)   │
                    └──────────────────────────────────┘
```

## Key decisions

- **`BrowserApi` dependency injection.** The entire domain layer is written
  against a narrow `BrowserApi` interface, not the global `chrome`. The real
  implementation delegates to `chrome.*`; tests inject an in-memory `FakeBrowser`
  that simulates windows, tabs, storage, and native messaging. This is why the
  hard concurrency/ownership behaviors are unit-testable without a browser.

- **Session storage as the source of truth for "open".** `windowId → workspaceId`
  lives in `chrome.storage.session`. It survives worker suspension but not a
  browser restart — exactly the property needed to avoid adopting recycled window
  ids after a restart. Persistent `runtime` is a reconciled hint.

- **In-flight launch registry.** `Map<workspaceId, Promise<LaunchResult>>` collapses
  rapid double-clicks into one launch/one window.

- **Debounced, event-driven saving.** No polling or timers; tab/window events
  schedule a per-workspace debounce. Rolling recovery snapshots guard destructive
  overwrites.

- **Shared wire contract.** Request/response schemas and the data model live in
  `packages/shared` and are imported by both the extension and the host, so the
  native protocol cannot drift between them.

- **One-shot native messaging.** Each action spawns the host, sends one framed
  request, reads one framed response — no long-lived connection kept warm.

## Data flow: launching "Blockchain"

1. UI sends `{type:"launch", id}` over RPC.
2. `manager.launch` checks the in-flight registry, then the session map.
3. Open already? → `focusWindow`. Closed? → `planRestore` (skip internal URLs) →
   `createWindow(urls)` → pin + activate → map the window → mark open.
4. In parallel, each `LaunchAction` → `nativeClient` → host → `open`/`code`.
5. A per-component `LaunchResult` returns; partial failures are surfaced, not
   hidden. Browser success is independent of external-app success.
