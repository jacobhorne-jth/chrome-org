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

  const checkHealth = useCallback(async () => {
    const res = await rpc({ type: "healthCheck" });
    if (res.ok) setHealth({ ok: res.data.ok, message: res.data.message });
    else setHealth({ ok: false, message: res.error });
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    const replace = window.confirm("Replace ALL current workspaces with this backup? Cancel to merge.");
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
        <input
          className="search-input"
          placeholder="Search… (⌘K)"
          onFocus={() => setPaletteOpen(true)}
          readOnly
          aria-label="Open command palette"
        />
        <button className="icon-btn" title="New from current window" onClick={createFromWindow}>
          ＋win
        </button>
        <button className="icon-btn" title="New empty workspace" onClick={createEmpty}>
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

function OverflowMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
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
