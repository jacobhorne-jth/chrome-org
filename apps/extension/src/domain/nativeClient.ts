import type { ComponentResult, LaunchAction, NativeResponse } from "@chrome-org/shared";
import type { BrowserApi } from "./browser.js";

export const NATIVE_HOST_NAME = "com.chrome_org.host";
const DEFAULT_TIMEOUT_MS = 8000;

export class NativeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeUnavailableError";
  }
}

/**
 * One-shot native-messaging client. Each call spawns the host, sends a single
 * request, and resolves with its response (or a timeout error). No persistent
 * connection is kept alive.
 */
export class NativeClient {
  constructor(
    private readonly api: BrowserApi,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async send(message: unknown): Promise<NativeResponse> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Native host timed out")), this.timeoutMs),
    );
    let raw: unknown;
    try {
      raw = await Promise.race([this.api.sendNativeMessage(NATIVE_HOST_NAME, message), timeout]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        /not found|not installed|Specified native messaging host|forbidden|Access to/i.test(msg)
      ) {
        throw new NativeUnavailableError(
          "Native companion is not installed. Run scripts/install-native-host.mjs.",
        );
      }
      throw err instanceof Error ? err : new Error(msg);
    }
    return raw as NativeResponse;
  }

  async healthCheck(): Promise<{ ok: boolean; version?: number; message: string }> {
    try {
      const res = await this.send({ action: "healthCheck" });
      return {
        ok: res.status === "success",
        version: res.version,
        message: res.message ?? "ok",
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Translate a workspace LaunchAction into a native request payload. */
export function actionToRequest(action: LaunchAction): Record<string, unknown> {
  switch (action.type) {
    case "vscode":
      return { action: "openVscodeWorkspace", targetPath: action.targetPath };
    case "discord":
      return { action: "openDiscord", channelUrl: action.channelUrl };
    case "application":
      return {
        action: "openApplication",
        ...(action.applicationName ? { applicationName: action.applicationName } : {}),
        ...(action.bundleId ? { bundleId: action.bundleId } : {}),
      };
    case "url":
      return action.preferredApplication
        ? {
            action: "openUrlInApplication",
            url: action.url,
            applicationName: action.preferredApplication,
          }
        : { action: "openUrl", url: action.url };
    case "path":
      return { action: "openPath", path: action.path };
  }
}

/** Run one launch action via the native client and normalize to a ComponentResult. */
export async function runLaunchAction(
  client: NativeClient,
  action: LaunchAction,
): Promise<ComponentResult> {
  try {
    const res = await client.send(actionToRequest(action));
    return {
      status:
        res.status === "success" ? "success" : res.status === "fallback" ? "fallback" : "error",
      ...(res.message ? { message: res.message } : {}),
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
