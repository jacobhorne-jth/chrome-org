import type { SavedTab, WorkspaceBrowserState, WindowBounds } from "@chrome-org/shared";
import type { TabInfo, WindowInfo } from "./browser.js";

/**
 * URL schemes that Chrome will not let an extension re-open programmatically.
 * We still SAVE these (so nothing is silently lost) but SKIP them on restore.
 */
const NON_RESTORABLE_SCHEMES = ["chrome:", "chrome-extension:", "devtools:", "edge:", "about:"];

export function isRestorableUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url === "about:blank") return true;
  try {
    const u = new URL(url);
    return !NON_RESTORABLE_SCHEMES.includes(u.protocol);
  } catch {
    return false;
  }
}

/** Best-effort URL for a tab, preferring a committed URL over a pending one. */
function tabUrl(tab: TabInfo): string {
  return tab.url && tab.url.length > 0 ? tab.url : (tab.pendingUrl ?? "");
}

/**
 * Convert a live window's tabs into a saved browser state, preserving order,
 * pinned state, and the active tab. Tabs are sorted by their Chrome index so the
 * saved `index` values are contiguous and stable.
 */
export function captureWindowState(tabs: TabInfo[], bounds?: WindowBounds): WorkspaceBrowserState {
  const sorted = [...tabs].sort((a, b) => a.index - b.index);
  const savedTabs: SavedTab[] = [];
  let activeTabIndex = 0;

  sorted.forEach((tab) => {
    const url = tabUrl(tab);
    if (!url) return;
    if (tab.active) activeTabIndex = savedTabs.length;
    savedTabs.push({
      url,
      title: tab.title,
      faviconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      index: savedTabs.length,
    });
  });

  return {
    tabs: savedTabs,
    activeTabIndex: Math.min(activeTabIndex, Math.max(0, savedTabs.length - 1)),
    ...(bounds ? { bounds } : {}),
  };
}

export function windowBoundsOf(win: WindowInfo): WindowBounds | undefined {
  if (
    win.top === undefined ||
    win.left === undefined ||
    win.width === undefined ||
    win.height === undefined
  ) {
    return undefined;
  }
  return { top: win.top, left: win.left, width: win.width, height: win.height };
}

export interface RestorePlan {
  /** Tabs that can be re-opened, in order. */
  restorable: SavedTab[];
  /** Tabs skipped because their scheme is not restorable. */
  skipped: SavedTab[];
  /** Index into `restorable` that should become active. */
  activeIndex: number;
}

/**
 * Compute what to actually restore from a saved state, filtering un-restorable
 * URLs while keeping the intended active tab pointed at a valid tab.
 */
export function planRestore(state: WorkspaceBrowserState): RestorePlan {
  const restorable: SavedTab[] = [];
  const skipped: SavedTab[] = [];
  let activeIndex = 0;

  state.tabs.forEach((tab, originalIndex) => {
    if (isRestorableUrl(tab.url)) {
      if (originalIndex === state.activeTabIndex) activeIndex = restorable.length;
      restorable.push(tab);
    } else {
      skipped.push(tab);
    }
  });

  if (restorable.length === 0) activeIndex = 0;
  else activeIndex = Math.min(activeIndex, restorable.length - 1);

  return { restorable, skipped, activeIndex };
}
