import { z } from "zod";
import { SCHEMA_VERSION } from "./types.js";

/** Runtime validators for persisted data — used to validate imported backups. */

export const windowBoundsSchema = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});

export const savedTabSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  faviconUrl: z.string().optional(),
  pinned: z.boolean(),
  index: z.number().int().nonnegative(),
});

export const launchActionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("vscode"),
    targetPath: z.string().min(1),
    label: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("discord"),
    channelUrl: z.string().min(1),
    label: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("application"),
    applicationName: z.string().optional(),
    bundleId: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("url"),
    url: z.string().min(1),
    preferredApplication: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("path"),
    path: z.string().min(1),
    label: z.string().optional(),
  }),
]);

export const workspaceBrowserStateSchema = z.object({
  tabs: z.array(savedTabSchema),
  activeTabIndex: z.number().int().nonnegative(),
  bounds: windowBoundsSchema.optional(),
});

export const workspaceRuntimeSchema = z.object({
  windowId: z.number().optional(),
  isOpen: z.boolean(),
  lastOpenedAt: z.string().optional(),
  lastSavedAt: z.string().optional(),
});

export const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  browser: workspaceBrowserStateSchema,
  launchActions: z.array(launchActionSchema),
  runtime: workspaceRuntimeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const recoverySnapshotSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  createdAt: z.string(),
  reason: z.string(),
  browser: workspaceBrowserStateSchema,
});

export const persistedStateSchema = z.object({
  schemaVersion: z.number(),
  workspaces: z.array(workspaceSchema),
  snapshots: z.record(z.array(recoverySnapshotSchema)),
});

/** Import payloads may omit snapshots and version; normalize leniently. */
export const importSchema = z.object({
  schemaVersion: z.number().optional().default(SCHEMA_VERSION),
  workspaces: z.array(workspaceSchema),
  snapshots: z.record(z.array(recoverySnapshotSchema)).optional().default({}),
});
