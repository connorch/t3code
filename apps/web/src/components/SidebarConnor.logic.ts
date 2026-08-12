import { formatWorktreePathForDisplay } from "../worktreeCleanup";
import type { SidebarThreadSummary } from "../types";
import { hasUnseenCompletion, parseTimestampMs, resolveSidebarThreadStatus } from "./Sidebar.logic";

// ── Connor mode: the worktree is the unit of navigation ─────────────
// Threads sharing a `worktreePath` collapse into one sidebar group; threads
// without a worktree collapse into one "Root Checkout" group per project,
// rendered with the same card UI and listed above the worktrees.

/** Group identity: a worktree path is only unique within an environment. */
export function worktreeGroupKey(environmentId: string, worktreePath: string): string {
  return `${environmentId}\u0000${worktreePath}`;
}

/** Paths cannot contain NUL, so this can never collide with a worktree key. */
export function localCheckoutGroupKey(environmentId: string, projectId: string): string {
  return `${environmentId}\u0000local\u0000${projectId}`;
}

/** Same format as `scopedThreadKey`, without requiring branded ids. */
function threadKeyOf(thread: { environmentId: string; id: string }): string {
  return `${thread.environmentId}:${thread.id}`;
}

export type ConnorGroupableThread = {
  readonly id: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly title: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly createdAt: string;
  readonly archivedAt: string | null;
};

export type ConnorStatusThread = Pick<
  SidebarThreadSummary,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestTurn"
  | "session"
  | "backgroundLiveness"
> & { readonly environmentId: string; readonly id: string };

interface ConnorGroupBase<T extends { environmentId: string; projectId: string }> {
  readonly key: string;
  readonly environmentId: T["environmentId"];
  readonly projectId: T["projectId"];
  /** The newest member's branch — later threads may have switched branches. */
  readonly branch: string | null;
  /** Creation order, oldest first: the first thread names the worktree. */
  readonly threads: readonly T[];
}

export interface ConnorWorktreeGroup<
  T extends { environmentId: string; projectId: string },
> extends ConnorGroupBase<T> {
  readonly kind: "worktree";
  readonly worktreePath: string;
}

export interface ConnorLocalCheckoutGroup<
  T extends { environmentId: string; projectId: string },
> extends ConnorGroupBase<T> {
  readonly kind: "local";
  /** The checkout root — null until the owning project resolves it. */
  readonly worktreePath: string | null;
}

export type ConnorSidebarGroup<T extends { environmentId: string; projectId: string }> =
  | ConnorWorktreeGroup<T>
  | ConnorLocalCheckoutGroup<T>;

