import { describe, it, expect } from "vitest";
import { migrateState } from "../src/migrations.js";
import { SCHEMA_VERSION } from "../src/types.js";

describe("migrateState", () => {
  it("returns empty state for null/garbage input", () => {
    expect(migrateState(null).workspaces).toEqual([]);
    expect(migrateState(42).workspaces).toEqual([]);
    expect(migrateState("nope").schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("upgrades an unversioned document that has a workspaces array", () => {
    const legacy = { workspaces: [{ id: "a", name: "Old" }] };
    const migrated = migrateState(legacy);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.workspaces).toHaveLength(1);
    expect(migrated.snapshots).toEqual({});
  });

  it("preserves a valid current-version document", () => {
    const current = {
      schemaVersion: SCHEMA_VERSION,
      workspaces: [{ id: "x", name: "Keep" }],
      snapshots: { x: [] },
    };
    const migrated = migrateState(current);
    expect(migrated.workspaces[0]?.name).toBe("Keep");
    expect(migrated.snapshots).toHaveProperty("x");
  });

  it("repairs a document with a bad snapshots field", () => {
    const broken = { schemaVersion: SCHEMA_VERSION, workspaces: [], snapshots: [1, 2, 3] };
    expect(migrateState(broken).snapshots).toEqual({});
  });
});
