import { describe, it, expect } from "vitest";
import { search, fuzzyScore, flattenResults, folderName } from "../src/domain/search.js";
import type { Workspace } from "@chrome-org/shared";

function ws(partial: Partial<Workspace> & { id: string; name: string }): Workspace {
  return {
    description: undefined,
    browser: { tabs: [], activeTabIndex: 0 },
    launchActions: [],
    runtime: { isOpen: false },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  } as Workspace;
}

const workspaces: Workspace[] = [
  ws({
    id: "1",
    name: "Blockchain",
    description: "web3 research",
    browser: {
      tabs: [
        {
          url: "https://github.com/me/chain",
          title: "GitHub - chain repo",
          pinned: true,
          index: 0,
        },
        { url: "https://docs.solana.com", title: "Solana Docs", pinned: false, index: 1 },
      ],
      activeTabIndex: 0,
    },
    launchActions: [
      { id: "a1", type: "vscode", targetPath: "/Users/me/code/chain-project", label: "Chain repo" },
      { id: "a2", type: "discord", channelUrl: "https://discord.com/channels/1/2" },
    ],
    runtime: { isOpen: true, lastOpenedAt: "2026-07-20T00:00:00Z" },
  }),
  ws({
    id: "2",
    name: "LeetCode",
    browser: {
      tabs: [{ url: "https://leetcode.com/problems", title: "Problems", pinned: false, index: 0 }],
      activeTabIndex: 0,
    },
    runtime: { isOpen: false, lastOpenedAt: "2026-07-21T00:00:00Z" },
  }),
  ws({ id: "3", name: "Job Applying" }),
];

describe("fuzzyScore", () => {
  it("matches subsequences", () => {
    expect(fuzzyScore("blk", "Blockchain")).not.toBeNull();
    expect(fuzzyScore("xyz", "Blockchain")).toBeNull();
  });
  it("scores exact and prefix matches higher", () => {
    const exact = fuzzyScore("leetcode", "LeetCode")!;
    const prefix = fuzzyScore("leet", "LeetCode")!;
    const loose = fuzzyScore("lc", "LeetCode")!;
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(loose);
  });
});

describe("folderName", () => {
  it("extracts the last path segment", () => {
    expect(folderName("/Users/me/code/chain-project")).toBe("chain-project");
    expect(folderName("/Users/me/work/app.code-workspace")).toBe("app");
  });
});

describe("search", () => {
  it("returns all workspaces (recent first) for an empty query, no tab noise", () => {
    const r = search(workspaces, "");
    // Sorted by lastOpenedAt desc: LeetCode(21) > Blockchain(20) > Job(none)
    expect(r.workspaces.map((w) => w.workspaceName)).toEqual([
      "LeetCode",
      "Blockchain",
      "Job Applying",
    ]);
    expect(r.tabs).toHaveLength(0);
    expect(r.actions).toHaveLength(0);
  });

  it("matches workspace names", () => {
    const r = search(workspaces, "leet");
    expect(r.workspaces[0]?.workspaceName).toBe("LeetCode");
  });

  it("matches by description", () => {
    const r = search(workspaces, "web3");
    expect(r.workspaces.some((w) => w.workspaceName === "Blockchain")).toBe(true);
  });

  it("matches tab titles", () => {
    const r = search(workspaces, "solana");
    expect(r.tabs[0]?.url).toBe("https://docs.solana.com");
  });

  it("matches tab URLs", () => {
    const r = search(workspaces, "leetcode.com");
    expect(r.tabs.some((t) => t.url?.includes("leetcode.com"))).toBe(true);
  });

  it("matches launch actions including vscode folder name", () => {
    const r = search(workspaces, "chain-project");
    expect(r.actions.some((a) => a.actionId === "a1")).toBe(true);
  });

  it("provides a stable flatten order: workspaces, tabs, actions", () => {
    const r = search(workspaces, "chain");
    const flat = flattenResults(r);
    const kinds = flat.map((x) => x.kind);
    const firstTab = kinds.indexOf("tab");
    const firstWs = kinds.indexOf("workspace");
    if (firstWs !== -1 && firstTab !== -1) expect(firstWs).toBeLessThan(firstTab);
  });
});
