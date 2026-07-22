import type { LaunchResult, ComponentResult, Workspace } from "@chrome-org/shared";
import type { BrowserApi } from "./browser.js";
import { WorkspaceRepository } from "./repository.js";
import { NativeClient, runLaunchAction } from "./nativeClient.js";
import { captureWindowState, planRestore, windowBoundsOf } from "./capture.js";
import { nowIso } from "./ids.js";

const WINDOW_MAP_KEY = "chrome_org_window_map";

/** windowId -> workspaceId for windows this extension actively manages. */
type WindowMap = Record<string, string>;

/**
 * Central coordinator between persisted workspaces and live Chrome windows.
 *
 * Ownership model: the authoritative live mapping lives in chrome.storage.session
 * (cleared on browser restart), so after a full restart nothing is considered open
 * and no unrelated window is ever adopted. Persistent `runtime` is only a hint and
 * is always reconciled against real windows + the session map.
 */
export class WorkspaceManager {
  private inFlight = new Map<string, Promise<LaunchResult>>();

  constructor(
    private readonly api: BrowserApi,
    private readonly repo: WorkspaceRepository,
    private readonly native: NativeClient,
  ) {}

  // --- ownership map helpers ---

  private async readMap(): Promise<WindowMap> {
    const raw = await this.api.sessionGet(WINDOW_MAP_KEY);
    return raw && typeof raw === "object" ? (raw as WindowMap) : {};
  }
  private async writeMap(map: WindowMap): Promise<void> {
    await this.api.sessionSet(WINDOW_MAP_KEY, map);
  }
  private async mapWindow(windowId: number, workspaceId: string): Promise<void> {
    const map = await this.readMap();
    // A window belongs to exactly one workspace; drop any prior claim.
    for (const wid of Object.keys(map)) {
      if (map[wid] === workspaceId) delete map[wid];
    }
    map[String(windowId)] = workspaceId;
    await this.writeMap(map);
  }
  private async unmapWindow(windowId: number): Promise<void> {
    const map = await this.readMap();
    delete map[String(windowId)];
    await this.writeMap(map);
  }

  async workspaceIdForWindow(windowId: number): Promise<string | undefined> {
    const map = await this.readMap();
    return map[String(windowId)];
  }

  /** Return the live window id for a workspace if it is currently managed & open. */
  private async liveWindowFor(workspaceId: string): Promise<number | undefined> {
    const map = await this.readMap();
    for (const [wid, wsId] of Object.entries(map)) {
      if (wsId !== workspaceId) continue;
      const id = Number(wid);
      const win = await this.api.getWindow(id);
      if (win) return id;
      // Stale entry -> clean it up.
      await this.unmapWindow(id);
    }
    return undefined;
  }

  // --- reconciliation ---

  /**
   * On startup / wake, validate the session map against real windows and persisted
   * runtime. Removes stale mappings and marks workspaces closed when their window
   * is gone. Never adopts an unmapped window.
   */
  async reconcile(): Promise<void> {
    const map = await this.readMap();
    const windows = await this.api.getAllNormalWindows();
    const existing = new Set(windows.map((w) => w.id));

    const cleaned: WindowMap = {};
    for (const [wid, wsId] of Object.entries(map)) {
      if (existing.has(Number(wid))) cleaned[wid] = wsId;
    }
    await this.writeMap(cleaned);

    const openWsIds = new Set(Object.values(cleaned));
    const workspaces = await this.repo.getAll();
    for (const ws of workspaces) {
      const shouldBeOpen = openWsIds.has(ws.id);
      const liveWindowId = shouldBeOpen
        ? Number(Object.entries(cleaned).find(([, id]) => id === ws.id)![0])
        : undefined;
      if (ws.runtime.isOpen !== shouldBeOpen || ws.runtime.windowId !== liveWindowId) {
        await this.repo.setRuntime(ws.id, {
          isOpen: shouldBeOpen,
          ...(liveWindowId !== undefined ? { windowId: liveWindowId } : { windowId: undefined }),
        });
      }
    }
  }

  // --- creation / assignment ---

  /** Create a new workspace whose browser state is captured from an existing window. */
  async createFromWindow(
    windowId: number,
    meta: { name: string; color?: string; icon?: string; description?: string },
  ): Promise<Workspace> {
    const win = await this.api.getWindow(windowId);
    const tabs = win?.tabs ?? (await this.api.getTabs(windowId));
    const browser = captureWindowState(tabs, win ? windowBoundsOf(win) : undefined);
    const ws = await this.repo.create({ ...meta, browser });
    await this.mapWindow(windowId, ws.id);
    await this.repo.setRuntime(ws.id, {
      isOpen: true,
      windowId,
      lastOpenedAt: nowIso(),
      lastSavedAt: nowIso(),
    });
    return ws;
  }

  /** Attach an already-open window to an existing (currently closed) workspace. */
  async assignWindow(windowId: number, workspaceId: string): Promise<void> {
    await this.mapWindow(windowId, workspaceId);
    await this.saveWindow(workspaceId, "assign");
    await this.repo.setRuntime(workspaceId, {
      isOpen: true,
      windowId,
      lastOpenedAt: nowIso(),
    });
  }

  // --- launching ---

  /** Launch or focus a workspace. Rapid duplicate calls share one in-flight promise. */
  async launch(workspaceId: string): Promise<LaunchResult> {
    const existing = this.inFlight.get(workspaceId);
    if (existing) return existing;
    const p = this.doLaunch(workspaceId).finally(() => this.inFlight.delete(workspaceId));
    this.inFlight.set(workspaceId, p);
    return p;
  }

