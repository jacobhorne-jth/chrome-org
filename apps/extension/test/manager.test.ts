import { describe, it, expect, beforeEach } from "vitest";
import { WorkspaceManager, WINDOW_MAP_KEY } from "../src/domain/manager.js";
import { WorkspaceRepository } from "../src/domain/repository.js";
import { NativeClient } from "../src/domain/nativeClient.js";
import { FakeBrowser } from "./fakeBrowser.js";
import type { LaunchAction, WorkspaceBrowserState } from "@chrome-org/shared";

function setup() {
  const api = new FakeBrowser();
  const repo = new WorkspaceRepository(api);
  const native = new NativeClient(api, 2000);
  const mgr = new WorkspaceManager(api, repo, native);
  return { api, repo, native, mgr };
}

function browserState(overrides?: Partial<WorkspaceBrowserState>): WorkspaceBrowserState {
  return {
    tabs: [
      { url: "https://github.com/x", pinned: true, index: 0 },
      { url: "https://docs.com", pinned: false, index: 1 },
      { url: "https://board.com", pinned: false, index: 2 },
    ],
    activeTabIndex: 2,
    ...overrides,
  };
}

describe("WorkspaceManager: create from window", () => {
  it("captures tabs and marks the workspace open + mapped", async () => {
    const { api, repo, mgr } = setup();
    const win = api.seedWindow([
      { url: "https://a.com", pinned: true, active: false },
      { url: "https://b.com", active: true },
    ]);
    const ws = await mgr.createFromWindow(win.id, { name: "Blockchain" });
    expect(ws.browser.tabs).toHaveLength(2);
    expect(ws.browser.tabs[0]?.pinned).toBe(true);
    expect(await mgr.workspaceIdForWindow(win.id)).toBe(ws.id);
    const reloaded = await repo.get(ws.id);
    expect(reloaded?.runtime.isOpen).toBe(true);
  });
});

describe("WorkspaceManager: launch / focus", () => {
  it("opens a closed workspace by restoring a dedicated window", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({ name: "Blockchain", browser: browserState() });
    expect(api.listWindowIds()).toHaveLength(0);

    const result = await mgr.launch(ws.id);
    expect(result.browser.status).toBe("success");
    expect(api.listWindowIds()).toHaveLength(1);
    expect((await repo.get(ws.id))?.runtime.isOpen).toBe(true);
  });

  it("restores pinned state, order, and active tab", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({ name: "WS", browser: browserState() });
    await mgr.launch(ws.id);
    const [windowId] = api.listWindowIds();
    const tabs = await api.getTabs(windowId!);
    expect(tabs.map((t) => t.url)).toEqual([
      "https://github.com/x",
      "https://docs.com",
      "https://board.com",
    ]);
    expect(tabs[0]?.pinned).toBe(true);
    expect(tabs.find((t) => t.active)?.url).toBe("https://board.com");
  });

  it("focuses the existing window on a second launch instead of duplicating", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({ name: "WS", browser: browserState() });
    await mgr.launch(ws.id);
    const result2 = await mgr.launch(ws.id);
    expect(result2.browser.message).toMatch(/focused/i);
    expect(api.listWindowIds()).toHaveLength(1);
  });

  it("rapid double launch creates only one window", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({ name: "WS", browser: browserState() });
    const [r1, r2] = await Promise.all([mgr.launch(ws.id), mgr.launch(ws.id)]);
    expect(api.listWindowIds()).toHaveLength(1);
    expect(r1).toBe(r2); // shared in-flight promise
  });

  it("keeps multiple different workspaces open in separate windows", async () => {
    const { api, mgr, repo } = setup();
    const a = await repo.create({ name: "A", browser: browserState() });
    const b = await repo.create({ name: "B", browser: browserState() });
    await mgr.launch(a.id);
    await mgr.launch(b.id);
    expect(api.listWindowIds()).toHaveLength(2);
    expect(await mgr.workspaceIdForWindow(api.listWindowIds()[0]!)).toBeTruthy();
  });

  it("skips unsupported internal URLs when restoring", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({
      name: "WS",
      browser: {
        tabs: [
          { url: "https://ok.com", pinned: false, index: 0 },
          { url: "chrome://settings", pinned: false, index: 1 },
        ],
        activeTabIndex: 0,
      },
    });
    const result = await mgr.launch(ws.id);
    expect(result.browser.message).toMatch(/skipped 1/i);
    const tabs = await api.getTabs(api.listWindowIds()[0]!);
    expect(tabs.map((t) => t.url)).toEqual(["https://ok.com"]);
  });
});

