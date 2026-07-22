import { useMemo, useState } from "react";
import type { LaunchAction, LaunchActionType, Workspace } from "@chrome-org/shared";
import { rpc } from "../rpc.js";

interface Props {
  workspace: Workspace;
  onDone: () => void;
}

function blankAction(type: LaunchActionType): LaunchAction {
  const id = `act_${Math.random().toString(36).slice(2)}`;
  switch (type) {
    case "vscode":
      return { id, type, targetPath: "" };
    case "discord":
      return { id, type, channelUrl: "" };
    case "application":
      return { id, type, applicationName: "" };
    case "url":
      return { id, type, url: "" };
    case "path":
      return { id, type, path: "" };
  }
}

function validate(name: string, actions: LaunchAction[]): string | null {
  if (name.trim().length === 0) return "Workspace name is required.";
  for (const a of actions) {
    if (a.type === "vscode" && !a.targetPath.trim()) return "VS Code action needs a target path.";
    if (a.type === "discord" && !a.channelUrl.trim()) return "Discord action needs a channel URL.";
    if (a.type === "url" && !a.url.trim()) return "URL action needs a URL.";
    if (a.type === "path" && !a.path.trim()) return "Path action needs a path.";
    if (a.type === "application" && !a.applicationName?.trim() && !a.bundleId?.trim())
      return "Application action needs a name or bundle id.";
  }
  return null;
}

/** Create/edit a workspace's metadata and launch actions. No templates — fully manual. */
export function WorkspaceEditor({ workspace, onDone }: Props) {
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [color, setColor] = useState(workspace.color ?? "#4f8cff");
  const [icon, setIcon] = useState(workspace.icon ?? "");
  const [actions, setActions] = useState<LaunchAction[]>(workspace.launchActions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => validate(name, actions), [name, actions]);

  function patchAction(index: number, patch: Partial<LaunchAction>) {
    setActions((prev) =>
      prev.map((a, i) => (i === index ? ({ ...a, ...patch } as LaunchAction) : a)),
    );
  }
  function move(index: number, dir: -1 | 1) {
    setActions((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  async function save() {
    const err = validate(name, actions);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    const res = await rpc({
      type: "updateWorkspace",
      id: workspace.id,
      patch: {
        name: name.trim(),
        description: description.trim() || undefined,
        color,
        icon: icon.trim() || undefined,
        launchActions: actions,
      },
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <div className="editor">
      <div className="action-head">
        <button className="ghost-btn" onClick={onDone} aria-label="Back">
          ← Back
        </button>
        <button className="primary-btn" onClick={save} disabled={saving || !!validationError}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="field">
        <label htmlFor="ws-name">Name</label>
        <input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="ws-desc">Description</label>
        <textarea
          id="ws-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <div className="field" style={{ flex: "0 0 90px" }}>
          <label htmlFor="ws-color">Color</label>
          <input
            id="ws-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ws-icon">Icon (emoji, optional)</label>
          <input
            id="ws-icon"
            value={icon}
            maxLength={4}
            onChange={(e) => setIcon(e.target.value)}
          />
        </div>
      </div>

      <div className="section-title">Launch actions</div>
      {actions.map((a, i) => (
        <div className="action-item" key={a.id}>
          <div className="action-head">
            <select
              value={a.type}
              aria-label="Action type"
              onChange={(e) =>
                setActions((prev) =>
                  prev.map((x, idx) =>
                    idx === i ? blankAction(e.target.value as LaunchActionType) : x,
                  ),
                )
              }
            >
              <option value="vscode">VS Code</option>
              <option value="discord">Discord</option>
              <option value="application">Application</option>
              <option value="url">URL</option>
              <option value="path">File / Folder</option>
            </select>
            <div className="row-buttons">
              <button className="icon-btn" onClick={() => move(i, -1)} aria-label="Move up">
                ↑
              </button>
              <button className="icon-btn" onClick={() => move(i, 1)} aria-label="Move down">
                ↓
              </button>
              <button
                className="icon-btn"
                onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove action"
              >
                ✕
              </button>
            </div>
          </div>

          <input
            placeholder="Label (optional)"
            value={a.label ?? ""}
            onChange={(e) => patchAction(i, { label: e.target.value })}
          />

          {a.type === "vscode" && (
            <input
              placeholder="/absolute/path/to/folder or .code-workspace"
              value={a.targetPath}
              onChange={(e) => patchAction(i, { targetPath: e.target.value })}
            />
          )}
          {a.type === "discord" && (
            <input
              placeholder="https://discord.com/channels/…"
              value={a.channelUrl}
              onChange={(e) => patchAction(i, { channelUrl: e.target.value })}
            />
          )}
          {a.type === "application" && (
            <>
              <input
                placeholder="Application name (e.g. Discord)"
                value={a.applicationName ?? ""}
                onChange={(e) => patchAction(i, { applicationName: e.target.value })}
              />
              <input
                placeholder="Bundle id (optional, e.g. com.hnc.Discord)"
                value={a.bundleId ?? ""}
                onChange={(e) => patchAction(i, { bundleId: e.target.value })}
              />
            </>
          )}
          {a.type === "url" && (
            <>
              <input
                placeholder="https://…"
                value={a.url}
                onChange={(e) => patchAction(i, { url: e.target.value })}
              />
              <input
                placeholder="Preferred app (optional, e.g. Safari)"
                value={a.preferredApplication ?? ""}
                onChange={(e) => patchAction(i, { preferredApplication: e.target.value })}
              />
            </>
          )}
          {a.type === "path" && (
            <input
              placeholder="/absolute/path/to/file-or-folder"
              value={a.path}
              onChange={(e) => patchAction(i, { path: e.target.value })}
            />
          )}
        </div>
      ))}

      <div className="row-buttons">
        <button
          className="ghost-btn"
          onClick={() => setActions((p) => [...p, blankAction("vscode")])}
        >
          + Add action
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {validationError && !error && <div className="error-text">{validationError}</div>}
    </div>
  );
}