  private async doLaunch(workspaceId: string): Promise<LaunchResult> {
    const startedAt = nowIso();
    const ws = await this.repo.get(workspaceId);
    if (!ws) {
      return {
        workspaceId,
        browser: { status: "error", message: "Workspace not found" },
        actions: {},
        startedAt,
        finishedAt: nowIso(),
      };
    }

    const browser = await this.focusOrRestore(ws);
    const actions = await this.runActions(ws);

    await this.repo.setRuntime(workspaceId, { lastOpenedAt: nowIso() });
    return { workspaceId, browser, actions, startedAt, finishedAt: nowIso() };
  }

  private async focusOrRestore(ws: Workspace): Promise<ComponentResult> {
    try {
      const liveWindowId = await this.liveWindowFor(ws.id);
      if (liveWindowId !== undefined) {
        await this.api.focusWindow(liveWindowId);
        return { status: "success", message: "Focused existing window" };
      }
      return await this.restoreWindow(ws);
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  private async restoreWindow(ws: Workspace): Promise<ComponentResult> {
    const plan = planRestore(ws.browser);
    const urls = plan.restorable.map((t) => t.url);
    const win = await this.api.createWindow({
      ...(urls.length > 0 ? { url: urls } : {}),
      focused: true,
      ...(ws.browser.bounds ? { bounds: ws.browser.bounds } : {}),
    });

    // Apply pinned state and activate the intended tab.
    const createdTabs = win.tabs ?? (await this.api.getTabs(win.id));
    for (let i = 0; i < plan.restorable.length && i < createdTabs.length; i++) {
      const saved = plan.restorable[i]!;
      const tab = createdTabs[i]!;
      if (saved.pinned && tab.id !== undefined) {
        await this.api.updateTabState(tab.id, { pinned: true });
      }
    }
    const activeTab = createdTabs[plan.activeIndex];
    if (activeTab?.id !== undefined) {
      await this.api.updateTabState(activeTab.id, { active: true });
    }

    await this.mapWindow(win.id, ws.id);
    await this.repo.setRuntime(ws.id, { isOpen: true, windowId: win.id, lastOpenedAt: nowIso() });

    if (plan.skipped.length > 0) {
      return {
        status: "success",
        message: `Restored ${plan.restorable.length} tab(s); skipped ${plan.skipped.length} unsupported URL(s)`,
      };
    }
    return { status: "success", message: `Restored ${plan.restorable.length} tab(s)` };
  }

  private async runActions(ws: Workspace): Promise<Record<string, ComponentResult>> {
    const results: Record<string, ComponentResult> = {};
    await Promise.all(
      ws.launchActions.map(async (action) => {
        results[action.id] = await runLaunchAction(this.native, action);
      }),
    );
    return results;
  }

  // --- focusing a specific tab (search results) ---

  /**
   * Launch/focus a workspace, then activate the tab matching `url`. If the tab is
   * not present (e.g. workspace was just restored with filtered tabs), the window
   * is still focused.
   */
  async focusTab(workspaceId: string, url: string): Promise<LaunchResult> {
    const result = await this.launch(workspaceId);
    const windowId = await this.liveWindowFor(workspaceId);
    if (windowId !== undefined) {
      const tabs = await this.api.getTabs(windowId);
      const match = tabs.find((t) => t.url === url);
      if (match?.id !== undefined) {
        await this.api.activateTab(match.id);
        await this.api.focusWindow(windowId);
      }
    }
    return result;
  }

  // --- saving / closing ---

  /** Capture the current live window state into a workspace (debounced by caller). */
  async saveWindow(workspaceId: string, reason: string): Promise<boolean> {
    const windowId = await this.liveWindowFor(workspaceId);
    if (windowId === undefined) return false;
    const win = await this.api.getWindow(windowId);
    if (!win) return false;
    const tabs = win.tabs ?? (await this.api.getTabs(windowId));
    const browser = captureWindowState(tabs, windowBoundsOf(win));
    // Keep a recovery snapshot of the prior state before overwriting.
    const prior = await this.repo.get(workspaceId);
    if (prior && prior.browser.tabs.length > 0 && reason !== "assign") {
      await this.repo.addSnapshot(workspaceId, prior.browser, reason);
    }
    await this.repo.saveBrowserState(workspaceId, browser);
    return true;
  }

  /** Handle a managed window closing: save its state and mark the workspace closed. */
  async handleWindowRemoved(windowId: number): Promise<void> {
    const workspaceId = await this.workspaceIdForWindow(windowId);
    if (!workspaceId) return; // not one of ours -> ignore entirely
    // The window is already gone; capture from the last-known tabs is impossible,
    // so we simply mark closed. Session saving on tab events keeps state current.
    await this.unmapWindow(windowId);
    await this.repo.setRuntime(workspaceId, { isOpen: false, windowId: undefined });
  }

  /** Save then close (user-initiated). Actually closes the managed Chrome window. */
  async saveAndClose(workspaceId: string): Promise<void> {
    const windowId = await this.liveWindowFor(workspaceId);
    if (windowId !== undefined) {
      // Capture the final state while the window still exists.
      await this.saveWindow(workspaceId, "close");
      // Unmap first so the resulting windows.onRemoved event is a no-op.
      await this.unmapWindow(windowId);
      await this.repo.setRuntime(workspaceId, { isOpen: false, windowId: undefined });
      try {
        await this.api.removeWindow(windowId);
      } catch {
        // Window may already have been closed by the user; state is already correct.
      }
      return;
    }
    await this.repo.setRuntime(workspaceId, { isOpen: false, windowId: undefined });
  }
}

export { WINDOW_MAP_KEY };
