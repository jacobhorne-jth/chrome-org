#!/usr/bin/env node
/**
 * Install the chrome-org native-messaging host manifest for Google Chrome on macOS.
 *
 * Usage:
 *   node scripts/install-native-host.mjs --extension-id=<ID>
 *   CHROME_ORG_EXTENSION_ID=<ID> node scripts/install-native-host.mjs
 *
 * The extension ID is the ID Chrome assigns to the unpacked extension (visible at
 * chrome://extensions with Developer mode on). It is written into allowed_origins
 * so only your extension may talk to the host.
 */
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOST_NAME = "com.chrome_org.host";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const hostEntry = path.join(repoRoot, "apps", "native-host", "dist", "index.js");
const launcherPath = path.join(repoRoot, "apps", "native-host", "host-launcher.sh");

function parseExtensionId() {
  const arg = process.argv.find((a) => a.startsWith("--extension-id="));
  if (arg) return arg.split("=")[1];
  const positional = process.argv[2];
  if (positional && !positional.startsWith("--")) return positional;
  return process.env.CHROME_ORG_EXTENSION_ID ?? null;
}

// Chrome native-messaging host manifest locations on macOS (covers all profiles
// of a given Chrome install; Chrome Canary/Chromium included for convenience).
function manifestDirs() {
  const base = path.join(os.homedir(), "Library", "Application Support");
  return [
    path.join(base, "Google", "Chrome", "NativeMessagingHosts"),
    path.join(base, "Google", "Chrome Canary", "NativeMessagingHosts"),
    path.join(base, "Chromium", "NativeMessagingHosts"),
  ];
}

function main() {
  const extensionId = parseExtensionId();
  if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) {
    console.error(
      "Error: a valid 32-character extension ID is required.\n" +
        "Load the unpacked extension at chrome://extensions (Developer mode),\n" +
        "copy its ID, then run:\n" +
        "  node scripts/install-native-host.mjs --extension-id=<ID>",
    );
    process.exit(1);
  }

  if (!fs.existsSync(hostEntry)) {
    console.error(
      `Error: native host is not built yet (${hostEntry} missing).\n` +
        "Run: pnpm --filter @chrome-org/native-host build",
    );
    process.exit(1);
  }

  // Generate an executable launcher that runs the built host with the user's node.
  const nodeBin = process.execPath;
  const launcher = `#!/bin/bash\nexec "${nodeBin}" "${hostEntry}"\n`;
  fs.writeFileSync(launcherPath, launcher, { mode: 0o755 });
  fs.chmodSync(launcherPath, 0o755);

  const manifest = {
    name: HOST_NAME,
    description: "chrome-org local workspace launcher companion",
    path: launcherPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };

  let wrote = 0;
  for (const dir of manifestDirs()) {
    // Only install into channels whose parent app-support dir exists.
    const channelRoot = path.dirname(dir);
    if (!fs.existsSync(channelRoot)) continue;
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(dest, JSON.stringify(manifest, null, 2));
    console.log(`Installed host manifest: ${dest}`);
    wrote++;
  }

  if (wrote === 0) {
    console.error(
      "Warning: no Chrome/Chromium application-support directory was found.\n" +
        "Is Chrome installed and has it been launched at least once?",
    );
    process.exit(1);
  }

  console.log(`\nLauncher: ${launcherPath}`);
  console.log(`Allowed origin: chrome-extension://${extensionId}/`);
  console.log("Native host installed. Reload the extension and run a health check.");
}

main();
