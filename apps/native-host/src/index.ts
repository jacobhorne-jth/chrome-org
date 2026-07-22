#!/usr/bin/env node
import { encodeMessage, MessageReader } from "./framing.js";
import { handleMessage } from "./dispatch.js";

/**
 * Native-messaging host entry point. Chrome launches this process, writes framed
 * requests to stdin, and reads framed responses from stdout. Each request is a
 * one-shot: validate, execute, respond. The process exits when Chrome closes the
 * pipe (stdin `end`).
 */
function writeResponse(message: unknown): void {
  process.stdout.write(encodeMessage(message));
}

const reader = new MessageReader(
  (msg) => {
    void handleMessage(msg).then(writeResponse);
  },
  (err) => {
    writeResponse({
      action: "unknown",
      status: "error",
      message: `Framing error: ${err.message}`,
    });
  },
);

process.stdin.on("data", (chunk: Buffer) => reader.push(chunk));
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(1));

// Keep stdout from throwing on EPIPE if Chrome disconnects mid-write.
process.stdout.on("error", () => process.exit(0));
