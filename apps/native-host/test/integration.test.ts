import { describe, it, expect, vi } from "vitest";
import { encodeMessage, MessageReader } from "../src/framing.js";
import { handleMessage } from "../src/dispatch.js";
import type { ExecutorDeps, SpawnResult } from "../src/executor.js";
import type { NativeResponse } from "@chrome-org/shared";

/**
 * End-to-end pipeline: raw framed bytes -> MessageReader -> handleMessage (Zod
 * validation + executor) -> encodeMessage -> MessageReader -> decoded response.
 * This mirrors what the real stdio host does, minus the OS process.
 */
function makeDeps(): ExecutorDeps {
  const run = vi.fn(async (): Promise<SpawnResult> => ({ code: 0, stdout: "", stderr: "" }));
  return {
    run: run as unknown as ExecutorDeps["run"],
    fs: { exists: () => true },
    resolveVscodeCli: () => "/usr/local/bin/code",
    vscodeAppInstalled: () => true,
  };
}

async function roundTrip(request: unknown, deps: ExecutorDeps): Promise<NativeResponse> {
  // Encode the request as Chrome would, decode it via the reader.
  const decodedRequests: unknown[] = [];
  const reqReader = new MessageReader(
    (m) => decodedRequests.push(m),
    (e) => {
      throw e;
    },
  );
  reqReader.push(encodeMessage(request));
  expect(decodedRequests).toHaveLength(1);

  const response = await handleMessage(decodedRequests[0], deps);

  // Encode the response and decode it back, proving both directions frame cleanly.
  const decodedResponses: NativeResponse[] = [];
  const resReader = new MessageReader(
    (m) => decodedResponses.push(m as NativeResponse),
    (e) => {
      throw e;
    },
  );
  resReader.push(encodeMessage(response));
  return decodedResponses[0]!;
}

describe("native host integration pipeline", () => {
  it("answers a framed health check with protocol version", async () => {
    const res = await roundTrip({ action: "healthCheck", requestId: "hc" }, makeDeps());
    expect(res.status).toBe("success");
    expect(res.version).toBe(1);
    expect(res.requestId).toBe("hc");
  });

  it("executes a framed vscode request", async () => {
    const res = await roundTrip(
      { action: "openVscodeWorkspace", targetPath: "/Users/me/My Project", requestId: "v1" },
      makeDeps(),
    );
    expect(res.status).toBe("success");
    expect(res.requestId).toBe("v1");
  });

  it("returns a structured error for an injection attempt through the full pipeline", async () => {
    const res = await roundTrip(
      { action: "openPath", path: "/tmp/$(rm -rf ~)", requestId: "bad" },
      makeDeps(),
    );
    expect(res.status).toBe("error");
    expect(res.requestId).toBe("bad");
  });

  it("rejects an unknown action through the full pipeline", async () => {
    const res = await roundTrip({ action: "wipeDisk" }, makeDeps());
    expect(res.status).toBe("error");
  });
});
