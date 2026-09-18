import {
  effectiveSnoozed,
  type ThreadSnoozeShell,
} from "@t3tools/client-runtime/state/thread-settled";
import type { SidebarThreadSummary } from "../types";
import type { SidebarDropTarget } from "./Sidebar.logic";

// ── Worktree cards ────────────────────────────────────────────────────
// The default sidebar keeps a flat, server-ordered thread list. A worktree
// card is a read-time view over that list: the pinned and active members of
// one worktree are gathered to the slot of their highest-ranking member and
// painted as one card. Nothing is stored for the card itself. Writes happen
// only behind user gestures (a card drag fans key writes out to every
// member), so another client splitting the flat order can never leave a
// half card here, and a partial write still renders one whole card.

export type WorktreeCardThread = {
  readonly environmentId: string;
  readonly id: string;
  readonly worktreePath: string | null;
};

/** Card identity: a worktree path is only unique within an environment.
    Null for root-checkout threads, which never join a card. */
export function worktreeCardKey(thread: {
  readonly environmentId: string;
  readonly worktreePath: string | null;
}): string | null {
  const path = thread.worktreePath?.trim();
  return path ? `${thread.environmentId}\u0000${path}` : null;
}

/**
 * Gather each worktree's members behind its highest-ranking member. Pinned
 * ranks above active, so a card with any pinned member lands in the pinned
 * list, unpinned members included (they carry no pin of their own until the
 * card is touched again). Members keep their flat relative order.
 */
