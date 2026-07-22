import { useCallback, useEffect, useState } from "react";
import type { Workspace } from "@chrome-org/shared";
import { rpc } from "../rpc.js";

/** Loads workspaces and keeps them fresh when the background broadcasts changes. */
export function useWorkspaces(): {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await rpc({ type: "list" });
    if (res.ok) {
      setWorkspaces(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const listener = (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === "dataChanged"
      ) {
        void refresh();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  return { workspaces, loading, error, refresh };
}

/** Subscribe to the background's request to open the command palette. */
export function useOpenPaletteSignal(onOpen: () => void): void {
  useEffect(() => {
    const listener = (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === "openPalette"
      ) {
        onOpen();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [onOpen]);
}
