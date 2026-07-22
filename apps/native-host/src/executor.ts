import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  NATIVE_PROTOCOL_VERSION,
  type NativeRequest,
  type NativeResponse,
} from "@chrome-org/shared";

const HOST_NAME = "com.chrome_org.host";

/** Minimal result of running a subprocess. */
export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Injectable process runner so the executor is unit-testable without real spawns. */
export type Runner = (command: string, args: string[]) => Promise<SpawnResult>;

/** Injectable filesystem probe so path checks are unit-testable. */
export interface Filesystem {
  exists: (p: string) => boolean;
}

export interface ExecutorDeps {
  run: Runner;
  fs: Filesystem;
  /** Resolves the VS Code CLI path if available, else null. */
  resolveVscodeCli: () => string | null;
  /** True if the VS Code application bundle is installed. */
  vscodeAppInstalled: () => boolean;
}

/** Expand a leading ~ to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Default runner using the real `open`/CLI binaries via argument arrays (no shell). */
export const defaultRunner: Runner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ code: null, stdout, stderr: stderr + String(err) }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

const COMMON_VSCODE_CLI_PATHS = [
  "/usr/local/bin/code",
  "/opt/homebrew/bin/code",
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
];

export function defaultResolveVscodeCli(): string | null {
  for (const candidate of COMMON_VSCODE_CLI_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fall back to PATH lookup entries.
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    const candidate = path.join(dir, "code");
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore unreadable dirs
    }
  }
  return null;
}

export function defaultVscodeAppInstalled(): boolean {
  return fs.existsSync("/Applications/Visual Studio Code.app");
}

export const defaultDeps: ExecutorDeps = {
  run: defaultRunner,
  fs: { exists: (p) => fs.existsSync(p) },
  resolveVscodeCli: defaultResolveVscodeCli,
  vscodeAppInstalled: defaultVscodeAppInstalled,
};

function ok(action: NativeRequest["action"], message: string, detail?: Record<string, unknown>): NativeResponse {
  return { action, status: "success", message, detail };
}
function fail(action: NativeRequest["action"], message: string): NativeResponse {
  return { action, status: "error", message };
}
function fallback(action: NativeRequest["action"], message: string): NativeResponse {
  return { action, status: "fallback", message };
}

/**
 * Execute a *already-validated* native request. All process invocations use fixed
 * binaries with argument arrays; no user string is ever interpreted by a shell.
 */
export async function executeRequest(
  req: NativeRequest,
  deps: ExecutorDeps = defaultDeps,
): Promise<NativeResponse> {
  switch (req.action) {
    case "healthCheck":
      return {
        action: "healthCheck",
        status: "success",
        message: "chrome-org native host is reachable",
        version: NATIVE_PROTOCOL_VERSION,
        hostName: HOST_NAME,
      };

    case "openVscodeWorkspace": {
      const target = expandHome(req.targetPath);
      if (!deps.fs.exists(target)) {
        return fail("openVscodeWorkspace", `Target does not exist: ${target}`);
      }
      const cli = deps.resolveVscodeCli();
      if (cli) {
        // `code` reuses an existing window for the same folder, avoiding duplicates.
        const res = await deps.run(cli, [target]);
        return res.code === 0
          ? ok("openVscodeWorkspace", `Opened in VS Code: ${target}`, { via: "cli" })
          : fail("openVscodeWorkspace", res.stderr || "VS Code CLI returned an error");
      }
      if (deps.vscodeAppInstalled()) {
        const res = await deps.run("/usr/bin/open", ["-b", "com.microsoft.VSCode", target]);
        return res.code === 0
          ? ok("openVscodeWorkspace", `Opened in VS Code app: ${target}`, { via: "open" })
          : fail("openVscodeWorkspace", res.stderr || "Failed to open VS Code");
      }
      return fail(
        "openVscodeWorkspace",
        "VS Code is not installed or its `code` CLI is unavailable. Install VS Code and run 'Shell Command: Install code command in PATH'.",
      );
    }

    case "openApplication":
    case "focusApplication": {
      // `open -a`/`open -b` launches the app or brings the running instance to front.
      const args: string[] = [];
      if (req.bundleId) args.push("-b", req.bundleId);
      else if (req.applicationName) args.push("-a", req.applicationName);
      else return fail(req.action, "Provide applicationName or bundleId");
      const res = await deps.run("/usr/bin/open", args);
      return res.code === 0
        ? ok(req.action, `${req.action === "openApplication" ? "Launched" : "Focused"} application`, {
            target: req.bundleId ?? req.applicationName,
          })
        : fail(req.action, res.stderr || "Application not found");
    }

    case "openUrl": {
      const res = await deps.run("/usr/bin/open", [req.url]);
      return res.code === 0
        ? ok("openUrl", `Opened URL: ${req.url}`)
        : fail("openUrl", res.stderr || "Failed to open URL");
    }

    case "openUrlInApplication": {
      const res = await deps.run("/usr/bin/open", ["-a", req.applicationName, req.url]);
      return res.code === 0
        ? ok("openUrlInApplication", `Opened URL in ${req.applicationName}`)
        : fail("openUrlInApplication", res.stderr || "Failed to open URL in application");
    }

    case "openPath": {
      const target = expandHome(req.path);
      if (!deps.fs.exists(target)) return fail("openPath", `Path does not exist: ${target}`);
      const res = await deps.run("/usr/bin/open", [target]);
      return res.code === 0
        ? ok("openPath", `Opened path: ${target}`)
        : fail("openPath", res.stderr || "Failed to open path");
    }

    case "openDiscord": {
      // Prefer the native Discord app via a deep link; fall back to the browser URL.
      const deepLink = toDiscordDeepLink(req.channelUrl);
      if (deepLink) {
        const res = await deps.run("/usr/bin/open", ["-b", "com.hnc.Discord", deepLink]);
        if (res.code === 0) {
          return ok("openDiscord", "Opened channel in Discord app", { via: "deeplink" });
        }
      }
      const res = await deps.run("/usr/bin/open", [req.channelUrl]);
      return res.code === 0
        ? fallback("openDiscord", "Opened channel URL in the default browser")
        : fail("openDiscord", res.stderr || "Failed to open Discord channel");
    }

    default: {
      // Exhaustiveness guard.
      const _never: never = req;
      return fail((_never as NativeRequest).action, "Unhandled action");
    }
  }
}

/**
 * Convert an https Discord channel URL to a discord:// deep link the desktop app
 * understands. Returns null if the URL is not a recognizable channel URL.
 */
export function toDiscordDeepLink(channelUrl: string): string | null {
  try {
    const u = new URL(channelUrl);
    if (u.protocol === "discord:") return channelUrl;
    if (!/discord\.com$/.test(u.hostname) && !/discordapp\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/\/channels\/([^/]+)\/([^/]+)(?:\/([^/]+))?/);
    if (!m) return null;
    const [, guild, channel] = m;
    return `discord://-/channels/${guild}/${channel}`;
  } catch {
    return null;
  }
}
