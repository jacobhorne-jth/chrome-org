import { z } from "zod";

/**
 * Native-messaging protocol shared by the extension and the macOS companion.
 *
 * Security posture: the companion NEVER executes arbitrary shell commands. It only
 * accepts a fixed set of typed actions, each validated by these schemas before any
 * process is spawned. All spawning uses argument arrays (never a shell string).
 */

export const NATIVE_PROTOCOL_VERSION = 1 as const;

/** Characters that must never appear in a path or app name we hand to the OS. */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r\t*?![\]\\]/;

/** Reject obvious shell-injection attempts in free-form string fields. */
const safeString = (label: string) =>
  z
    .string()
    .min(1, `${label} must not be empty`)
    .refine((v) => !SHELL_METACHARACTERS.test(v), {
      message: `${label} contains disallowed characters`,
    });

/**
 * A filesystem path. We forbid shell metacharacters and require an absolute-ish
 * path (starts with "/" or "~"). Existence is checked at execution time by the host.
 */
export const pathSchema = z
  .string()
  .min(1, "path must not be empty")
  .max(4096, "path is too long")
  .refine((v) => v.startsWith("/") || v.startsWith("~"), {
    message: "path must be absolute (start with / or ~)",
  })
  .refine((v) => !/[;&|`$\n\r]/.test(v), {
    message: "path contains disallowed shell metacharacters",
  })
  .refine((v) => !v.includes(".."), {
    message: "path must not contain '..' segments",
  });

/** A URL we are willing to open. Restrict to a safe allowlist of schemes. */
export const urlSchema = z
  .string()
  .min(1)
  .max(8192)
  .superRefine((v, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(v);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "malformed URL" });
      return;
    }
    const allowed = ["http:", "https:", "discord:", "vscode:", "file:", "mailto:"];
    if (!allowed.includes(parsed.protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `URL scheme "${parsed.protocol}" is not allowed`,
      });
    }
  });

const baseAction = { requestId: z.string().min(1).optional() };

export const healthCheckRequest = z.object({
  ...baseAction,
  action: z.literal("healthCheck"),
});

export const openVscodeWorkspaceRequest = z.object({
  ...baseAction,
  action: z.literal("openVscodeWorkspace"),
  targetPath: pathSchema,
});

export const openApplicationRequest = z.object({
  ...baseAction,
  action: z.literal("openApplication"),
  applicationName: safeString("applicationName").optional(),
  bundleId: safeString("bundleId").optional(),
});

export const focusApplicationRequest = z.object({
  ...baseAction,
  action: z.literal("focusApplication"),
  applicationName: safeString("applicationName").optional(),
  bundleId: safeString("bundleId").optional(),
});

export const openUrlRequest = z.object({
  ...baseAction,
  action: z.literal("openUrl"),
  url: urlSchema,
});

export const openUrlInApplicationRequest = z.object({
  ...baseAction,
  action: z.literal("openUrlInApplication"),
  url: urlSchema,
  applicationName: safeString("applicationName"),
});

export const openPathRequest = z.object({
  ...baseAction,
  action: z.literal("openPath"),
  path: pathSchema,
});

export const openDiscordRequest = z.object({
  ...baseAction,
  action: z.literal("openDiscord"),
  channelUrl: urlSchema,
});

export const nativeRequestSchema = z.discriminatedUnion("action", [
  healthCheckRequest,
  openVscodeWorkspaceRequest,
  openApplicationRequest,
  focusApplicationRequest,
  openUrlRequest,
  openUrlInApplicationRequest,
  openPathRequest,
  openDiscordRequest,
]);

export type NativeRequest = z.infer<typeof nativeRequestSchema>;
export type NativeAction = NativeRequest["action"];

export type ResponseStatus = "success" | "error" | "fallback";

export interface NativeResponse {
  requestId?: string;
  action: NativeAction;
  status: ResponseStatus;
  message?: string;
  /** Present on healthCheck. */
  version?: number;
  hostName?: string;
  /** Extra structured detail (e.g. which app was focused). */
  detail?: Record<string, unknown>;
}

export const nativeResponseSchema: z.ZodType<NativeResponse> = z.object({
  requestId: z.string().optional(),
  action: z.string() as unknown as z.ZodType<NativeAction>,
  status: z.enum(["success", "error", "fallback"]),
  message: z.string().optional(),
  version: z.number().optional(),
  hostName: z.string().optional(),
  detail: z.record(z.unknown()).optional(),
});

export function isShellSafe(value: string): boolean {
  return !SHELL_METACHARACTERS.test(value);
}
