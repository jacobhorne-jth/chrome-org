/**
 * Core persistent data model for chrome-org.
 *
 * IMPORTANT: A saved browser session consists ONLY of tab URLs and browser-level
 * tab/window state (order, pinned, active tab, window bounds). It intentionally
 * does NOT capture form inputs, in-page memory, unsaved text, or scroll position.
 */

/** Current persistent schema version. Bump when the shape of persisted data changes. */
export const SCHEMA_VERSION = 1 as const;

export interface WindowBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface SavedTab {
  url: string;
  title?: string;
  faviconUrl?: string;
  pinned: boolean;
  /** Position within the window, 0-based. */
  index: number;
}

export interface WorkspaceBrowserState {
  tabs: SavedTab[];
  /** Index into `tabs` of the tab that was active. Clamped on restore. */
  activeTabIndex: number;
  bounds?: WindowBounds;
}

export type LaunchActionType = "vscode" | "discord" | "application" | "url" | "path";

export interface VscodeLaunchAction {
  id: string;
  type: "vscode";
  /** Folder path or a `.code-workspace` file. */
  targetPath: string;
  label?: string;
}

export interface DiscordLaunchAction {
  id: string;
  type: "discord";
  /** A normal Discord server/channel URL (https or discord:// deep link). */
  channelUrl: string;
  label?: string;
}

export interface ApplicationLaunchAction {
  id: string;
  type: "application";
  applicationName?: string;
  bundleId?: string;
  label?: string;
}

export interface UrlLaunchAction {
  id: string;
  type: "url";
  url: string;
  /** Optional application name to open the URL in (e.g. "Safari"). */
  preferredApplication?: string;
  label?: string;
}

export interface PathLaunchAction {
  id: string;
  type: "path";
  /** A local file or directory. */
  path: string;
  label?: string;
}

export type LaunchAction =
  | VscodeLaunchAction
  | DiscordLaunchAction
  | ApplicationLaunchAction
  | UrlLaunchAction
  | PathLaunchAction;

export interface WorkspaceRuntime {
  /**
   * The Chrome window ID currently managed for this workspace. Chrome window IDs
   * are ephemeral, so this is treated as a best-effort hint and is always
   * reconciled against real windows on startup. Never persist logic that depends
   * solely on this value being valid.
   */
  windowId?: number;
  isOpen: boolean;
  lastOpenedAt?: string;
  lastSavedAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;

  browser: WorkspaceBrowserState;
  launchActions: LaunchAction[];
  runtime: WorkspaceRuntime;

  createdAt: string;
  updatedAt: string;
}

/** A rolling recovery snapshot of a workspace's browser state. */
export interface RecoverySnapshot {
  id: string;
  workspaceId: string;
  createdAt: string;
  reason: string;
  browser: WorkspaceBrowserState;
}

/** Top-level persisted document stored in chrome.storage.local. */
export interface PersistedState {
  schemaVersion: number;
  workspaces: Workspace[];
  /** Keyed by workspace id; each holds the latest N snapshots (newest first). */
  snapshots: Record<string, RecoverySnapshot[]>;
}

export const MAX_SNAPSHOTS_PER_WORKSPACE = 5;

export function emptyState(): PersistedState {
  return { schemaVersion: SCHEMA_VERSION, workspaces: [], snapshots: {} };
}
