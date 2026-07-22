import { createRealBrowserApi } from "../domain/browser.js";
import { WorkspaceRepository } from "../domain/repository.js";
import { NativeClient } from "../domain/nativeClient.js";
import { WorkspaceManager } from "../domain/manager.js";
import { DebouncedSaver } from "../domain/saver.js";
import type { RpcRequest, RpcResult } from "../rpc.js";

/**
 * Event-driven MV3 service worker. It owns the domain singletons and translates
 * Chrome events + UI RPC into domain operations. There are no timers or polling;
 * the worker sleeps between events and reconciles on wake.
 */

const api = createRealBrowserApi();
const repo = new WorkspaceRepository(api);
const native = new NativeClient(api);
const manager = new WorkspaceManager(api, repo, native);
const saver = new DebouncedSaver((id, reason) => manager.saveWindow(id, reason), 1500);

function broadcastDataChanged(): void {
  chrome.runtime.sendMessage({ type: "dataChanged" }).catch(() => {
    /* no UI open; ignore */
  });
}

async function currentWindowId(): Promise<number | undefined> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    return win.id;
  } catch {
    return undefined;
  }
}

// --- RPC dispatch ---

async function dispatch(request: RpcRequest): Promise<RpcResult<RpcRequest["type"]>> {
  switch (request.type) {
    case "list":
      return { ok: true, data: await repo.getAll() };
    case "get":
      return { ok: true, data: (await repo.get(request.id)) ?? null };
    case "createEmpty": {
      const ws = await repo.create(request.meta);
      broadcastDataChanged();
      return { ok: true, data: ws };
    }
    case "createFromCurrentWindow": {
      const windowId = await currentWindowId();
      if (windowId === undefined) return { ok: false, error: "No active Chrome window found" };
      const ws = await manager.createFromWindow(windowId, request.meta);
      broadcastDataChanged();
      return { ok: true, data: ws };
    }
    case "assignCurrentWindow": {
      const windowId = await currentWindowId();
      if (windowId === undefined) return { ok: false, error: "No active Chrome window found" };
      await manager.assignWindow(windowId, request.workspaceId);
      broadcastDataChanged();
      return { ok: true, data: { ok: true } };
    }
    case "updateWorkspace": {
      const updated = await repo.update(request.id, request.patch);
      broadcastDataChanged();
      return { ok: true, data: updated ?? null };
    }
    case "deleteWorkspace": {
      await repo.delete(request.id);
      broadcastDataChanged();
      return { ok: true, data: { ok: true } };
    }
    case "launch": {
      const result = await manager.launch(request.id);
      broadcastDataChanged();
      return { ok: true, data: result };
    }
    case "focusTab": {
      const result = await manager.focusTab(request.workspaceId, request.url);
      broadcastDataChanged();
      return { ok: true, data: result };
    }
    case "saveNow": {
      const saved = await manager.saveWindow(request.id, "manual");
      broadcastDataChanged();
      return { ok: true, data: { saved } };
    }
    case "saveAndClose": {
      await saver.flush(request.id, "close").catch(() => {});
      await manager.saveAndClose(request.id);
      broadcastDataChanged();
      return { ok: true, data: { ok: true } };
    }
    case "getSnapshots":
      return { ok: true, data: await repo.getSnapshots(request.id) };
    case "restoreSnapshot": {
      const ws = await repo.restoreSnapshot(request.id, request.snapshotId);
      broadcastDataChanged();
      return { ok: true, data: ws ?? null };
    }
    case "exportData":
      return { ok: true, data: { json: await repo.exportJson() } };
    case "importData": {
      try {
        const imported = await repo.importJson(request.json, request.mode);
        broadcastDataChanged();
        return { ok: true, data: { imported } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    case "healthCheck":
      return { ok: true, data: await native.healthCheck() };
    default: {
      const _never: never = request;
      return { ok: false, error: `Unknown request ${JSON.stringify(_never)}` };
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Ignore our own broadcast/UI-control events.
  if (!message || typeof message !== "object" || !("type" in message)) return;
  const type = (message as { type: string }).type;
  if (type === "dataChanged" || type === "openPalette") return;

  dispatch(message as RpcRequest)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  return true; // keep the message channel open for the async response
});

// --- Lifecycle: reconcile on install / browser start / worker wake ---

chrome.runtime.onInstalled.addListener(() => {
  void manager.reconcile();
});
chrome.runtime.onStartup.addListener(() => {
  void manager.reconcile();
});
// Reconcile once when the worker first loads (covers worker-restart wake).
void manager.reconcile();

// --- Window/tab events -> debounced session saving ---

async function scheduleSaveForWindow(windowId: number, reason: string): Promise<void> {
  const workspaceId = await manager.workspaceIdForWindow(windowId);
  if (workspaceId) saver.schedule(workspaceId, reason);
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.windowId !== undefined) void scheduleSaveForWindow(tab.windowId, "tab-created");
});
chrome.tabs.onRemoved.addListener((_tabId, info) => {
  if (!info.isWindowClosing) void scheduleSaveForWindow(info.windowId, "tab-removed");
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.pinned !== undefined) {
    if (tab.windowId !== undefined) void scheduleSaveForWindow(tab.windowId, "tab-updated");
  }
});
chrome.tabs.onMoved.addListener((_tabId, info) => {
  void scheduleSaveForWindow(info.windowId, "tab-moved");
});
chrome.tabs.onAttached.addListener((_tabId, info) => {
  void scheduleSaveForWindow(info.newWindowId, "tab-attached");
});
chrome.tabs.onDetached.addListener((_tabId, info) => {
  void scheduleSaveForWindow(info.oldWindowId, "tab-detached");
});
chrome.tabs.onActivated.addListener((info) => {
  void scheduleSaveForWindow(info.windowId, "tab-activated");
});

// Window closed -> save (already-debounced) state and mark closed.
chrome.windows.onRemoved.addListener((windowId) => {
  void manager.handleWindowRemoved(windowId).then(broadcastDataChanged);
});

// Window bounds changes (move/resize) when the API is available.
if (chrome.windows.onBoundsChanged) {
  chrome.windows.onBoundsChanged.addListener((win) => {
    if (win.id !== undefined) void scheduleSaveForWindow(win.id, "bounds-changed");
  });
}

// --- Toolbar + keyboard commands ---

chrome.runtime.onInstalled.addListener(() => {
  // Open the side panel when the toolbar icon is clicked.
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// IMPORTANT: chrome.sidePanel.open() must be called synchronously inside the
// user gesture. The onCommand event hands us the active tab, so we can open the
// panel immediately without any `await` (which would consume the gesture and
// make open() silently fail).
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-command-palette" && command !== "open-side-panel") return;

  const windowId = tab?.windowId;

  // Set a short-lived flag first (fire-and-forget) so a freshly-opened panel can
  // open its palette on mount, even before its message listener is ready.
  if (command === "open-command-palette") {
    void chrome.storage.session?.set({ pending_open_palette: Date.now() });
  }

  if (windowId === undefined || !chrome.sidePanel?.open) return;

  chrome.sidePanel
    .open({ windowId })
    .then(() => {
      if (command === "open-command-palette") {
        // Also message the panel in case it was already open.
        chrome.runtime.sendMessage({ type: "openPalette" }).catch(() => {});
      }
    })
    .catch(() => {
      /* panel may already be open; the message/flag path still applies */
      if (command === "open-command-palette") {
        chrome.runtime.sendMessage({ type: "openPalette" }).catch(() => {});
      }
    });
});

export {};
