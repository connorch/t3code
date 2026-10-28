import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  hasTranscript: false,
  projectFilter: null,
  isPinned: false,
  worktreeSiblingCount: 0,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables copy-transcript until the thread detail is loaded", () => {
    const findTranscript = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state)
        .find((item) => item.id === "copy")
        ?.children?.find((child) => child.id === "copy-transcript");
    expect(findTranscript(baseState)?.disabled).toBe(true);
    expect(findTranscript({ ...baseState, hasTranscript: true })?.disabled).toBe(false);
  });

  it("disables archive while the thread is running", () => {
    const archiveItem = buildThreadActionMenuItems({ ...baseState, isRunning: true }).find(
      (item) => item.id === "archive",
    );
    expect(archiveItem?.disabled).toBe(true);
  });
});

describe("worktree card labels", () => {
  it("names the worktree when the pin fans out to siblings", () => {
    const labels = (state: ThreadActionMenuState) =>
      buildThreadActionMenuItems(state)
        .filter((item) => item.id === "pin" || item.id === "unpin")
        .map((item) => item.label);
    expect(labels({ ...baseState, worktreeSiblingCount: 2 })).toEqual(["Pin worktree"]);
    expect(labels({ ...baseState, worktreeSiblingCount: 2, isPinned: true })).toEqual([
      "Unpin worktree",
    ]);
    expect(labels(baseState)).toEqual(["Pin thread"]);
  });
});
