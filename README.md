# chrome-org

A private, local-first **workspace launcher** for Chrome on macOS. Each workspace
is one responsibility (a class, a project, a lab, a job search) that owns a
dedicated Chrome window, a saved tab session, and a set of local launch actions
(open a VS Code folder, focus Discord on a channel, launch an app, open a file).

It is intentionally small and uncluttered: a clean side panel with compact
workspace rows and a keyboard-first command palette — no giant tab dumps,
dashboards, templates, cloud accounts, or team features.

> **What a saved session is:** URLs and browser-level tab/window state only —
> tab order, pinned tabs, the active tab, and window bounds. It does **not**
> capture form inputs, in-page memory, unsaved text, or scroll position.

## Repository layout

```
apps/
  extension/     Chrome MV3 extension (TypeScript + React + Vite)
  native-host/   macOS native-messaging companion (TypeScript/Node)
packages/
  shared/        Types, Zod message schemas, migrations (shared by both)
scripts/         Native-host install / uninstall
docs/            Architecture + troubleshooting
IMPLEMENTATION_PLAN.md  TEST_REPORT.md  KNOWN_LIMITATIONS.md
```

## Prerequisites

- macOS
- Node.js ≥ 20 and [pnpm](https://pnpm.io) ≥ 10 (`npm i -g pnpm`)
- Google Chrome
- (Optional, for VS Code actions) VS Code with the `code` CLI on `PATH`
- (Optional, for Discord actions) the Discord desktop app

## Install & build from a clean checkout

```bash
pnpm install
pnpm build          # builds shared -> native-host + extension
```

This produces:

- `apps/extension/dist/` — the unpacked extension (load this in Chrome)
- `apps/native-host/dist/` — the compiled native companion

## 1. Load the extension into Chrome

Do this **per Chrome profile** you want it in (Professional / School / Personal).
Chrome keeps each profile's extension data separate automatically.

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select `apps/extension/dist`.
4. Note the **extension ID** shown on the card (32 lowercase letters).
5. Click the puzzle-piece toolbar icon → pin **chrome-org**. Clicking it opens the
   side panel.

## 2. Install the native companion

The companion is what launches VS Code / Discord / apps / files. Chrome only lets
your specific extension talk to it, so installation needs the extension ID from
step 1.4:

```bash
node scripts/install-native-host.mjs --extension-id=<YOUR_EXTENSION_ID>
```

This writes `com.chrome_org.host.json` into Chrome's `NativeMessagingHosts`
directory with your ID in `allowed_origins`, and generates a launcher that runs
the built host with your Node.

Then in the side panel, the footer shows **companion: connected** once it works
(click it to re-check). Internally this performs a `healthCheck` round-trip.

To remove it later:

```bash
node scripts/uninstall-native-host.mjs
```

> If you rebuild after moving the repo, or load the extension into another
> profile with a different ID, re-run the install script with the correct ID.

## 3. Configure the keyboard shortcut

The command palette is bound to a Chrome **command**, configurable at
`chrome://extensions/shortcuts`:

- **Open the command palette** — default `⌘⇧K` (Command+Shift+K)
- **Open the side panel** — default `⌘⇧O` (Command+Shift+O)

Set the scope to _Global_ if you want it to work while Chrome is unfocused.
Inside the side panel, `⌘K` also opens the palette.

## Using it

- **Create from current window** — the `＋win` toolbar button captures your
  current Chrome window's tabs into a new workspace.
- **Create empty** — the `＋` button makes an empty workspace and opens its editor.
- **Open / Focus** — the primary button on each row restores the window (if
  closed) or focuses it (if already open). It never opens a second window for the
  same workspace.
- **Row overflow (⋯)** — edit/rename, save now, save & close, assign the current
  window, restore a recovery snapshot, or delete (with confirmation).
- **Command palette** — fuzzy-search across workspace names, descriptions, saved
  tab titles/URLs, and launch actions. `↑/↓` to move, `Enter` to launch/focus,
  `Esc` to close. Selecting a tab focuses its workspace and activates that tab.
- **Export / Import** — the toolbar `⋯` menu exports all data as JSON and imports
  a validated backup (replace or merge).

Tab lists stay **collapsed by default** — expand a row (click its tab count) only
when you want to see them.

## Launch actions

| Type          | What it does                                                            |
| ------------- | ----------------------------------------------------------------------- |
| `vscode`      | Opens a folder or `.code-workspace` (reuses an existing VS Code window) |
| `discord`     | Opens the Discord app to a channel; falls back to the browser URL       |
| `application` | Launches/focuses a macOS app by name or bundle id                       |
| `url`         | Opens a URL, optionally in a preferred app                              |
| `path`        | Opens a local file or directory                                         |

## Development

```bash
pnpm typecheck        # strict TS across all packages
pnpm lint             # ESLint
pnpm format           # Prettier write  (format:check to verify)
pnpm test:run         # all unit/integration tests once
pnpm --filter @chrome-org/extension dev   # rebuild the extension on change
```

After `pnpm --filter @chrome-org/extension dev` (or `build`), click the reload
icon on the extension card in `chrome://extensions` to pick up changes.

## Security

- The native companion accepts a **fixed set of typed actions only** and never
  runs arbitrary shell commands. Every message is validated with Zod before any
  process is spawned.
- All process launches use fixed binaries (`/usr/bin/open`, the `code` CLI) with
  **argument arrays** — never a shell string. Paths are checked for existence and
  rejected if they contain `..` or shell metacharacters. URLs are restricted to a
  scheme allowlist.
- No `eval`, no remote code, no remotely hosted scripts, no content scripts
  injected into pages.

See [`docs/`](docs/) for architecture and troubleshooting,
[`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) for honest constraints, and
[`TEST_REPORT.md`](TEST_REPORT.md) for what was tested and how.
