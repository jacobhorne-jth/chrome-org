import type { LaunchAction, LaunchResult, RecoverySnapshot, Workspace } from "@chrome-org/shared";

/**
 * Typed RPC contract between the side panel (and command palette) UI and the
 * background service worker. The UI never touches chrome.windows/tabs directly;
 * all privileged operations go through these messages.
 */

export interface WorkspaceMeta {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
}

export type RpcRequest =
  | { type: "list" }
  | { type: "get"; id: string }
  | { type: "createEmpty"; meta: WorkspaceMeta }
  | { type: "createFromCurrentWindow"; meta: WorkspaceMeta }
  | { type: "assignCurrentWindow"; workspaceId: string }
  | {
      type: "updateWorkspace";
      id: string;
      patch: Partial<Pick<Workspace, "name" | "description" | "icon" | "color">> & {
        launchActions?: LaunchAction[];
      };
    }
  | { type: "deleteWorkspace"; id: string }
  | { type: "launch"; id: string }
  | { type: "focusTab"; workspaceId: string; url: string }
  | { type: "saveNow"; id: string }
  | { type: "saveAndClose"; id: string }
  | { type: "getSnapshots"; id: string }
  | { type: "restoreSnapshot"; id: string; snapshotId: string }
  | { type: "exportData" }
  | { type: "importData"; json: string; mode: "replace" | "merge" }
  | { type: "healthCheck" };

export type RpcResponseMap = {
  list: Workspace[];
  get: Workspace | null;
  createEmpty: Workspace;
  createFromCurrentWindow: Workspace;
  assignCurrentWindow: { ok: true };
  updateWorkspace: Workspace | null;
  deleteWorkspace: { ok: true };
  launch: LaunchResult;
  focusTab: LaunchResult;
  saveNow: { saved: boolean };
  saveAndClose: { ok: true };
  getSnapshots: RecoverySnapshot[];
  restoreSnapshot: Workspace | null;
  exportData: { json: string };
  importData: { imported: number };
  healthCheck: { ok: boolean; version?: number; message: string };
};

export type RpcResult<T extends RpcRequest["type"]> =
  { ok: true; data: RpcResponseMap[T] } | { ok: false; error: string };

/** Send a typed RPC to the background service worker. */
export async function rpc<T extends RpcRequest>(request: T): Promise<RpcResult<T["type"]>> {
  try {
    const res = (await chrome.runtime.sendMessage(request)) as RpcResult<T["type"]>;
    if (res == null) return { ok: false, error: "No response from background worker" };
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Message the background broadcasts to open UIs when data changes. */
export interface DataChangedEvent {
  type: "dataChanged";
}

/** Message the background sends to the side panel to focus the command palette. */
export interface OpenPaletteEvent {
  type: "openPalette";
}
