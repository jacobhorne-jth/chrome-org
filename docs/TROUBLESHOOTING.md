# Troubleshooting

## Side panel shows "companion: not connected"

1. Did you build the host? `pnpm --filter @chrome-org/native-host build` (or
   `pnpm build`). The install script refuses to run if `apps/native-host/dist/
   index.js` is missing.
2. Did you install with the **right** extension ID? Copy it from the extension's
   card at `chrome://extensions`, then
   `node scripts/install-native-host.mjs --extension-id=<ID>`.
3. Did the ID change? Loading the extension into a different profile, or from a
   different folder, produces a different ID. Re-run the install script.
4. Fully quit and reopen Chrome after installing the host manifest.
5. Confirm the manifest exists:
   `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.chrome_org.host.json`
   and that its `path` points at an existing `host-launcher.sh`.

Sanity-check the host directly:

```bash
node scripts/install-native-host.mjs --extension-id=<ID>   # regenerates launcher
# then, to prove the binary answers framing:
node -e 'const{spawn}=require("child_process"),os=require("os");const e=o=>{const j=Buffer.from(JSON.stringify(o)),h=Buffer.alloc(4);h.writeUInt32LE(j.length);return Buffer.concat([h,j])};const c=spawn(process.execPath,["apps/native-host/dist/index.js"]);let b=Buffer.alloc(0);c.stdout.on("data",d=>b=Buffer.concat([b,d]));c.on("close",()=>console.log(b.subarray(4).toString()));c.stdin.write(e({action:"healthCheck"}));c.stdin.end()'
```

## "VS Code is not installed or its `code` CLI is unavailable"

Install VS Code, then in VS Code run the command palette action **Shell Command:
Install 'code' command in PATH**. The host looks for `code` at
`/usr/local/bin`, `/opt/homebrew/bin`, inside the app bundle, and on `PATH`.

## A launch action failed but the tabs still opened

That's intended — browser restoration and each external action report
independently. Hover the toast / check the per-component result; the browser
succeeding while an app fails is not hidden.

## Discord opened in the browser instead of the app

The deep link into the Discord desktop app didn't resolve (app not installed, or
the channel URL wasn't a `…/channels/<guild>/<channel>` URL). The browser
fallback is the guaranteed path; status is reported as `fallback`.

## My workspaces all show "closed" after restarting Chrome

Expected. The live window mapping is intentionally cleared on browser restart so
the extension never adopts an unrelated window. Just launch the ones you want.

## The extension didn't pick up my code changes

Rebuild (`pnpm build` or the extension `dev` watcher) and click the **reload**
icon on the extension card at `chrome://extensions`.

## Reset everything

Export a backup first (toolbar `⋯` → Export). To wipe state, remove the extension
and re-add it, or clear its storage from `chrome://extensions` → Details.
