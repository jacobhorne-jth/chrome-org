import type { Workspace } from "@chrome-org/shared";

export type SearchResultKind = "workspace" | "tab" | "action";

export interface SearchResult {
  kind: SearchResultKind;
  workspaceId: string;
  workspaceName: string;
  /** Primary label shown in the result row. */
  title: string;
  /** Secondary muted text (URL, action type, etc.). */
  subtitle?: string;
  score: number;
  /** For tab results: the URL to activate. */
  url?: string;
  /** For action results: the launch-action id. */
  actionId?: string;
}

export interface GroupedResults {
  workspaces: SearchResult[];
  tabs: SearchResult[];
  actions: SearchResult[];
}

/**
 * Case-insensitive subsequence fuzzy match. Returns a score in [0,1], or null if
 * `query` is not a subsequence of `text`. Rewards contiguous runs, word-boundary
 * starts, and prefix matches so the best candidates float to the top.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query.length === 0) return 0.0001;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  let qi = 0;
  let score = 0;
  let runBonus = 0;
  let prevMatchIndex = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let charScore = 1;
      if (ti === prevMatchIndex + 1) {
        runBonus += 1;
        charScore += runBonus; // contiguous run
      } else {
        runBonus = 0;
      }
      const prevChar = ti > 0 ? t[ti - 1] : " ";
      if (
        ti === 0 ||
        prevChar === " " ||
        prevChar === "/" ||
        prevChar === "-" ||
        prevChar === "."
      ) {
        charScore += 2; // word-boundary bonus
      }
      score += charScore;
      prevMatchIndex = ti;
      qi++;
    }
  }

  if (qi < q.length) return null; // not all query chars matched

  // Normalize against an ideal (fully contiguous, boundary-aligned) match.
  const maxPer = 1 + q.length + 2;
  const ideal = q.length * maxPer;
  let normalized = score / ideal;
  if (t.startsWith(q)) normalized += 0.5; // strong prefix boost
  if (t === q) normalized += 1; // exact match
  return Math.min(1, normalized);
}

/** Pick the best fuzzy score across several candidate strings. */
function bestScore(query: string, candidates: (string | undefined)[]): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const s = fuzzyScore(query, c);
    if (s !== null && (best === null || s > best)) best = s;
  }
  return best;
}

/** Derive a display name for a vscode target path (last path segment). */
export function folderName(p: string): string {
  const cleaned = p.replace(/\/+$/, "");
  const seg = cleaned.split("/").pop() ?? cleaned;
  return seg.replace(/\.code-workspace$/, "");
}

/**
 * Search all workspaces and their saved tabs/actions. An empty query returns all
 * workspaces (most-recently-opened first) and no tab/action noise, keeping the
 * default palette compact.
 */
export function search(workspaces: Workspace[], rawQuery: string): GroupedResults {
  const query = rawQuery.trim();
  const results: GroupedResults = { workspaces: [], tabs: [], actions: [] };

  if (query.length === 0) {
    results.workspaces = [...workspaces]
      .sort((a, b) => (b.runtime.lastOpenedAt ?? "").localeCompare(a.runtime.lastOpenedAt ?? ""))
      .map((w) => ({
        kind: "workspace" as const,
        workspaceId: w.id,
        workspaceName: w.name,
        title: w.name,
        subtitle: w.description,
        score: 1,
      }));
    return results;
  }

  for (const w of workspaces) {
    const wsScore = bestScore(query, [w.name, w.description]);
    if (wsScore !== null) {
      results.workspaces.push({
        kind: "workspace",
        workspaceId: w.id,
        workspaceName: w.name,
        title: w.name,
        subtitle: w.description,
        score: wsScore,
      });
    }

    for (const tab of w.browser.tabs) {
      const tScore = bestScore(query, [tab.title, tab.url]);
      if (tScore !== null) {
        results.tabs.push({
          kind: "tab",
          workspaceId: w.id,
          workspaceName: w.name,
          title: tab.title || tab.url,
          subtitle: tab.url,
          score: tScore,
          url: tab.url,
        });
      }
    }

    for (const action of w.launchActions) {
      const candidates: (string | undefined)[] = [action.label, action.type];
      if (action.type === "application") candidates.push(action.applicationName, action.bundleId);
      if (action.type === "vscode")
        candidates.push(folderName(action.targetPath), action.targetPath);
      if (action.type === "url") candidates.push(action.url, action.preferredApplication);
      if (action.type === "path") candidates.push(action.path, folderName(action.path));
      if (action.type === "discord") candidates.push(action.channelUrl);
      const aScore = bestScore(query, candidates);
      if (aScore !== null) {
        results.actions.push({
          kind: "action",
          workspaceId: w.id,
          workspaceName: w.name,
          title: action.label || labelForAction(action),
          subtitle: `${action.type} · ${w.name}`,
          score: aScore,
          actionId: action.id,
        });
      }
    }
  }

  const byScore = (a: SearchResult, b: SearchResult) => b.score - a.score;
  results.workspaces.sort(byScore);
  results.tabs.sort(byScore);
  results.actions.sort(byScore);
  // Keep tab/action lists compact.
  results.tabs = results.tabs.slice(0, 12);
  results.actions = results.actions.slice(0, 8);
  return results;
}

function labelForAction(action: Workspace["launchActions"][number]): string {
  switch (action.type) {
    case "vscode":
      return `VS Code: ${folderName(action.targetPath)}`;
    case "discord":
      return "Discord channel";
    case "application":
      return action.applicationName ?? action.bundleId ?? "Application";
    case "url":
      return action.url;
    case "path":
      return action.path;
  }
}

/** Flatten grouped results into keyboard-navigation order (workspaces, tabs, actions). */
export function flattenResults(g: GroupedResults): SearchResult[] {
  return [...g.workspaces, ...g.tabs, ...g.actions];
}
