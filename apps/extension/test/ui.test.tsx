import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandPalette } from "../src/ui/CommandPalette.js";
import { WorkspaceRow } from "../src/ui/WorkspaceRow.js";
import type { Workspace } from "@chrome-org/shared";

// Minimal chrome stub for components that import rpc (WorkspaceRow).
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    sendMessage: vi.fn(async () => ({ ok: true, data: [] })),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

afterEach(cleanup);

function makeWorkspaces(): Workspace[] {
  return [
    {
      id: "1",
      name: "Blockchain",
      description: "web3",
      browser: {
        tabs: [
          { url: "https://github.com/x", title: "GitHub", pinned: true, index: 0 },
          { url: "https://solana.com", title: "Solana", pinned: false, index: 1 },
        ],
        activeTabIndex: 0,
      },
      launchActions: [{ id: "a1", type: "vscode", targetPath: "/Users/me/chain" }],
      runtime: { isOpen: false },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "2",
      name: "LeetCode",
      browser: {
        tabs: [{ url: "https://leetcode.com", title: "LeetCode", pinned: false, index: 0 }],
        activeTabIndex: 0,
      },
      launchActions: [],
      runtime: { isOpen: true, lastOpenedAt: "2026-07-21T00:00:00Z" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];
}

describe("CommandPalette", () => {
  it("filters as the user types and highlights the first result", () => {
    render(<CommandPalette workspaces={makeWorkspaces()} onClose={() => {}} onPick={() => {}} />);
    const input = screen.getByLabelText("Search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "leet" } });
    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toContain("LeetCode");
    expect(options[0]?.className).toContain("active");
  });

  it("moves selection with arrow keys and launches on Enter", () => {
    const onPick = vi.fn();
    render(<CommandPalette workspaces={makeWorkspaces()} onClose={() => {}} onPick={onPick} />);
    const input = screen.getByLabelText("Search");
    fireEvent.change(input, { target: { value: "co" } }); // matches multiple
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette workspaces={makeWorkspaces()} onClose={onClose} onPick={() => {}} />);
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("finds a saved tab and returns a tab result on pick", () => {
    const onPick = vi.fn();
    render(<CommandPalette workspaces={makeWorkspaces()} onClose={() => {}} onPick={onPick} />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "solana" } });
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tab", url: "https://solana.com" }),
    );
  });
});

describe("WorkspaceRow", () => {
  it("does not show the tab list by default (keeps UI compact)", () => {
    const [ws] = makeWorkspaces();
    render(
      <WorkspaceRow workspace={ws!} onLaunch={() => {}} onEdit={() => {}} onChanged={() => {}} />,
    );
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.getByText(/2 tabs/)).toBeTruthy();
  });

  it("expands the tab list only when the tab count is clicked", () => {
    const [ws] = makeWorkspaces();
    render(
      <WorkspaceRow workspace={ws!} onLaunch={() => {}} onEdit={() => {}} onChanged={() => {}} />,
    );
    fireEvent.click(screen.getByText(/2 tabs/));
    expect(screen.getByText(/GitHub/)).toBeTruthy();
  });

  it("shows Open for a closed workspace and Focus for an open one", () => {
    const wss = makeWorkspaces();
    const { rerender } = render(
      <WorkspaceRow
        workspace={wss[0]!}
        onLaunch={() => {}}
        onEdit={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("Open")).toBeTruthy();
    rerender(
      <WorkspaceRow
        workspace={wss[1]!}
        onLaunch={() => {}}
        onEdit={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(screen.getByText("Focus")).toBeTruthy();
  });
});
