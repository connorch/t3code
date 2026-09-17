import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import type { DraftId, DraftSessionState } from "../../composerDraftStore";
import { localCheckoutGroupKey, worktreeGroupKey } from "../SidebarConnor.logic";

export interface ThreadTabCheckout {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  worktreePath: string | null;
  /** A new-worktree draft has no path yet and must not join the root checkout. */
  pendingWorktreeDraftId: DraftId | null;
}

export function threadTabCheckoutKey(checkout: ThreadTabCheckout): string {
  if (checkout.pendingWorktreeDraftId) {
    return `${checkout.environmentId}\u0000draft\u0000${checkout.pendingWorktreeDraftId}`;
  }
  const path = checkout.worktreePath?.trim();
  return path
    ? worktreeGroupKey(checkout.environmentId, path)
    : localCheckoutGroupKey(checkout.environmentId, checkout.projectId);
}

type TabThread = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "projectId" | "worktreePath" | "archivedAt" | "createdAt"
>;

export type WorktreeThreadTab = {
  id: string;
  threadId: ThreadId;
  createdAt: string;
} & ({ kind: "server" } | { kind: "draft"; draftId: DraftId });

/** Draft and server tabs share the future thread ID so promotion retains manual order. */
export function collectWorktreeThreadTabs(input: {
  checkout: ThreadTabCheckout;
  threads: readonly TabThread[];
  drafts: readonly { draftId: DraftId; session: DraftSessionState }[];
}): WorktreeThreadTab[] {
  const key = threadTabCheckoutKey(input.checkout);
  const tabs = new Map<string, WorktreeThreadTab>();
  for (const thread of input.threads) {
    if (
      thread.archivedAt !== null ||
      threadTabCheckoutKey({ ...thread, pendingWorktreeDraftId: null }) !== key
    )
      continue;
    const id = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    tabs.set(id, { id, kind: "server", threadId: thread.id, createdAt: thread.createdAt });
  }
  for (const { draftId, session } of input.drafts) {
    if (session.promotedTo) continue;
    const draftKey = threadTabCheckoutKey({
      ...session,
      pendingWorktreeDraftId:
        session.envMode === "worktree" && !session.worktreePath ? draftId : null,
    });
    if (draftKey !== key) continue;
    const id = scopedThreadKey(scopeThreadRef(session.environmentId, session.threadId));
    if (!tabs.has(id)) {
      tabs.set(id, {
        id,
        kind: "draft",
        draftId,
        threadId: session.threadId,
        createdAt: session.createdAt,
      });
    }
  }
  return [...tabs.values()].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** New tabs append in creation order; stale saved IDs never create phantom tabs. */
export function orderWorktreeThreadTabs<T extends { id: string }>(
  tabs: readonly T[],
  savedOrder: readonly string[],
): T[] {
  const ranks = new Map(savedOrder.map((id, index) => [id, index]));
  return tabs.toSorted((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
}
