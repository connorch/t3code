import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  isFileDiffCollapsed,
  isLineInFileDiff,
  toggleFileDiffFoldForViewed,
  unfoldFileDiff,
} from "./pullRequestDiff.logic";

function fileWithHunks(
  hunks: ReadonlyArray<{
    deletionStart: number;
    deletionCount: number;
    additionStart: number;
    additionCount: number;
  }>,
): FileDiffMetadata {
  return { name: "src/app.ts", hunks } as unknown as FileDiffMetadata;
}

describe("isLineInFileDiff", () => {
  const file = fileWithHunks([
    { deletionStart: 10, deletionCount: 3, additionStart: 10, additionCount: 5 },
    { deletionStart: 40, deletionCount: 0, additionStart: 42, additionCount: 2 },
  ]);

  it("includes the first line of a hunk and excludes the one past its last", () => {
    expect(isLineInFileDiff(file, "right", 10)).toBe(true);
    expect(isLineInFileDiff(file, "right", 14)).toBe(true);
    expect(isLineInFileDiff(file, "right", 15)).toBe(false);
    expect(isLineInFileDiff(file, "left", 9)).toBe(false);
    expect(isLineInFileDiff(file, "left", 12)).toBe(true);
    expect(isLineInFileDiff(file, "left", 13)).toBe(false);
  });

  it("keeps the two sides apart, since one line number means two lines", () => {
    expect(isLineInFileDiff(file, "right", 43)).toBe(true);
    expect(isLineInFileDiff(file, "left", 40)).toBe(false);
  });
});

describe("isFileDiffCollapsed", () => {
  const NO_TOGGLES: ReadonlySet<string> = new Set();

  it("folds only the ticked-off files under the viewed default", () => {
    expect(isFileDiffCollapsed("a.ts", "viewed", true, NO_TOGGLES)).toBe(true);
    expect(isFileDiffCollapsed("b.ts", "viewed", false, NO_TOGGLES)).toBe(false);
  });

  // regression: #9174 diffs now expand by default; a reader's fold must survive new slices
  it("keeps a file the reader folded closed as the next slice arrives", () => {
    const toggled = new Set(["b.ts"]);
    expect(isFileDiffCollapsed("b.ts", "none", false, toggled)).toBe(true);
    expect(isFileDiffCollapsed("c.ts", "none", false, toggled)).toBe(false);
  });

  it("still answers to a toggle under every default", () => {
    const toggled = new Set(["a.ts"]);
    expect(isFileDiffCollapsed("a.ts", "none", false, toggled)).toBe(true);
    expect(isFileDiffCollapsed("a.ts", "all", false, toggled)).toBe(false);
    expect(isFileDiffCollapsed("a.ts", "viewed", true, toggled)).toBe(false);
    expect(isFileDiffCollapsed("a.ts", "viewed", false, toggled)).toBe(true);
  });
});

describe("toggleFileDiffFoldForViewed", () => {
  it("moves against whatever the toolbar last asked for", () => {
    // Everything is folded, so taking the tick off has to open that one against the default.
    expect([...toggleFileDiffFoldForViewed("a.ts", false, "all", new Set())]).toEqual(["a.ts"]);
    expect(toggleFileDiffFoldForViewed("a.ts", true, "all", new Set()).size).toBe(0);
  });

  it("drops the file's own toggle under the viewed default, where the tick is the fold", () => {
    // The reader had opened this viewed file by hand; ticking it again must not flip it back
    // against its new default and leave it open.
    expect(toggleFileDiffFoldForViewed("a.ts", true, "viewed", new Set(["a.ts"])).size).toBe(0);
    expect(toggleFileDiffFoldForViewed("a.ts", false, "viewed", new Set(["a.ts"])).size).toBe(0);
    expect(toggleFileDiffFoldForViewed("a.ts", true, "viewed", new Set()).size).toBe(0);
  });
});

describe("unfoldFileDiff", () => {
  it("opens a file that its viewed tick folds, and stays open when asked again", () => {
    const once = unfoldFileDiff("a.ts", "viewed", true, new Set());
    expect(isFileDiffCollapsed("a.ts", "viewed", true, once)).toBe(false);
    expect(unfoldFileDiff("a.ts", "viewed", true, once)).toBe(once);
  });

  it("leaves an already open file alone", () => {
    const toggled = new Set<string>();
    expect(unfoldFileDiff("a.ts", "none", false, toggled)).toBe(toggled);
  });
});
