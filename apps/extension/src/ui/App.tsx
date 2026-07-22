import { useCallback, useEffect, useRef, useState } from "react";
import type { LaunchResult } from "@chrome-org/shared";
import { overallStatus } from "@chrome-org/shared";
import { rpc } from "../rpc.js";
import { useWorkspaces, useOpenPaletteSignal } from "./useWorkspaces.js";
import { CommandPalette } from "./CommandPalette.js";
import { WorkspaceEditor } from "./WorkspaceEditor.js";
import { WorkspaceRow } from "./WorkspaceRow.js";
import type { SearchResult } from "../domain/search.js";

type View = { mode: "list" } | { mode: "edit"; id: string };

export function App() {
  const { workspaces, loading, error } = useWorkspaces();
  const [view, setView] = useState<View>({ mode: "list" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [health, setHealth] = useState<{ ok: boolean; message: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useOpenPaletteSignal(openPalette);

  // Track palette state in a ref so the global key handler always reads the latest.
  const paletteOpenRef = useRef(paletteOpen);
  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  const checkHealth = useCallback(async () => {
    const res = await rpc({ type: "healthCheck" });
    if (res.ok) setHealth({ ok: res.data.ok, message: res.data.message });
    else setHealth({ ok: false, message: res.error });
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  // If the panel was just opened by the "open command palette" shortcut, a flag
  // is waiting for us — open the palette immediately, then clear it.
  useEffect(() => {
    chrome.storage.session?.get("pending_open_palette").then((r) => {
      const ts = (r as { pending_open_palette?: number }).pending_open_palette;
      if (ts && Date.now() - ts < 5000) {
        setPaletteOpen(true);
        void chrome.storage.session.remove("pending_open_palette");
      }
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "Escape") {
        if (paletteOpenRef.current) {
          setPaletteOpen(false);
        } else if (view.mode === "list") {
          // Nothing open in-panel — close the side panel itself.
          e.preventDefault();
          window.close();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view.mode]);

  // Pull keyboard focus into the panel by focusing the first workspace row once
  // it renders. Without this, a freshly-opened side panel has no focus, so Tab
  // and Escape keystrokes never reach it (they go to the underlying page).
  const didInitialFocusRef = useRef(false);
  useEffect(() => {
    if (view.mode !== "list" || paletteOpen || workspaces.length === 0) return;
    if (didInitialFocusRef.current) return;
    // Only take focus if nothing in the panel is focused yet (don't steal it).
    if (document.activeElement && document.activeElement !== document.body) return;
    const firstRow = document.querySelector<HTMLElement>('.row[role="button"]');
    if (firstRow) {
      firstRow.focus();
      didInitialFocusRef.current = true;
    }
  }, [view.mode, paletteOpen, workspaces.length]);

  // Remember which row was last focused so we can restore it after the panel
  // loses and regains focus (e.g. switching to another window and back).
  const lastFocusedRowRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function trackFocus(e: FocusEvent) {
      const t = e.target as HTMLElement | null;
      if (t && t.classList?.contains("row")) lastFocusedRowRef.current = t;
    }
    // When the panel becomes active again but has no focused control, pull focus
    // back to the last row so keyboard (Tab/arrows/Esc) works without a click.
    function reclaim() {
      if (document.visibilityState !== "visible") return;
      if (paletteOpenRef.current || view.mode !== "list") return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      const remembered = lastFocusedRowRef.current;
      const target =
        remembered && document.contains(remembered)
          ? remembered
          : document.querySelector<HTMLElement>('.row[role="button"]');
      target?.focus();
    }
    document.addEventListener("focusin", trackFocus);
    window.addEventListener("focus", reclaim);
    document.addEventListener("visibilitychange", reclaim);
    // Moving the mouse into the panel also reclaims focus, so keyboard (Esc/Tab)
    // works again after returning from another window without needing a click.
    document.addEventListener("pointermove", reclaim);
    return () => {
      document.removeEventListener("focusin", trackFocus);
      window.removeEventListener("focus", reclaim);
      document.removeEventListener("visibilitychange", reclaim);
      document.removeEventListener("pointermove", reclaim);
    };
  }, [view.mode]);

  function flashToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  }

  function describeLaunch(result: LaunchResult): string {
    const status = overallStatus(result);
    const parts: string[] = [`browser: ${result.browser.status}`];
    for (const [, r] of Object.entries(result.actions)) parts.push(r.status);
    return `Launch ${status}. ${parts.join(", ")}`;
  }

  async function launch(id: string) {
    const res = await rpc({ type: "launch", id });
    if (res.ok) flashToast(describeLaunch(res.data));
    else flashToast(`Launch failed: ${res.error}`);
  }

  async function onPickResult(r: SearchResult) {
    setPaletteOpen(false);
    if (r.kind === "tab" && r.url) {
      const res = await rpc({ type: "focusTab", workspaceId: r.workspaceId, url: r.url });
      if (res.ok) flashToast(describeLaunch(res.data));
    } else {
      await launch(r.workspaceId);
    }
  }

  async function createEmpty() {
    const name = window.prompt("New workspace name:");
    if (!name) return;
    const res = await rpc({ type: "createEmpty", meta: { name } });
    if (res.ok) setView({ mode: "edit", id: res.data.id });
    else flashToast(res.error);
  }

  async function createFromWindow() {
    const name = window.prompt("Name for a workspace from the current window:");
    if (!name) return;
    const res = await rpc({ type: "createFromCurrentWindow", meta: { name } });
    if (res.ok) flashToast(`Created "${res.data.name}" from current window`);
    else flashToast(res.error);
  }

  async function exportData() {
    const res = await rpc({ type: "exportData" });
    if (!res.ok) return flashToast(res.error);
    const blob = new Blob([res.data.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chrome-org-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const replace = window.confirm(
      "Replace ALL current workspaces with this backup? Cancel to merge.",
    );
    const res = await rpc({ type: "importData", json: text, mode: replace ? "replace" : "merge" });
    if (res.ok) flashToast(`Imported ${res.data.imported} workspace(s)`);
    else flashToast(res.error);
  }

  if (view.mode === "edit") {
    const ws = workspaces.find((w) => w.id === view.id);
    if (!ws) return <div className="empty">Workspace not found.</div>;
    return <WorkspaceEditor workspace={ws} onDone={() => setView({ mode: "list" })} />;
  }

  return (
    <div className="app">
      <div className="toolbar">
        <button
          className="search-input"
          style={{ textAlign: "left", color: "var(--text-muted)" }}
          onClick={() => setPaletteOpen(true)}
          aria-label="Open command palette"
          tabIndex={-1}
        >
          Search… (⌘K)
        </button>
        <button
          className="icon-btn"
          title="New from current window"
          onClick={createFromWindow}
          tabIndex={-1}
        >
          ＋win
        </button>
        <button
          className="icon-btn"
          title="New empty workspace"
          onClick={createEmpty}
          tabIndex={-1}
        >
          ＋
        </button>
        <OverflowMenu
          items={[
            { label: "Export backup (JSON)", onClick: exportData },
            { label: "Import backup…", onClick: () => importInputRef.current?.click() },
            { label: "Re-check native companion", onClick: checkHealth },
          ]}
        />
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={onImportFile}
        />
      </div>

      <div className="list">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : error ? (
          <div className="empty error-text">{error}</div>
        ) : workspaces.length === 0 ? (
          <div className="empty">
            No workspaces yet.
            <br />
            Use ＋win to capture your current Chrome window, or ＋ for an empty one.
          </div>
        ) : (
          workspaces.map((ws) => (
            <WorkspaceRow
              key={ws.id}
              workspace={ws}
              onLaunch={() => launch(ws.id)}
              onEdit={() => setView({ mode: "edit", id: ws.id })}
              onChanged={flashToast}
            />
          ))
        )}
      </div>

      <div className="status-line">
        <span>
          {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"}
        </span>
        <button
          className="overflow-btn"
          onClick={checkHealth}
          title={health?.message ?? "Checking…"}
          tabIndex={-1}
        >
          companion:{" "}
          <span className={health?.ok ? "status-ok" : "status-bad"}>
            {health ? (health.ok ? "connected" : "not connected") : "…"}
          </span>
        </button>
      </div>

      {toast && <div className="launch-toast">{toast}</div>}

      {paletteOpen && (
        <CommandPalette
          workspaces={workspaces}
          onClose={() => setPaletteOpen(false)}
          onPick={onPickResult}
        />
      )}
    </div>
  );
}

function OverflowMenu({
  items,
}: {
  items: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div style={{ position: "relative" }}>
      <button
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="More"
        tabIndex={-1}
      >
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={it.danger ? "danger" : ""}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
