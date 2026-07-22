import { useEffect, useState } from "react";
import type { RecoverySnapshot, Workspace } from "@chrome-org/shared";
import { rpc } from "../rpc.js";
import { timeAgo, actionIcon } from "./format.js";

interface Props {
  workspace: Workspace;
  onLaunch: () => void;
  onEdit: () => void;
  onChanged: (msg: string) => void;
}

/**
 * Compact workspace row. Tab lists stay collapsed by default and only appear when
 * the user deliberately expands the row — keeping the default view uncluttered.
 */
export function WorkspaceRow({ workspace: ws, onLaunch, onEdit, onChanged }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [snapshots, setSnapshots] = useState<RecoverySnapshot[] | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const tabCount = ws.browser.tabs.length;
  const actionTypes = Array.from(new Set(ws.launchActions.map((a) => a.type)));

  async function saveNow() {
    const res = await rpc({ type: "saveNow", id: ws.id });
    onChanged(
      res.ok ? (res.data.saved ? "Saved current window" : "No open window to save") : res.error,
    );
  }
  async function saveAndClose() {
    const res = await rpc({ type: "saveAndClose", id: ws.id });
    onChanged(res.ok ? "Saved and closed" : res.error);
  }
  async function assignWindow() {
    const res = await rpc({ type: "assignCurrentWindow", workspaceId: ws.id });
    onChanged(res.ok ? "Assigned current window" : res.error);
  }
  async function del() {
    if (!window.confirm(`Delete workspace "${ws.name}"? This cannot be undone.`)) return;
    const res = await rpc({ type: "deleteWorkspace", id: ws.id });
    if (!res.ok) onChanged(res.error);
  }
  async function loadSnapshots() {
    const res = await rpc({ type: "getSnapshots", id: ws.id });
    if (res.ok) setSnapshots(res.data);
  }
  async function restore(snapshotId: string) {
    const res = await rpc({ type: "restoreSnapshot", id: ws.id, snapshotId });
    onChanged(res.ok ? "Snapshot restored" : res.error);
    setSnapshots(null);
  }

  return (
    <div>
      <div
        className="row"
        role="button"
        tabIndex={0}
        aria-label={`${ws.name}, ${ws.runtime.isOpen ? "open" : "closed"}. Press Enter to ${
          ws.runtime.isOpen ? "focus" : "open"
        }.`}
        onKeyDown={(e) => {
          // Only act when the row itself is focused, not an inner control.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onLaunch();
          }
        }}
      >
        <span
          className="swatch"
          style={ws.color ? { background: ws.color } : undefined}
          aria-hidden
        />
        <div className="row-main">
          <div className="row-name">
            {ws.icon ? <span aria-hidden>{ws.icon}</span> : null}
            <span>{ws.name}</span>
          </div>
          <div className="row-meta">
            <span className={`badge ${ws.runtime.isOpen ? "open" : "closed"}`}>
              {ws.runtime.isOpen ? "open" : "closed"}
            </span>
            <button
              className="overflow-btn"
              style={{ padding: 0 }}
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
              title="Toggle tab list"
            >
              {tabCount} tab{tabCount === 1 ? "" : "s"}
            </button>
            {actionTypes.length > 0 && (
              <span
                title={actionTypes.join(", ")}
                aria-label={`actions: ${actionTypes.join(", ")}`}
              >
                {actionTypes.map((t) => (
                  <span key={t} className="dot" style={{ marginRight: 2 }}>
                    {actionIcon(t)}
                  </span>
                ))}
              </span>
            )}
            <span>· {timeAgo(ws.runtime.lastOpenedAt)}</span>
          </div>
        </div>

        <button className="primary-btn" onClick={onLaunch} tabIndex={-1}>
          {ws.runtime.isOpen ? "Focus" : "Open"}
        </button>

        <div style={{ position: "relative" }}>
          <button
            className="overflow-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`More actions for ${ws.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={onEdit}>
                Edit / rename
              </button>
              {ws.runtime.isOpen ? (
                <>
                  <button role="menuitem" onClick={saveNow}>
                    Save now
                  </button>
                  <button role="menuitem" onClick={saveAndClose}>
                    Save &amp; close
                  </button>
                </>
              ) : (
                <button role="menuitem" onClick={assignWindow}>
                  Assign current window
                </button>
              )}
              <button role="menuitem" onClick={loadSnapshots}>
                Restore snapshot…
              </button>
              <button role="menuitem" className="danger" onClick={del}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="expand-tabs">
          {tabCount === 0 ? (
            <div className="tab-line">No saved tabs.</div>
          ) : (
            ws.browser.tabs.map((t, i) => (
              <div className="tab-line" key={i}>
                {t.pinned ? "📌 " : ""}
                {t.title || t.url}
              </div>
            ))
          )}
        </div>
      )}

      {snapshots && (
        <div className="expand-tabs">
          <div className="group-label">Recovery snapshots</div>
          {snapshots.length === 0 ? (
            <div className="tab-line">No snapshots yet.</div>
          ) : (
            snapshots.map((s) => (
              <div key={s.id} className="action-head">
                <span className="tab-line">
                  {timeAgo(s.createdAt)} · {s.browser.tabs.length} tabs · {s.reason}
                </span>
                <button className="icon-btn" onClick={() => restore(s.id)}>
                  Restore
                </button>
              </div>
            ))
          )}
          <button className="ghost-btn" onClick={() => setSnapshots(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
