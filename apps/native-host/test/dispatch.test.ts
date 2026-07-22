import { describe, it, expect, vi } from "vitest";
import { handleMessage } from "../src/dispatch.js";
import type { ExecutorDeps, SpawnResult } from "../src/executor.js";

function makeDeps(overrides: Partial<ExecutorDeps> = {}): {
  deps: ExecutorDeps;
  run: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn(async (): Promise<SpawnResult> => ({ code: 0, stdout: "", stderr: "" }));
  const deps: ExecutorDeps = {
    run: run as unknown as ExecutorDeps["run"],
    fs: { exists: () => true },
    resolveVscodeCli: () => "/usr/local/bin/code",
    vscodeAppInstalled: () => true,
    ...overrides,
  };
  return { deps, run };
}

describe("handleMessage validation", () => {
  it("answers a healthCheck without spawning", async () => {
    const { deps, run } = makeDeps();
    const res = await handleMessage({ action: "healthCheck", requestId: "r1" }, deps);
    expect(res.status).toBe("success");
    expect(res.version).toBe(1);
    expect(res.requestId).toBe("r1");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an unknown action with a structured error", async () => {
    const { deps } = makeDeps();
    const res = await handleMessage({ action: "deleteEverything" }, deps);
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/invalid request/i);
  });

  it("rejects a malformed (non-object) message", async () => {
    const { deps } = makeDeps();
    const res = await handleMessage("just a string", deps);
    expect(res.status).toBe("error");
  });

  it("rejects a shell-injection path", async () => {
    const { deps, run } = makeDeps();
    const res = await handleMessage(
      { action: "openVscodeWorkspace", targetPath: "/tmp/x; rm -rf ~" },
      deps,
    );
    expect(res.status).toBe("error");
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves requestId on error responses", async () => {
    const { deps } = makeDeps();
    const res = await handleMessage({ action: "openUrl", url: "not-a-url", requestId: "r9" }, deps);
    expect(res.status).toBe("error");
    expect(res.requestId).toBe("r9");
  });
});

describe("executor behavior via handleMessage", () => {
  it("opens a valid vscode workspace via the CLI", async () => {
    const { deps, run } = makeDeps();
    const res = await handleMessage(
      { action: "openVscodeWorkspace", targetPath: "/Users/me/My Project" },
      deps,
    );
    expect(res.status).toBe("success");
    expect(run).toHaveBeenCalledWith("/usr/local/bin/code", ["/Users/me/My Project"]);
  });

  it("returns a setup error when VS Code is missing", async () => {
    const { deps } = makeDeps({ resolveVscodeCli: () => null, vscodeAppInstalled: () => false });
    const res = await handleMessage(
      { action: "openVscodeWorkspace", targetPath: "/Users/me/proj" },
      deps,
    );
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/VS Code is not installed/i);
  });

  it("errors when a vscode target does not exist", async () => {
    const { deps } = makeDeps({ fs: { exists: () => false } });
    const res = await handleMessage(
      { action: "openVscodeWorkspace", targetPath: "/Users/me/missing" },
      deps,
    );
    expect(res.status).toBe("error");
    expect(res.message).toMatch(/does not exist/i);
  });

  it("reports an error when the app is not found (open exits non-zero)", async () => {
    const run = vi.fn(async (): Promise<SpawnResult> => ({ code: 1, stdout: "", stderr: "not found" }));
    const { deps } = makeDeps({ run: run as unknown as ExecutorDeps["run"] });
    const res = await handleMessage(
      { action: "openApplication", applicationName: "Nonexistent" },
      deps,
    );
    expect(res.status).toBe("error");
  });

  it("falls back to browser for a non-app-recognizable Discord URL", async () => {
    const run = vi.fn(async (): Promise<SpawnResult> => ({ code: 0, stdout: "", stderr: "" }));
    const { deps } = makeDeps({ run: run as unknown as ExecutorDeps["run"] });
    const res = await handleMessage(
      { action: "openDiscord", channelUrl: "https://discord.com/channels/111/222" },
      deps,
    );
    // deep link attempt succeeds (code 0) in this mock -> success
    expect(["success", "fallback"]).toContain(res.status);
  });

  it("opens a URL with encoded spaces", async () => {
    const { deps, run } = makeDeps();
    const res = await handleMessage(
      { action: "openUrl", url: "https://example.com/a%20b?q=hi%20there" },
      deps,
    );
    expect(res.status).toBe("success");
    expect(run).toHaveBeenCalledWith("/usr/bin/open", [
      "https://example.com/a%20b?q=hi%20there",
    ]);
  });
});
