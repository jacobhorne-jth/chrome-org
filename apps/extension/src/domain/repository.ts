import {
  MAX_SNAPSHOTS_PER_WORKSPACE,
  SCHEMA_VERSION,
  emptyState,
  importSchema,
  migrateState,
  type PersistedState,
  type RecoverySnapshot,
  type Workspace,
  type WorkspaceBrowserState,
  type LaunchAction,
} from "@chrome-org/shared";
import type { BrowserApi } from "./browser.js";
import { newId, nowIso } from "./ids.js";

export const STORAGE_KEY = "chrome_org_state";

export interface NewWorkspaceInput {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  browser?: WorkspaceBrowserState;
  launchActions?: LaunchAction[];
}

function emptyBrowserState(): WorkspaceBrowserState {
  return { tabs: [], activeTabIndex: 0 };
}

/**
 * Persistence gateway for all workspace data. Reads/writes a single versioned
 * document in chrome.storage.local, running migrations on load so older data is
 * never destroyed. All mutations reload-modify-persist to stay consistent even if
 * multiple contexts (side panel + service worker) write concurrently.
 */
export class WorkspaceRepository {
  constructor(private readonly api: BrowserApi) {}

  async load(): Promise<PersistedState> {
    const raw = await this.api.storageGet(STORAGE_KEY);
    if (raw === undefined) return emptyState();
    return migrateState(raw);
  }

  private async persist(state: PersistedState): Promise<void> {
    await this.api.storageSet(STORAGE_KEY, state);
  }

  async getAll(): Promise<Workspace[]> {
    return (await this.load()).workspaces;
  }

  async get(id: string): Promise<Workspace | undefined> {
    return (await this.load()).workspaces.find((w) => w.id === id);
  }

  async create(input: NewWorkspaceInput): Promise<Workspace> {
    const state = await this.load();
    const ts = nowIso();
    const workspace: Workspace = {
      id: newId(),
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      ...(input.icon ? { icon: input.icon } : {}),
      ...(input.color ? { color: input.color } : {}),
      browser: input.browser ?? emptyBrowserState(),
      launchActions: input.launchActions ?? [],
      runtime: { isOpen: false },
      createdAt: ts,
      updatedAt: ts,
    };
    state.workspaces.push(workspace);
    await this.persist(state);
    return workspace;
  }

  /** Apply a shallow patch to a workspace and bump updatedAt. */
  async update(id: string, patch: Partial<Omit<Workspace, "id">>): Promise<Workspace | undefined> {
    const state = await this.load();
    const idx = state.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return undefined;
    const current = state.workspaces[idx]!;
    const updated: Workspace = { ...current, ...patch, id, updatedAt: nowIso() };
    state.workspaces[idx] = updated;
    await this.persist(state);
    return updated;
  }

  /** Replace only the runtime block (open/closed, windowId, timestamps). */
  async setRuntime(id: string, patch: Partial<Workspace["runtime"]>): Promise<void> {
    const state = await this.load();
    const idx = state.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return;
    const current = state.workspaces[idx]!;
    state.workspaces[idx] = {
      ...current,
      runtime: { ...current.runtime, ...patch },
      updatedAt: nowIso(),
    };
    await this.persist(state);
  }

  /** Save a captured browser state to a workspace (used by session saving). */
  async saveBrowserState(id: string, browser: WorkspaceBrowserState): Promise<void> {
    const state = await this.load();
    const idx = state.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return;
    const current = state.workspaces[idx]!;
    state.workspaces[idx] = {
      ...current,
      browser,
      runtime: { ...current.runtime, lastSavedAt: nowIso() },
      updatedAt: nowIso(),
    };
    await this.persist(state);
  }

  async delete(id: string): Promise<void> {
    const state = await this.load();
    state.workspaces = state.workspaces.filter((w) => w.id !== id);
    delete state.snapshots[id];
    await this.persist(state);
  }

  // --- Recovery snapshots (rolling history, newest first) ---

  async addSnapshot(id: string, browser: WorkspaceBrowserState, reason: string): Promise<void> {
    const state = await this.load();
    if (!state.workspaces.some((w) => w.id === id)) return;
    const snapshot: RecoverySnapshot = {
      id: newId("snap"),
      workspaceId: id,
      createdAt: nowIso(),
      reason,
      browser,
    };
    const list = state.snapshots[id] ?? [];
    list.unshift(snapshot);
    state.snapshots[id] = list.slice(0, MAX_SNAPSHOTS_PER_WORKSPACE);
    await this.persist(state);
  }

  async getSnapshots(id: string): Promise<RecoverySnapshot[]> {
    return (await this.load()).snapshots[id] ?? [];
  }

  async restoreSnapshot(id: string, snapshotId: string): Promise<Workspace | undefined> {
    const state = await this.load();
    const snapshot = (state.snapshots[id] ?? []).find((s) => s.id === snapshotId);
    if (!snapshot) return undefined;
    const idx = state.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) return undefined;
    const current = state.workspaces[idx]!;
    const updated: Workspace = {
      ...current,
      browser: snapshot.browser,
      updatedAt: nowIso(),
    };
    state.workspaces[idx] = updated;
    await this.persist(state);
    return updated;
  }

  // --- Export / import ---

  async exportJson(): Promise<string> {
    const state = await this.load();
    return JSON.stringify({ ...state, exportedAt: nowIso() }, null, 2);
  }

  /**
   * Validate and import a JSON backup. Throws with an actionable message on
   * malformed input. Runtime state is reset (nothing is "open" after import).
   */
  async importJson(json: string, mode: "replace" | "merge" = "replace"): Promise<number> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("Import failed: file is not valid JSON.");
    }
    const result = importSchema.safeParse(parsed);
    if (!result.success) {
      const first = result.error.issues[0];
      throw new Error(
        `Import failed: ${first ? `${first.path.join(".")} ${first.message}` : "invalid backup shape"}`,
      );
    }
    const incoming = result.data.workspaces.map((w) => ({
      ...w,
      runtime: { isOpen: false as const },
    }));

    const state = mode === "replace" ? emptyState() : await this.load();
    if (mode === "replace") {
      state.workspaces = incoming;
      state.snapshots = result.data.snapshots;
    } else {
      const existingIds = new Set(state.workspaces.map((w) => w.id));
      for (const w of incoming) {
        if (existingIds.has(w.id)) w.id = newId();
        state.workspaces.push(w);
      }
    }
    state.schemaVersion = SCHEMA_VERSION;
    await this.persist(state);
    return incoming.length;
  }
}
