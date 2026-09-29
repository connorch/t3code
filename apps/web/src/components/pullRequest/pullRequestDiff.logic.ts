import type { FileDiffMetadata } from "@pierre/diffs";
import type { DiffFilesCollapsed, PullRequestDiffSide } from "@t3tools/contracts";

/**
 * Whether a conversation's line is really in this file's hunks.
 *
 * A thread naming a file is not the same as a thread the diff can show: its line may have moved
 * out of the change, or sit in a hunk the host withheld. Pinning it anyway would put the remark
 * against whatever code now occupies that line number, and silently dropping it would lose the
 * conversation, so the answer decides which of the two lists it belongs in.
 */
export function isLineInFileDiff(
  file: FileDiffMetadata,
  side: PullRequestDiffSide,
  line: number,
): boolean {
  return file.hunks.some((hunk) =>
    side === "left"
      ? line >= hunk.deletionStart && line < hunk.deletionStart + hunk.deletionCount
      : line >= hunk.additionStart && line < hunk.additionStart + hunk.additionCount,
  );
}

/** What the toolbar last asked of every file at once, null being the reader asking nothing yet. */
export type DiffFoldOverride = "all" | "none" | null;

const NO_TOGGLES: ReadonlySet<string> = new Set();

/**
 * Whether a file is drawn folded.
 *
 * A diff arrives a slice at a time, so the reader's own choices are kept as the difference from
 * the default rather than as the set of folded files: a file that has not loaded yet cannot be in
 * a set, and would otherwise land expanded moments after the reader folded everything. The
 * default is the saved setting until the toolbar overrides it, and under `viewed` it is the
 * file's own tick; individual files can still be toggled independently.
 */
export function isFileDiffCollapsed(
  fileKey: string,
  fold: DiffFilesCollapsed,
  viewed: boolean,
  toggledFileKeys: ReadonlySet<string>,
): boolean {
  const foldedByDefault = fold === "all" || (fold === "viewed" && viewed);
  return toggledFileKeys.has(fileKey) ? !foldedByDefault : foldedByDefault;
}

/**
 * The reader's fold choices after a file was ticked off, or put back.
 *
 * Clearing a file puts it away and un-clearing brings it back, so the tick moves the fold as if
 * the reader had pressed the chevron themselves, which keeps folding a difference from the
 * default, and so keeps "collapse all" from ticking anything off. Under `viewed` the tick is the
 * default, so the file's own toggle is dropped.
 */
export function toggleFileDiffFoldForViewed(
  fileKey: string,
  viewed: boolean,
  fold: DiffFilesCollapsed,
  toggledFileKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const toggled = isFileDiffCollapsed(fileKey, fold, viewed, NO_TOGGLES) !== viewed;
  if (toggledFileKeys.has(fileKey) === toggled) return toggledFileKeys;
  const next = new Set(toggledFileKeys);
  if (toggled) next.add(fileKey);
  else next.delete(fileKey);
  return next;
}
