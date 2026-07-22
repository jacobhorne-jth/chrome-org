import { useEffect, useMemo, useRef, useState } from "react";
import type { Workspace } from "@chrome-org/shared";
import { search, flattenResults, type SearchResult } from "../domain/search.js";

interface Props {
  workspaces: Workspace[];
  onClose: () => void;
  onPick: (result: SearchResult) => void;
}

/**
 * Keyboard-first command palette. Fuzzy searches workspaces, tabs, and actions,
 * groups results, and supports arrow/enter/escape with a trapped focus loop.
 */
export function CommandPalette({ workspaces, onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => search(workspaces, query), [workspaces, query]);
  const flat = useMemo(() => flattenResults(grouped), [grouped]);

  useEffect(() => {
    // When the palette is opened via a keyboard command, the side panel can mount
    // before it actually has window focus, so a single focus() call is dropped.
    // Focus the window, focus the input now, and retry once on the next frame.
    const focusInput = () => inputRef.current?.focus();
    window.focus();
    focusInput();
    const raf = requestAnimationFrame(focusInput);
    const timer = window.setTimeout(focusInput, 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    const activeEl = listRef.current?.querySelector(".result.active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = flat[selected];
      if (pick) onPick(pick);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let flatIndex = -1;
  const renderGroup = (label: string, items: SearchResult[]) => {
    if (items.length === 0) return null;
    return (
      <div role="group" aria-label={label}>
        <div className="group-label">{label}</div>
        {items.map((r) => {
          flatIndex++;
          const idx = flatIndex;
          return (
            <div
              key={`${r.kind}-${r.workspaceId}-${r.url ?? r.actionId ?? "ws"}-${idx}`}
              className={`result ${idx === selected ? "active" : ""}`}
              role="option"
              aria-selected={idx === selected}
              onMouseEnter={() => setSelected(idx)}
              onClick={() => onPick(r)}
            >
              <span className="kind-chip">{r.kind}</span>
              <span className="r-title">{r.title}</span>
              {r.subtitle ? <span className="r-sub">{r.subtitle}</span> : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-label="Command palette" aria-modal="true">
        <input
          ref={inputRef}
          autoFocus
          className="palette-search"
          placeholder="Search workspaces, tabs, actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          aria-label="Search"
          aria-activedescendant={flat[selected] ? `result-${selected}` : undefined}
        />
        <div className="palette-results" ref={listRef} role="listbox">
          {flat.length === 0 ? (
            <div className="empty" style={{ marginTop: 16 }}>
              No matches
            </div>
          ) : (
            <>
              {renderGroup("Workspaces", grouped.workspaces)}
              {renderGroup("Tabs", grouped.tabs)}
              {renderGroup("Actions", grouped.actions)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
