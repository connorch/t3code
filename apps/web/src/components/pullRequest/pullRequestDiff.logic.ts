import type { FileDiffMetadata } from "@pierre/diffs";
import type { DiffFilesCollapsed, PullRequestDiffSide } from "@t3tools/contracts";

/** Only rendered hunks can anchor comments; list others off-diff. */
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

export type DiffFoldOverride = "all" | "none" | null;

const NO_TOGGLES: ReadonlySet<string> = new Set();

/**
 * Keep fold choices relative to the default so later pages inherit Fold all. Under `viewed` the
 * default is the file's own tick.
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

/** Toggles that leave a file open. Idempotent, so a repeated request never folds it back. */
export function unfoldFileDiff(
  fileKey: string,
  fold: DiffFilesCollapsed,
  viewed: boolean,
  toggledFileKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const toggled = isFileDiffCollapsed(fileKey, fold, viewed, NO_TOGGLES);
  if (toggledFileKeys.has(fileKey) === toggled) return toggledFileKeys;
  const next = new Set(toggledFileKeys);
  if (toggled) next.add(fileKey);
  else next.delete(fileKey);
  return next;
}

/** Under `viewed` the tick is the default, so the file's own toggle is dropped. */
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
