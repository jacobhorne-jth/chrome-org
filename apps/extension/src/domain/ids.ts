/** ID generation that works both in the extension (crypto) and tests. */
export function newId(prefix = "ws"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