describe("WorkspaceManager: launch actions", () => {
  const vscodeAction: LaunchAction = {
    id: "a1",
    type: "vscode",
    targetPath: "/Users/me/proj",
  };

  it("returns per-component results and a browser success even if an action fails", async () => {
    const { api, mgr, repo } = setup();
    api.nativeHandler = (msg) => {
      const m = msg as { action: string };
      if (m.action === "openVscodeWorkspace") return { action: m.action, status: "error", message: "no code CLI" };
      return { action: m.action, status: "success" };
    };
    const ws = await repo.create({ name: "WS", browser: browserState(), launchActions: [vscodeAction] });
    const result = await mgr.launch(ws.id);
    expect(result.browser.status).toBe("success");
    expect(result.actions["a1"]?.status).toBe("error");
  });

  it("surfaces a discord fallback status", async () => {
    const { api, mgr, repo } = setup();
    api.nativeHandler = (msg) => {
      const m = msg as { action: string };
      return { action: m.action, status: "fallback", message: "Opened channel URL in browser" };
    };
    const discord: LaunchAction = { id: "d1", type: "discord", channelUrl: "https://discord.com/channels/1/2" };
    const ws = await repo.create({ name: "WS", browser: browserState(), launchActions: [discord] });
    const result = await mgr.launch(ws.id);
    expect(result.actions["d1"]?.status).toBe("fallback");
  });

  it("reports an error result when the native host is unavailable", async () => {
    const { mgr, repo } = setup();
    // no nativeHandler -> sendNativeMessage throws
    const ws = await repo.create({ name: "WS", browser: browserState(), launchActions: [vscodeAction] });
    const result = await mgr.launch(ws.id);
    expect(result.browser.status).toBe("success"); // browser still restored
    expect(result.actions["a1"]?.status).toBe("error");
  });
});

describe("WorkspaceManager: focusTab", () => {
  it("activates the tab matching a URL after focusing the workspace", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({ name: "WS", browser: browserState() });
    await mgr.focusTab(ws.id, "https://docs.com");
    const tabs = await api.getTabs(api.listWindowIds()[0]!);
    expect(tabs.find((t) => t.active)?.url).toBe("https://docs.com");
  });
});

describe("WorkspaceManager: close & reconcile", () => {
  it("marks a workspace closed when its managed window is removed", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({ name: "WS", browser: browserState() });
    await mgr.launch(ws.id);
    const [windowId] = api.listWindowIds();
    // Simulate a debounced save having run, then a manual close.
    await mgr.saveWindow(ws.id, "user-edit");
    api.closeWindow(windowId!);
    await mgr.handleWindowRemoved(windowId!);
    expect((await repo.get(ws.id))?.runtime.isOpen).toBe(false);
    expect(await mgr.workspaceIdForWindow(windowId!)).toBeUndefined();
  });

  it("removes stale mappings and marks closed on reconcile", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({ name: "WS", browser: browserState() });
    // Inject a stale mapping to a window that does not exist.
    await api.sessionSet(WINDOW_MAP_KEY, { "9999": ws.id });
    await repo.setRuntime(ws.id, { isOpen: true, windowId: 9999 });

    await mgr.reconcile();
    expect(await mgr.workspaceIdForWindow(9999)).toBeUndefined();
    expect((await repo.get(ws.id))?.runtime.isOpen).toBe(false);
  });

  it("does not adopt an unmanaged normal window", async () => {
    const { api, mgr, repo } = setup();
    const ws = await repo.create({ name: "WS", browser: browserState() });
    const stranger = api.seedWindow([{ url: "https://not-ours.com" }]);
    await mgr.reconcile();
    // stranger window untouched & unmapped
    expect(await mgr.workspaceIdForWindow(stranger.id)).toBeUndefined();
    expect(await api.getWindow(stranger.id)).not.toBeNull();
    expect((await repo.get(ws.id))?.runtime.isOpen).toBe(false);
  });

  it("does not modify or close unrelated windows during a launch", async () => {
    const { api, mgr, repo } = setup();
    const stranger = api.seedWindow([{ url: "https://not-ours.com" }]);
    const ws = await repo.create({ name: "WS", browser: browserState() });
    await mgr.launch(ws.id);
    expect(await api.getWindow(stranger.id)).not.toBeNull();
    const strangerTabs = await api.getTabs(stranger.id);
    expect(strangerTabs.map((t) => t.url)).toEqual(["https://not-ours.com"]);
  });
});
