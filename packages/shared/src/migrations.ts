import { SCHEMA_VERSION, emptyState, type PersistedState } from "./types.js";

/**
 * Forward-only migrations for persisted state. Each entry migrates from version
 * `n` to `n + 1`. This guarantees future schema changes never destroy existing
 * workspaces: unknown/old documents are upgraded step by step.
 */
type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, Migration> = {
  // Example scaffold for the first real migration (v1 -> v2):
  // 1: (doc) => ({ ...doc, schemaVersion: 2, newField: [] }),
};

/**
 * Normalize an arbitrary stored blob into a valid current-version PersistedState.
 * Never throws on unknown shapes; falls back to sensible defaults so a corrupt or
 * partial document cannot brick the extension.
 */
export function migrateState(raw: unknown): PersistedState {
  if (raw == null || typeof raw !== "object") {
    return emptyState();
  }

  let doc = raw as Record<string, unknown>;
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;

  // If there's no version but there is a workspaces array, treat it as v1-shaped.
  if (version === 0 && Array.isArray(doc.workspaces)) {
    version = 1;
    doc = { ...doc, schemaVersion: 1 };
  }

  while (version < SCHEMA_VERSION) {
    const migrate = migrations[version];
    if (!migrate) break;
    doc = migrate(doc);
    version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : version + 1;
  }

  const workspaces = Array.isArray(doc.workspaces) ? doc.workspaces : [];
  const snapshots =
    doc.snapshots && typeof doc.snapshots === "object" && !Array.isArray(doc.snapshots)
      ? (doc.snapshots as PersistedState["snapshots"])
      : {};

  return {
    schemaVersion: SCHEMA_VERSION,
    workspaces: workspaces as PersistedState["workspaces"],
    snapshots,
  };
}
