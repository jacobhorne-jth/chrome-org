#!/usr/bin/env node
/**
 * Remove the chrome-org native-messaging host manifest and generated launcher.
 * Usage: node scripts/uninstall-native-host.mjs
 */
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOST_NAME = "com.chrome_org.host";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const launcherPath = path.join(repoRoot, "apps", "native-host", "host-launcher.sh");

function manifestDirs() {
  const base = path.join(os.homedir(), "Library", "Application Support");
  return [
    path.join(base, "Google", "Chrome", "NativeMessagingHosts"),
    path.join(base, "Google", "Chrome Canary", "NativeMessagingHosts"),
    path.join(base, "Chromium", "NativeMessagingHosts"),
  ];
}

let removed = 0;
for (const dir of manifestDirs()) {
  const dest = path.join(dir, `${HOST_NAME}.json`);
  if (fs.existsSync(dest)) {
    fs.rmSync(dest);
    console.log(`Removed: ${dest}`);
    removed++;
  }
}
if (fs.existsSync(launcherPath)) {
  fs.rmSync(launcherPath);
  console.log(`Removed launcher: ${launcherPath}`);
}
console.log(removed > 0 ? "Native host uninstalled." : "No host manifest was installed.");
