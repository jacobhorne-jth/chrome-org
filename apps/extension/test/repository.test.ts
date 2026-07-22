import { describe, it, expect, beforeEach } from "vitest";
import { WorkspaceRepository } from "../src/domain/repository.js";
import { FakeBrowser } from "./fakeBrowser.js";
import type { WorkspaceBrowserState } from "@chrome-org/shared";

function browserState(): WorkspaceBrowserState {
  return {
    tabs: [
      { url: "https://a.com", pinned: true, index: 0 },
      { url: "https://b.com", pinned: false, index: 1 },
    ],
    activeTabIndex: 1,
  };
}

describe("WorkspaceRepository", () => {
  let repo: WorkspaceRepository;
  beforeEach(() => {
    repo = new WorkspaceRepository(new FakeBrowser());
  });

  it("creates and retrieves a workspace", async () => {
    const ws = await repo.create({ name: "Blockchain", color: "#f90" });
    expect(ws.id).toBeTruthy();
    expect(ws.runtime.isOpen).toBe(false);
    const all = await repo.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("Blockchain");
  });

  it("renames and updates a workspace", async () => {
    const ws = await repo.create({ name: "Old" });
    const updated = await repo.update(ws.id, { name: "New Name" });
    expect(updated?.name).toBe("New Name");
    expect((await repo.get(ws.id))?.name).toBe("New Name");
  });

  it("deletes a workspace and its snapshots", async () => {
    const ws = await repo.create({ name: "Temp", browser: browserState() });
    await repo.addSnapshot(ws.id, browserState(), "test");
    await repo.delete(ws.id);
    expect(await repo.getAll()).toHaveLength(0);
    expect(await repo.getSnapshots(ws.id)).toHaveLength(0);
  });

  it("saves browser state and preserves pinned + active + order", async () => {
    const ws = await repo.create({ name: "S" });
    await repo.saveBrowserState(ws.id, browserState());
    const saved = await repo.get(ws.id);
    expect(saved?.browser.tabs.map((t) => t.url)).toEqual(["https://a.com", "https://b.com"]);
    expect(saved?.browser.tabs[0]?.pinned).toBe(true);
    expect(saved?.browser.activeTabIndex).toBe(1);
  });

  it("keeps only the latest N recovery snapshots, newest first", async () => {
    const ws = await repo.create({ name: "Snap" });
    for (let i = 0; i < 8; i++) {
      await repo.addSnapshot(
        ws.id,
        { tabs: [{ url: `https://n${i}.com`, pinned: false, index: 0 }], activeTabIndex: 0 },
        `save ${i}`,
      );
    }
    const snaps = await repo.getSnapshots(ws.id);
    expect(snaps).toHaveLength(5);
    // newest first
    expect(snaps[0]?.browser.tabs[0]?.url).toBe("https://n7.com");
  });

  it("restores a recovery snapshot", async () => {
    const ws = await repo.create({ name: "R", browser: browserState() });
    await repo.addSnapshot(
      ws.id,
      { tabs: [{ url: "https://old.com", pinned: false, index: 0 }], activeTabIndex: 0 },
      "before",
    );
    const [snap] = await repo.getSnapshots(ws.id);
    const restored = await repo.restoreSnapshot(ws.id, snap!.id);
    expect(restored?.browser.tabs[0]?.url).toBe("https://old.com");
  });

  it("round-trips export and import (replace)", async () => {
    await repo.create({ name: "One", browser: browserState() });
    await repo.create({ name: "Two" });
    const json = await repo.exportJson();

    const repo2 = new WorkspaceRepository(new FakeBrowser());
    const count = await repo2.importJson(json, "replace");
    expect(count).toBe(2);
    const names = (await repo2.getAll()).map((w) => w.name).sort();
    expect(names).toEqual(["One", "Two"]);
  });

  it("rejects malformed import JSON", async () => {
    await expect(repo.importJson("{ not json")).rejects.toThrow(/not valid JSON/i);
  });

  it("rejects a structurally invalid import", async () => {
    const bad = JSON.stringify({ workspaces: [{ id: "x" }] });
    await expect(repo.importJson(bad)).rejects.toThrow(/Import failed/i);
  });

  it("resets runtime.isOpen to false on import", async () => {
    const ws = await repo.create({ name: "Open me" });
    await repo.setRuntime(ws.id, { isOpen: true, windowId: 5 });
    const json = await repo.exportJson();
    const repo2 = new WorkspaceRepository(new FakeBrowser());
    await repo2.importJson(json);
    expect((await repo2.getAll())[0]?.runtime.isOpen).toBe(false);
  });
});