function normalizedWorktreePath(path: string | null): string | null {
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

function byCreatedAtAscending<T extends { createdAt: string; id: string }>(
  left: T,
  right: T,
): number {
  return (
    parseTimestampMs(left.createdAt) - parseTimestampMs(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Groups live threads into local-checkout groups (one per physical project)
 * followed by worktree groups. Ordering is static creation order, newest
 * first — same philosophy as sidebar v2: activity changes indicators, never
 * positions.
 */
export function partitionThreadsForConnorSidebar<T extends ConnorGroupableThread>(
  threads: readonly T[],
): {
  groups: ConnorSidebarGroup<T>[];
} {
  const localsByKey = new Map<string, T[]>();
  const worktreesByKey = new Map<string, { worktreePath: string; threads: T[] }>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const worktreePath = normalizedWorktreePath(thread.worktreePath);
    if (worktreePath === null) {
      const key = localCheckoutGroupKey(thread.environmentId, thread.projectId);
      const existing = localsByKey.get(key);
      if (existing) {
        existing.push(thread);
      } else {
        localsByKey.set(key, [thread]);
      }
      continue;
    }
    const key = worktreeGroupKey(thread.environmentId, worktreePath);
    const existing = worktreesByKey.get(key);
    if (existing) {
      existing.threads.push(thread);
    } else {
      worktreesByKey.set(key, { worktreePath, threads: [thread] });
    }
  }

  const groupBase = (key: string, members: T[]) => {
    const ordered = members.toSorted(byCreatedAtAscending);
    const first = ordered[0]!;
    return {
      key,
      environmentId: first.environmentId,
      projectId: first.projectId,
      branch: ordered.findLast((thread) => thread.branch !== null)?.branch ?? null,
      threads: ordered,
    };
  };
  // Newest group (by its first thread) on top, within each kind.
  const byNewestFirstThread = (left: ConnorGroupBase<T>, right: ConnorGroupBase<T>) =>
    byCreatedAtAscending(right.threads[0]!, left.threads[0]!);

  const localGroups = [...localsByKey.entries()]
    .map(
      ([key, members]) =>
        ({
          ...groupBase(key, members),
          kind: "local",
          worktreePath: null,
        }) satisfies ConnorLocalCheckoutGroup<T>,
    )
    .toSorted(byNewestFirstThread);
  const worktreeGroups = [...worktreesByKey.entries()]
    .map(
      ([key, { worktreePath, threads: members }]) =>
        ({
          ...groupBase(key, members),
          kind: "worktree",
          worktreePath,
        }) satisfies ConnorWorktreeGroup<T>,
    )
    .toSorted(byNewestFirstThread);

  // The root checkout sits above the worktrees.
  return { groups: [...localGroups, ...worktreeGroups] };
}

/**
 * Custom name if the user set one, else the first (oldest) thread's title,
 * else the worktree directory name.
 */
export function resolveWorktreeDisplayName(
  group: {
    readonly key: string;
    readonly worktreePath: string;
    readonly threads: readonly { readonly title: string }[];
  },
  worktreeNameByKey: Readonly<Record<string, string>>,
): string {
  const custom = worktreeNameByKey[group.key]?.trim();
  if (custom) return custom;
  const firstTitle = group.threads[0]?.title.trim();
  if (firstTitle) return firstTitle;
  return formatWorktreePathForDisplay(group.worktreePath);
}

// ── Collapsed-group indicator ───────────────────────────────────────
// Priority: agent blocked on the user (question/approval) → failed →
// agent working → unread completion → nothing.
export type ConnorGroupIndicator =
  | { readonly kind: "question"; readonly tone: "approval" | "input" }
  | { readonly kind: "failed" }
  | { readonly kind: "working" }
  | { readonly kind: "unread" }
  | null;

export function resolveConnorGroupIndicator<T extends ConnorStatusThread>(
  threads: readonly T[],
  threadLastVisitedAtById: Readonly<Record<string, string>>,
): ConnorGroupIndicator {
  let hasInput = false;
  let hasFailed = false;
  let hasWorking = false;
  let hasUnread = false;
  for (const thread of threads) {
    const status = resolveSidebarThreadStatus(thread);
    if (status === "approval") {
      return { kind: "question", tone: "approval" };
    }
    if (status === "input") {
      hasInput = true;
    } else if (status === "failed") {
      hasFailed = true;
    } else if (status === "working" || status === "monitoring") {
      hasWorking = true;
    }
    if (!hasUnread) {
      hasUnread = hasUnseenCompletion({
        ...thread,
        lastVisitedAt: threadLastVisitedAtById[threadKeyOf(thread)],
      });
    }
  }
  if (hasInput) return { kind: "question", tone: "input" };
  if (hasFailed) return { kind: "failed" };
  if (hasWorking) return { kind: "working" };
  if (hasUnread) return { kind: "unread" };
  return null;
}

/** Per-thread status marker for rows inside an expanded group. */
export type ConnorThreadDot = "approval" | "input" | "working" | "failed" | "unread" | null;

export function resolveConnorThreadDot(
  thread: ConnorStatusThread,
  lastVisitedAt: string | undefined,
): ConnorThreadDot {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval") return "approval";
  if (status === "input") return "input";
  if (status === "working" || status === "monitoring") return "working";
  if (status === "failed") return "failed";
  return hasUnseenCompletion({ ...thread, lastVisitedAt }) ? "unread" : null;
}

/**
 * Which thread a click on the collapsed group opens: the remembered
 * last-viewed thread if it still exists, else the most recently visited
 * member, else the newest thread.
 */
export function resolveGroupNavigationThread<T extends { environmentId: string; id: string }>(
  group: { readonly key: string; readonly threads: readonly T[] },
  worktreeLastThreadKeyByKey: Readonly<Record<string, string>>,
  threadLastVisitedAtById: Readonly<Record<string, string>>,
): T | null {
  const storedKey = worktreeLastThreadKeyByKey[group.key];
  if (storedKey !== undefined) {
    const stored = group.threads.find((thread) => threadKeyOf(thread) === storedKey);
    if (stored) return stored;
  }
  let best: T | null = null;
  let bestVisitedMs = Number.NEGATIVE_INFINITY;
  for (const thread of group.threads) {
    const visitedAt = threadLastVisitedAtById[threadKeyOf(thread)];
    if (visitedAt === undefined) continue;
    const visitedMs = Date.parse(visitedAt);
    if (Number.isFinite(visitedMs) && visitedMs > bestVisitedMs) {
      best = thread;
      bestVisitedMs = visitedMs;
    }
  }
  return best ?? group.threads.at(-1) ?? null;
}
