import { describe, expect, it } from "vite-plus/test";

import {
  emptyGhostTooltip,
  iconGhostsForOpenSurfaces,
  shouldClaimSurfaceLauncherKey,
} from "./RightPanelTabs.logic";

const actions = [
  { surfaceKind: "preview" as const, multiInstance: true, label: "Browser" },
  { surfaceKind: "terminal" as const, multiInstance: true, label: "Terminal" },
  { surfaceKind: "files" as const, multiInstance: false, label: "Files" },
  { surfaceKind: "diff" as const, multiInstance: false, label: "Diff" },
  { surfaceKind: "pull-request" as const, multiInstance: false, label: "Pull request" },
  { surfaceKind: "agents" as const, multiInstance: false, label: "Agents" },
];

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    key: "t",
    target: null,
    ...overrides,
  } as KeyboardEvent;
}

describe("iconGhostsForOpenSurfaces", () => {
  it("keeps multi-instance ghosts after that surface is already open", () => {
    const ghosts = iconGhostsForOpenSurfaces(actions, ["terminal"]);
    expect(ghosts.map((action) => action.label)).toEqual([
      "Browser",
      "Terminal",
      "Files",
      "Diff",
      "Pull request",
      "Agents",
    ]);
  });

  it("drops singleton ghosts once that surface is a tab", () => {
    const ghosts = iconGhostsForOpenSurfaces(actions, ["diff", "files", "agents", "pull-request"]);
    expect(ghosts.map((action) => action.label)).toEqual(["Browser", "Terminal"]);
  });
});

describe("emptyGhostTooltip", () => {
  it("shows the description and letter shortcut for an available surface", () => {
    expect(
      emptyGhostTooltip({
        available: true,
        description: "Start a shell in this workspace.",
        disabledReason: "Available when a project is open.",
        shortcut: "T",
      }),
    ).toEqual({ label: "Start a shell in this workspace.", shortcut: "T" });
  });

  it("omits the shortcut when the surface is unavailable", () => {
    expect(
      emptyGhostTooltip({
        available: false,
        description: "Review changes in this thread.",
        disabledReason: "Diff is only available for server threads in Git repositories.",
        shortcut: "D",
      }),
    ).toEqual({
      label: "Diff is only available for server threads in Git repositories.",
      shortcut: null,
    });
  });
});

describe("shouldClaimSurfaceLauncherKey", () => {
  it("claims an unmodified letter", () => {
    expect(shouldClaimSurfaceLauncherKey(keyEvent({ key: "t" }))).toBe(true);
  });

  it("ignores modifier chords", () => {
    expect(shouldClaimSurfaceLauncherKey(keyEvent({ metaKey: true }))).toBe(false);
    expect(shouldClaimSurfaceLauncherKey(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(shouldClaimSurfaceLauncherKey(keyEvent({ altKey: true }))).toBe(false);
  });
});
