import type {
  BrowserApi,
  CreateWindowOptions,
  TabInfo,
  WindowInfo,
} from "../src/domain/browser.js";
import type { WindowBounds } from "@chrome-org/shared";

interface FakeTab extends TabInfo {}
interface FakeWindow {
  id: number;
  focused: boolean;
  type: string;
  bounds: WindowBounds;
  tabs: FakeTab[];
}

export interface NativeHandler {
  (message: unknown): unknown | Promise<unknown>;
}

/**
 * In-memory implementation of BrowserApi that simulates Chrome windows/tabs and
 * storage. Lets domain tests exercise real launch/focus/reconcile logic without a
 * browser. Deterministic auto-incrementing window/tab ids.
 */
export class FakeBrowser implements BrowserApi {
  private local = new Map<string, unknown>();
  private session = new Map<string, unknown>();
  private windows = new Map<number, FakeWindow>();
  private nextWindowId = 100;
  private nextTabId = 1000;
  public nativeHandler: NativeHandler | null = null;
  public sendNativeCalls: unknown[] = [];

  // --- test helpers ---
  seedWindow(tabs: Partial<FakeTab>[], opts: { focused?: boolean; type?: string } = {}): WindowInfo {
    const id = this.nextWindowId++;
    const win: FakeWindow = {
      id,
      focused: opts.focused ?? false,
      type: opts.type ?? "normal",
      bounds: { top: 0, left: 0, width: 1200, height: 800 },
      tabs: tabs.map((t, i) => this.makeTab(id, i, t)),
    };
    this.windows.set(id, win);
    return this.snapshotWindow(win);
  }

  listWindowIds(): number[] {
    return [...this.windows.keys()];
  }

  closeWindow(id: number): void {
    this.windows.delete(id);
  }

  private makeTab(windowId: number, index: number, t: Partial<FakeTab>): FakeTab {
    return {
      id: t.id ?? this.nextTabId++,
      windowId,
      index,
      url: t.url,
      pendingUrl: t.pendingUrl,
      title: t.title,
      favIconUrl: t.favIconUrl,
      pinned: t.pinned ?? false,
      active: t.active ?? index === 0,
    };
  }

  private snapshotWindow(win: FakeWindow): WindowInfo {
    return {
      id: win.id,
      focused: win.focused,
      type: win.type,
      tabs: win.tabs.map((t) => ({ ...t })),
      top: win.bounds.top,
      left: win.bounds.left,
      width: win.bounds.width,
      height: win.bounds.height,
    };
  }

  // --- BrowserApi impl ---
  async storageGet(key: string): Promise<unknown> {
    return this.local.get(key);
  }
  async storageSet(key: string, value: unknown): Promise<void> {
    // Emulate structured-clone persistence.
    this.local.set(key, JSON.parse(JSON.stringify(value)));
  }
  async sessionGet(key: string): Promise<unknown> {
    return this.session.get(key);
  }
  async sessionSet(key: string, value: unknown): Promise<void> {
    this.session.set(key, JSON.parse(JSON.stringify(value)));
  }

  async createWindow(options: CreateWindowOptions): Promise<WindowInfo> {
    const id = this.nextWindowId++;
    const urls = options.url ?? ["about:blank"];
    const win: FakeWindow = {
      id,
      focused: options.focused ?? true,
      type: "normal",
      bounds: options.bounds ?? { top: 50, left: 50, width: 1200, height: 800 },
      tabs: urls.map((url, i) => this.makeTab(id, i, { url, active: i === 0 })),
    };
    // Mark others unfocused.
    if (win.focused) for (const w of this.windows.values()) w.focused = false;
    this.windows.set(id, win);
    return this.snapshotWindow(win);
  }

  async getWindow(windowId: number): Promise<WindowInfo | null> {
    const win = this.windows.get(windowId);
    return win ? this.snapshotWindow(win) : null;
  }

  async getAllNormalWindows(): Promise<WindowInfo[]> {
    return [...this.windows.values()]
      .filter((w) => w.type === "normal")
      .map((w) => this.snapshotWindow(w));
  }

  async focusWindow(windowId: number): Promise<void> {
    for (const w of this.windows.values()) w.focused = w.id === windowId;
  }

  async updateWindowBounds(windowId: number, bounds: WindowBounds): Promise<void> {
    const win = this.windows.get(windowId);
    if (win) win.bounds = bounds;
  }

  async getTabs(windowId: number): Promise<TabInfo[]> {
    const win = this.windows.get(windowId);
    return win ? win.tabs.map((t) => ({ ...t })) : [];
  }

  async createTab(options: {
    windowId: number;
    url: string;
    pinned?: boolean;
    active?: boolean;
    index?: number;
  }): Promise<TabInfo> {
    const win = this.windows.get(options.windowId);
    if (!win) throw new Error(`no window ${options.windowId}`);
    const index = options.index ?? win.tabs.length;
    const tab = this.makeTab(options.windowId, index, {
      url: options.url,
      pinned: options.pinned,
      active: options.active,
    });
    win.tabs.splice(index, 0, tab);
    win.tabs.forEach((t, i) => (t.index = i));
    if (options.active) win.tabs.forEach((t) => (t.active = t.id === tab.id));
    return { ...tab };
  }

  async activateTab(tabId: number): Promise<void> {
    for (const win of this.windows.values()) {
      const found = win.tabs.find((t) => t.id === tabId);
      if (found) {
        win.tabs.forEach((t) => (t.active = t.id === tabId));
        win.focused = true;
        for (const other of this.windows.values()) if (other.id !== win.id) other.focused = false;
        return;
      }
    }
  }

  async updateTabState(
    tabId: number,
    state: { pinned?: boolean; active?: boolean },
  ): Promise<void> {
    for (const win of this.windows.values()) {
      const found = win.tabs.find((t) => t.id === tabId);
      if (!found) continue;
      if (state.pinned !== undefined) found.pinned = state.pinned;
      if (state.active) win.tabs.forEach((t) => (t.active = t.id === tabId));
      return;
    }
  }

  async sendNativeMessage(_hostName: string, message: unknown): Promise<unknown> {
    this.sendNativeCalls.push(message);
    if (!this.nativeHandler) throw new Error("native host not installed");
    return await this.nativeHandler(message);
  }
}
