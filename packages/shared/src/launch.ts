/** Per-component result of a workspace launch. Partial failures are never hidden. */

export type ComponentStatus = "success" | "error" | "fallback" | "skipped";

export interface ComponentResult {
  status: ComponentStatus;
  message?: string;
}

export interface LaunchResult {
  workspaceId: string;
  browser: ComponentResult;
  /** Keyed by launch-action id. */
  actions: Record<string, ComponentResult>;
  startedAt: string;
  finishedAt: string;
}

export function overallStatus(result: LaunchResult): ComponentStatus {
  const all = [result.browser, ...Object.values(result.actions)];
  if (all.some((r) => r.status === "error")) return "error";
  if (all.some((r) => r.status === "fallback")) return "fallback";
  return "success";
}
