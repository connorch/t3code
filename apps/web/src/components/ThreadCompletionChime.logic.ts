/**
 * Turn-completion detection for the chime, kept pure so it can be tested
 * without an audio device.
 *
 * The server does not push a "turn finished" event to clients, so completion is
 * derived the same way the sidebar's unread dot derives it: by watching
 * `latestTurn.completedAt` on the thread shells. Any terminal state counts -
 * completed, interrupted, and error all set `completedAt`, and all three mean
 * the agent stopped working.
 */

export interface ThreadCompletionInput {
  /** Environment-scoped thread key; see `scopedThreadKey`. */
  readonly key: string;
  /** `latestTurn.completedAt` parsed to epoch ms, or null while a turn runs. */
  readonly completedAtMs: number | null;
}

export type ThreadCompletionSnapshot = ReadonlyMap<string, number | null>;

export interface ThreadCompletionScan {
  /** Rebuilt from `threads`, so keys for threads that went away are dropped. */
  readonly snapshot: ThreadCompletionSnapshot;
  /** Whether at least one thread finished a turn since the previous snapshot. */
  readonly completed: boolean;
}

/**
 * Compares the current shells against the previous scan.
 *
 * A key absent from `previous` is recorded silently rather than announced: the
 * first scan after mount, a freshly connected environment, and an unarchived
 * thread all arrive with completions already in the past, and none of them are
 * something that just happened.
 */
export function scanThreadCompletions(
  previous: ThreadCompletionSnapshot | null,
  threads: ReadonlyArray<ThreadCompletionInput>,
): ThreadCompletionScan {
  const snapshot = new Map<string, number | null>();
  let completed = false;

  for (const thread of threads) {
    snapshot.set(thread.key, thread.completedAtMs);
    if (previous === null || !previous.has(thread.key)) continue;
    const previousCompletedAtMs = previous.get(thread.key) ?? null;
    if (thread.completedAtMs !== null && thread.completedAtMs !== previousCompletedAtMs) {
      completed = true;
    }
  }

  return { snapshot, completed };
}

export function parseCompletedAtMs(completedAt: string | null | undefined): number | null {
  if (!completedAt) return null;
  const parsed = Date.parse(completedAt);
  return Number.isNaN(parsed) ? null : parsed;
}
