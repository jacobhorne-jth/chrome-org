import type { WindowBounds } from "@chrome-org/shared";

/**
 * A minimal, testable abstraction over the Chrome extension APIs the domain layer
 * needs. The real implementation delegates to `chrome.*`; tests inject a fake.
 * Keeping this narrow means domain logic never touches global `chrome` directly.
 */

export interface TabInfo {
  id?: number;
  windowId: number;
  index: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
}

export interface WindowInfo {
  id: number;
  focused: boolean;
  /** Chrome window type; we only manage "normal" windows. */
  type?: string;
  tabs?: TabInfo[];
  top?: number;
  left?: number;
  width?: number;
  height?: number;
}

export interface CreateWindowOptions {
  url?: string[];
  focused?: boolean;
  bounds?: WindowBounds;
}

export interface BrowserApi {
  // Persistent storage
  storageGet(key: string): Promise<unknown>;
  storageSet(key: string, value: unknown): Promise<void>;

  // Ephemeral session storage (may be unavailable; callers tolerate undefined)
  sessionGet(key: string): Promise<unknown>;
  sessionSet(key: string, value: unknown): Promise<void>;

  // Windows
  createWindow(options: CreateWindowOptions): Promise<WindowInfo>;
  getWindow(windowId: number): Promise<WindowInfo | null>;
  getAllNormalWindows(): Promise<WindowInfo[]>;
  focusWindow(windowId: number): Promise<void>;
  updateWindowBounds(windowId: number, bounds: WindowBounds): Promise<void>;

  // Tabs
  getTabs(windowId: number): Promise<TabInfo[]>;
  createTab(options: {
    windowId: number;
    url: string;
    pinned?: boolean;
    active?: boolean;
    index?: number;
  }): Promise<TabInfo>;
  activateTab(tabId: number): Promise<void>;

  // Native messaging (one-shot request/response)
  sendNativeMessage(hostName: string, message: unknown): Promise<unknown>;
}

/** Promisified wrapper over the real Chrome APIs. */
export function createRealBrowserApi(): BrowserApi {
  const c = chrome;
  return {
    async storageGet(key) {
      const res = await c.storage.local.get(key);
      return res[key];
    },
    async storageSet(key, value) {
      await c.storage.local.set({ [key]: value });
    },
    async sessionGet(key) {
      // storage.session may be unavailable in some contexts; guard it.
      if (!c.storage.session) return undefined;
      const res = await c.storage.session.get(key);
      return res[key];
    },
    async sessionSet(key, value) {
      if (!c.storage.session) return;
      await c.storage.session.set({ [key]: value });
    },
    async createWindow(options) {
      const win = await c.windows.create({
        url: options.url,
        focused: options.focused ?? true,
        ...(options.bounds
          ? {
              top: Math.max(0, Math.round(options.bounds.top)),
              left: Math.max(0, Math.round(options.bounds.left)),
              width: Math.max(200, Math.round(options.bounds.width)),
              height: Math.max(200, Math.round(options.bounds.height)),
            }
          : {}),
      });
      return toWindowInfo(win);
    },
    async getWindow(windowId) {
      try {
        const win = await c.windows.get(windowId, { populate: true });
        return toWindowInfo(win);
      } catch {
        return null;
      }
    },
    async getAllNormalWindows() {
      const wins = await c.windows.getAll({ populate: true, windowTypes: ["normal"] });
      return wins.map(toWindowInfo);
    },
    async focusWindow(windowId) {
      await c.windows.update(windowId, { focused: true, drawAttention: true });
    },
    async updateWindowBounds(windowId, bounds) {
      await c.windows.update(windowId, {
        top: Math.round(bounds.top),
        left: Math.round(bounds.left),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
    },
    async getTabs(windowId) {
      const tabs = await c.tabs.query({ windowId });
      return tabs.map(toTabInfo);
    },
    async createTab(options) {
      const tab = await c.tabs.create({
        windowId: options.windowId,
        url: options.url,
        pinned: options.pinned,
        active: options.active ?? false,
        ...(options.index !== undefined ? { index: options.index } : {}),
      });
      return toTabInfo(tab);
    },
    async activateTab(tabId) {
      await c.tabs.update(tabId, { active: true });
    },
    async sendNativeMessage(hostName, message) {
      return await c.runtime.sendNativeMessage(hostName, message as object);
    },
  };
}

function toTabInfo(tab: chrome.tabs.Tab): TabInfo {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    url: tab.url,
    pendingUrl: tab.pendingUrl,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned,
    active: tab.active,
  };
}

function toWindowInfo(win: chrome.windows.Window): WindowInfo {
  return {
    id: win.id ?? -1,
    focused: win.focused ?? false,
    type: win.type,
    tabs: win.tabs?.map(toTabInfo),
    top: win.top,
    left: win.left,
    width: win.width,
    height: win.height,
  };
}
