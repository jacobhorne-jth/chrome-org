import { describe, it, expect } from "vitest";
import { expandHome, toDiscordDeepLink } from "../src/executor.js";
import os from "node:os";

describe("expandHome", () => {
  it("expands a bare tilde", () => {
    expect(expandHome("~")).toBe(os.homedir());
  });
  it("expands ~/ prefixes", () => {
    expect(expandHome("~/code")).toBe(`${os.homedir()}/code`);
  });
  it("leaves absolute paths untouched", () => {
    expect(expandHome("/Users/me/x")).toBe("/Users/me/x");
  });
});

describe("toDiscordDeepLink", () => {
  it("converts an https channel URL to a discord deep link", () => {
    expect(toDiscordDeepLink("https://discord.com/channels/111/222")).toBe(
      "discord://-/channels/111/222",
    );
  });
  it("passes through an existing discord:// url", () => {
    expect(toDiscordDeepLink("discord://-/channels/1/2")).toBe("discord://-/channels/1/2");
  });
  it("returns null for a non-discord URL", () => {
    expect(toDiscordDeepLink("https://example.com/channels/1/2")).toBeNull();
  });
  it("returns null for a discord URL without a channel path", () => {
    expect(toDiscordDeepLink("https://discord.com/app")).toBeNull();
  });
});
