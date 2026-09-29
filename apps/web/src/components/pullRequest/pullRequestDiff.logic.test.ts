import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  isFileDiffCollapsed,
  isLineInFileDiff,
  toggleFileDiffFoldForViewed,
} from "./pullRequestDiff.logic";

/** Only the hunk ranges matter here; the viewer fills the rest in when it renders. */
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

  it("places a line inside a hunk, on the side that hunk counts", () => {
    expect(isLineInFileDiff(file, "right", 12)).toBe(true);
    expect(isLineInFileDiff(file, "left", 11)).toBe(true);
  });

  it("includes the first line of a hunk and excludes the one past its last", () => {
    // The boundaries are where an off-by-one would quietly move a conversation between lists.
    expect(isLineInFileDiff(file, "right", 10)).toBe(true);
    expect(isLineInFileDiff(file, "right", 14)).toBe(true);
    expect(isLineInFileDiff(file, "right", 15)).toBe(false);
    expect(isLineInFileDiff(file, "left", 9)).toBe(false);
    expect(isLineInFileDiff(file, "left", 12)).toBe(true);
    expect(isLineInFileDiff(file, "left", 13)).toBe(false);
  });

  it("keeps the two sides apart, since one line number means two lines", () => {
    // The second hunk is a pure insertion: it deletes nothing, so nothing is on its left.
    expect(isLineInFileDiff(file, "right", 43)).toBe(true);
    expect(isLineInFileDiff(file, "left", 40)).toBe(false);
  });

  it("places nothing in a file whose hunks the host withheld", () => {
    expect(isLineInFileDiff(fileWithHunks([]), "right", 1)).toBe(false);
  });
});

describe("isFileDiffCollapsed", () => {
  const NO_TOGGLES: ReadonlySet<string> = new Set();

  it("opens every file when nothing is folded by default", () => {
    expect(isFileDiffCollapsed("a.ts", "none", false, NO_TOGGLES)).toBe(false);
    expect(isFileDiffCollapsed("b.ts", "none", true, NO_TOGGLES)).toBe(false);
  });

  it("folds every file when everything is folded by default", () => {
    expect(isFileDiffCollapsed("a.ts", "all", false, NO_TOGGLES)).toBe(true);
    expect(isFileDiffCollapsed("b.ts", "all", true, NO_TOGGLES)).toBe(true);
  });

  it("folds only the ticked-off files under the viewed default", () => {
    expect(isFileDiffCollapsed("a.ts", "viewed", true, NO_TOGGLES)).toBe(true);
    expect(isFileDiffCollapsed("b.ts", "viewed", false, NO_TOGGLES)).toBe(false);
  });

  it("keeps a file the reader folded closed as the next slice arrives", () => {
    // The file keys grow with every slice, so the answer for one already folded must not depend
    // on how many of them there are by then.
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
  it("puts a file away when it is ticked off", () => {
    // Files start expanded, so ticking one off is the case that has somewhere to go.
    expect([...toggleFileDiffFoldForViewed("a.ts", true, "none", new Set())]).toEqual(["a.ts"]);
  });

  it("brings a file back when the tick is taken off", () => {
    expect([...toggleFileDiffFoldForViewed("a.ts", false, "none", new Set(["a.ts"]))]).toEqual([]);
  });

  it("leaves the fold alone when it already says what the tick does", () => {
    const folded = new Set(["a.ts"]);
    expect(toggleFileDiffFoldForViewed("a.ts", true, "none", folded)).toBe(folded);
  });

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

  it("touches only the file that was ticked", () => {
    const toggled = new Set(["a.ts", "b.ts"]);
    expect([...toggleFileDiffFoldForViewed("a.ts", false, "none", toggled)]).toEqual(["b.ts"]);
  });
});