export function gatherWorktreeCards<T extends WorktreeCardThread>(input: {
  readonly pinned: readonly T[];
  readonly active: readonly T[];
}): { pinned: T[]; active: T[] } {
  const membersByCard = new Map<string, T[]>();
  const flat: { thread: T; section: "pinned" | "active" }[] = [];
  for (const section of ["pinned", "active"] as const) {
    for (const thread of input[section]) {
      flat.push({ thread, section });
      const key = worktreeCardKey(thread);
      if (key === null) continue;
      const members = membersByCard.get(key);
      if (members) members.push(thread);
      else membersByCard.set(key, [thread]);
    }
  }
  const emitted = new Set<string>();
  const out = { pinned: [] as T[], active: [] as T[] };
  for (const { thread, section } of flat) {
    const key = worktreeCardKey(thread);
    if (key === null) {
      out[section].push(thread);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    out[section].push(...membersByCard.get(key)!);
  }
  return out;
}

export type WorktreeCardPosition = "first" | "middle" | "last";

/** Card paint per row of a gathered section list. Null for rows outside any
    card, including a worktree's lone thread, which renders as today. */
export function resolveWorktreeCardPositions<T extends WorktreeCardThread>(
  list: readonly T[],
): ReadonlyArray<WorktreeCardPosition | null> {
  const positions: (WorktreeCardPosition | null)[] = list.map(() => null);
  let start = 0;
  while (start < list.length) {
    const key = worktreeCardKey(list[start]!);
    let end = start;
    while (key !== null && end + 1 < list.length && worktreeCardKey(list[end + 1]!) === key) {
      end += 1;
    }
    if (end > start) {
      for (let index = start; index <= end; index += 1) {
        positions[index] = index === start ? "first" : index === end ? "last" : "middle";
      }
    }
    start = end + 1;
  }
  return positions;
}

/** The contiguous run of the same worktree around `thread` in a gathered
    section list; just the thread itself outside a card. */
export function worktreeCardMembers<T extends WorktreeCardThread>(
  list: readonly T[],
  thread: WorktreeCardThread,
): T[] {
  const key = worktreeCardKey(thread);
  const index = list.findIndex(
    (candidate) => candidate.environmentId === thread.environmentId && candidate.id === thread.id,
  );
  if (index === -1) return [];
  if (key === null) return [list[index]!];
  let start = index;
  while (start > 0 && worktreeCardKey(list[start - 1]!) === key) start -= 1;
  let end = index;
  while (end + 1 < list.length && worktreeCardKey(list[end + 1]!) === key) end += 1;
  return list.slice(start, end + 1);
}

/** Re-form the dragged card at the drop slot: the dragged row's siblings leave
    wherever the plain drop target left them and follow it as one block, in
    card order. */
export function applyWorktreeCardToDropTarget(
  target: SidebarDropTarget,
  activeKey: string,
  cardKeys: readonly string[],
): SidebarDropTarget {
  if (cardKeys.length < 2 || !cardKeys.includes(activeKey)) return target;
  const siblings = new Set(cardKeys.filter((key) => key !== activeKey));
  const place = (order: readonly string[]) => {
    const stripped = order.filter((key) => !siblings.has(key));
    const at = stripped.indexOf(activeKey);
    if (at === -1) return stripped;
    stripped.splice(at, 1, ...cardKeys);
    return stripped;
  };
  return {
    section: target.section,
    pinnedOrder: place(target.pinnedOrder),
    activeOrder: place(target.activeOrder),
  };
}

/** The card's members in the order a section arranges them after a drop.
    A row moved inside its card re-keys the whole card against the card's
    outside neighbors: keying only the moved row would let the card's anchor
    (its best key) change and gather the card somewhere else. */
export function worktreeCardOrderWithin(
  sectionOrder: readonly string[],
  cardKeys: readonly string[],
): string[] {
  const members = new Set(cardKeys);
  return sectionOrder.filter((key) => members.has(key));
}

/** Row drags inside a card must leave the card whole: every member still
    adjacent in the section order. */
export function worktreeCardStaysContiguous(
  order: readonly string[],
  cardKeys: readonly string[],
): boolean {
  const indices = cardKeys.map((key) => order.indexOf(key));
  if (indices.some((index) => index === -1)) return false;
  return Math.max(...indices) - Math.min(...indices) === cardKeys.length - 1;
}

/** A drop slot strictly inside another worktree's card would preview a split
    that gather-at-read undoes on commit; such slots are not offered. */
export function dropSplitsForeignWorktreeCard(
  order: readonly string[],
  blockKeys: readonly string[],
  cardKeyOf: (key: string) => string | null,
): boolean {
  const first = order.indexOf(blockKeys[0] ?? "");
  const last = order.indexOf(blockKeys.at(-1) ?? "");
  if (first === -1 || last === -1) return false;
  const before = order[first - 1];
  const after = order[last + 1];
  if (before === undefined || after === undefined) return false;
  const neighborCard = cardKeyOf(before);
  return (
    neighborCard !== null &&
    neighborCard === cardKeyOf(after) &&
    neighborCard !== cardKeyOf(blockKeys[0] ?? "")
  );
}

type WorktreeSiblingShell = WorktreeCardThread &
  ThreadSnoozeShell & {
    readonly archivedAt: string | null;
    readonly settledOverride: SidebarThreadSummary["settledOverride"];
    readonly pinnedAt?: string | null | undefined;
  };

function isLiveCardMember(shell: WorktreeSiblingShell, options: { readonly now: string }) {
  return (
    shell.archivedAt === null &&
    shell.settledOverride !== "settled" &&
    !effectiveSnoozed(shell, options)
  );
}

/**
 * The other live members of a thread's worktree card, for actions that fan
 * out (pin, unpin). Settled and snoozed threads have left the card, so they
 * are never touched by a card gesture, and a parked thread has no card of
 * its own to act on.
 */
export function worktreeCardSiblings<T extends WorktreeSiblingShell>(
  shells: ReadonlyArray<T>,
  thread: WorktreeSiblingShell,
  options: { readonly now: string },
): T[] {
  const key = worktreeCardKey(thread);
  if (key === null || !isLiveCardMember(thread, options)) return [];
  return shells.filter(
    (shell) =>
      shell.id !== thread.id && worktreeCardKey(shell) === key && isLiveCardMember(shell, options),
  );
}
