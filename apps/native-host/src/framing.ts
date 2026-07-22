import os from "node:os";

/**
 * Chrome native-messaging framing: each message is a 4-byte length header in the
 * platform's native byte order, followed by that many bytes of UTF-8 JSON.
 */

const NATIVE_LE = os.endianness() === "LE";

/** Chrome limits a single message sent to the host to 1 MB. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export function encodeMessage(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  if (NATIVE_LE) header.writeUInt32LE(json.length, 0);
  else header.writeUInt32BE(json.length, 0);
  return Buffer.concat([header, json]);
}

function readUInt32(buf: Buffer, offset: number): number {
  return NATIVE_LE ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
}

/**
 * Incrementally parses a native-messaging byte stream. Feed it stdin chunks; it
 * emits each fully-received JSON message via the `onMessage` callback.
 */
export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(
    private readonly onMessage: (msg: unknown) => void,
    private readonly onError: (err: Error) => void,
  ) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  private drain(): void {
    while (this.buffer.length >= 4) {
      const len = readUInt32(this.buffer, 0);
      if (len > MAX_MESSAGE_BYTES) {
        this.onError(new Error(`incoming message length ${len} exceeds limit`));
        // Discard the corrupt stream to avoid an infinite loop.
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (this.buffer.length < 4 + len) return; // wait for more bytes
      const body = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      try {
        this.onMessage(JSON.parse(body.toString("utf8")));
      } catch (err) {
        this.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
