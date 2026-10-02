import { describe, expect, it } from "vite-plus/test";

import { emptyGhostTooltip, shouldClaimSurfaceLauncherKey } from "./RightPanelTabs.logic";

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
