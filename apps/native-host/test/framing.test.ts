import { describe, it, expect } from "vitest";
import { encodeMessage, MessageReader, MAX_MESSAGE_BYTES } from "../src/framing.js";

describe("native-messaging framing", () => {
  it("round-trips a message through encode + reader", () => {
    const messages: unknown[] = [];
    const reader = new MessageReader(
      (m) => messages.push(m),
      (e) => {
        throw e;
      },
    );
    const payload = { action: "healthCheck", requestId: "abc" };
    reader.push(encodeMessage(payload));
    expect(messages).toEqual([payload]);
  });

  it("reassembles a message split across chunks", () => {
    const messages: unknown[] = [];
    const reader = new MessageReader(
      (m) => messages.push(m),
      (e) => {
        throw e;
      },
    );
    const full = encodeMessage({ action: "openUrl", url: "https://x.com" });
    reader.push(full.subarray(0, 3));
    reader.push(full.subarray(3, 10));
    expect(messages).toHaveLength(0); // not complete yet
    reader.push(full.subarray(10));
    expect(messages).toHaveLength(1);
  });

  it("handles multiple messages in one chunk", () => {
    const messages: unknown[] = [];
    const reader = new MessageReader(
      (m) => messages.push(m),
      (e) => {
        throw e;
      },
    );
    const a = encodeMessage({ action: "healthCheck" });
    const b = encodeMessage({ action: "openUrl", url: "https://y.com" });
    reader.push(Buffer.concat([a, b]));
    expect(messages).toHaveLength(2);
  });

  it("reports an error for an over-limit declared length", () => {
    const errors: Error[] = [];
    const reader = new MessageReader(
      () => {
        throw new Error("should not emit");
      },
      (e) => errors.push(e),
    );
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0);
    reader.push(header);
    expect(errors).toHaveLength(1);
  });

  it("reports an error for invalid JSON body", () => {
    const errors: Error[] = [];
    const reader = new MessageReader(
      () => {},
      (e) => errors.push(e),
    );
    const body = Buffer.from("{not json", "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    reader.push(Buffer.concat([header, body]));
    expect(errors).toHaveLength(1);
  });
});
