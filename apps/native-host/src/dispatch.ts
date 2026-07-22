import { nativeRequestSchema, type NativeResponse } from "@chrome-org/shared";
import { executeRequest, defaultDeps, type ExecutorDeps } from "./executor.js";

/**
 * Validate an untrusted incoming message and execute it. Any validation failure
 * produces a structured error response instead of throwing, so a malformed message
 * can never crash the host or reach the executor.
 */
export async function handleMessage(
  raw: unknown,
  deps: ExecutorDeps = defaultDeps,
): Promise<NativeResponse> {
  const requestId =
    raw && typeof raw === "object" && "requestId" in raw
      ? (raw as { requestId?: unknown }).requestId
      : undefined;

  const parsed = nativeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const attempted =
      raw && typeof raw === "object" && "action" in raw
        ? String((raw as { action: unknown }).action)
        : "unknown";
    return {
      action: attempted as NativeResponse["action"],
      status: "error",
      message: `Invalid request: ${first ? `${first.path.join(".")} ${first.message}` : "schema validation failed"}`,
      ...(typeof requestId === "string" ? { requestId } : {}),
    };
  }

  try {
    const response = await executeRequest(parsed.data, deps);
    if (parsed.data.requestId) response.requestId = parsed.data.requestId;
    return response;
  } catch (err) {
    return {
      action: parsed.data.action,
      status: "error",
      message: `Host error: ${err instanceof Error ? err.message : String(err)}`,
      ...(parsed.data.requestId ? { requestId: parsed.data.requestId } : {}),
    };
  }
}
