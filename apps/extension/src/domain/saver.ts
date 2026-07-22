/**
 * Coalesces frequent browser events into infrequent saves. Each workspace has its
 * own debounce timer so bursts of tab activity (typing a URL, dragging tabs) result
 * in a single write. This keeps the service worker event-driven with no polling.
 */
export class DebouncedSaver {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly save: (workspaceId: string, reason: string) => Promise<unknown>,
    private readonly delayMs = 1500,
  ) {}

  schedule(workspaceId: string, reason: string): void {
    const existing = this.timers.get(workspaceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(workspaceId);
      void this.save(workspaceId, reason);
    }, this.delayMs);
    // Do not keep the event loop alive solely for a pending save (Node/test only).
    if (typeof timer === "object" && "unref" in timer) (timer as { unref: () => void }).unref();
    this.timers.set(workspaceId, timer);
  }

  /** Force an immediate save, cancelling any pending debounce. */
  async flush(workspaceId: string, reason: string): Promise<void> {
    const existing = this.timers.get(workspaceId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(workspaceId);
    }
    await this.save(workspaceId, reason);
  }

  cancel(workspaceId: string): void {
    const existing = this.timers.get(workspaceId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(workspaceId);
    }
  }

  pendingCount(): number {
    return this.timers.size;
  }
}
