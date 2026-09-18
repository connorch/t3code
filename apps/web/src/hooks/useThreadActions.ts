import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { canSnooze, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import { EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";

import {
  getFallbackThreadIdAfterDelete,
  getWorktreeSiblingThreadIdAfterArchive,
  pinOrderKeyBetween,
} from "../components/Sidebar.logic";
import { useComposerDraftStore } from "../composerDraftStore";
import { terminalEnvironment } from "../state/terminal";
import { threadEnvironment } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";
import { useNewThreadHandler } from "./useHandleNewThread";
import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import { releaseComposerDraftUploads } from "../lib/composerDraftUploads";
import { readLocalApi } from "../localApi";
import {
  readEnvironmentSupportsPinning,
  readEnvironmentSupportsPinReorder,
  readEnvironmentSupportsActiveReorder,
  readEnvironmentSupportsSettlement,
  readEnvironmentSupportsSnooze,
  readEnvironmentThreadRefs,
  readProject,
  readThreadShell,
  readThreadShells,
} from "../state/entities";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useUiStateStore } from "../uiStateStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useClientSettings, useSidebarWorktreeCardsEnabled } from "./useSettings";
import { worktreeCardSiblings } from "../components/Sidebar.worktree";
import { useAtomCommand } from "../state/use-atom-command";

export class ThreadArchiveBlockedError extends Schema.TaggedError<ThreadArchiveBlockedError>()(
  "ThreadArchiveBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "Cannot archive a running thread.";
  }
}

export class ThreadSettlementUnsupportedError extends Schema.TaggedError<ThreadSettlementUnsupportedError>()(
  "ThreadSettlementUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support settling yet. Update the server to use Settle.";
  }
}

export class ThreadSnoozeUnsupportedError extends Schema.TaggedError<ThreadSnoozeUnsupportedError>()(
  "ThreadSnoozeUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support snoozing yet. Update the server to use Snooze.";
  }
}

export class ThreadSnoozeBlockedError extends Schema.TaggedError<ThreadSnoozeBlockedError>()(
  "ThreadSnoozeBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This thread is waiting on you. Respond to the pending request before snoozing it.";
  }
}

/** Key that sorts before every arranged pinned thread, so a fresh pin lands
    at the top of the run. Undefined (keyless, sorts with the legacy block)
    when key math can't produce one — pinning must never fail on placement. */
function smallestPinnedOrderKey(): string | null {
  let firstKey: string | null = null;
  for (const shell of readThreadShells()) {
    if (shell.pinnedAt == null || shell.pinOrderKey == null) continue;
    if (firstKey === null || shell.pinOrderKey < firstKey) firstKey = shell.pinOrderKey;
  }
  return firstKey;
}

function topOfPinnedRunOrderKey(): string | undefined {
  return pinOrderKeyBetween(null, smallestPinnedOrderKey()) ?? undefined;
}

/** Pin and unpin act on the whole worktree card ("worktree", the default for
    every entry point) unless the caller already fans out itself, as the
    sidebar drop does when it writes one key per member. */
export type ThreadPinScope = "thread" | "worktree";

export class ThreadPinningUnsupportedError extends Schema.TaggedError<ThreadPinningUnsupportedError>()(
  "ThreadPinningUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support pinning yet. Update the server to use Pin.";
  }
}

export class ThreadPinReorderUnsupportedError extends Schema.TaggedError<ThreadPinReorderUnsupportedError>()(
  "ThreadPinReorderUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support reordering pinned threads yet. Update the server to reorder pins.";
  }
}

export class ThreadActiveReorderUnsupportedError extends Schema.TaggedError<ThreadActiveReorderUnsupportedError>()(
  "ThreadActiveReorderUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "Update this environment's server to reorder active threads.";
  }
}

export async function requestThreadUnpinConfirmation(input: {
  enabled: boolean;
  title: string;
  /** Pinned worktree siblings that unpin along with the thread. */
  siblingCount?: number;
  confirm: ((message: string) => Promise<boolean>) | null;
}) {
  const { confirm } = input;
  if (!input.enabled || confirm === null) {
    return AsyncResult.success(true);
  }

  const siblingCount = input.siblingCount ?? 0;
  return settlePromise(() =>
    confirm(
      siblingCount > 0
        ? [
            `Unpin thread "${input.title}" and ${siblingCount} more in its worktree?`,
            "This will move the whole worktree out of your pinned section.",
          ].join("\n")
        : [
            `Unpin thread "${input.title}"?`,
            "This will move the thread out of your pinned section.",
          ].join("\n"),
    ),
  );
}

/** Report navigation separately so a completed deletion can still finish worktree cleanup. */
export async function navigateAfterThreadDeletion(navigate: () => Promise<void>) {
  const result = await settlePromise(navigate);
  if (result._tag === "Failure") {
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Thread deleted, but navigation failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
}

export function useThreadActions() {
  const closeTerminal = useAtomCommand(terminalEnvironment.close);
  const archiveThreadMutation = useAtomCommand(threadEnvironment.archive, {
    reportFailure: false,
  });
  const unarchiveThreadMutation = useAtomCommand(threadEnvironment.unarchive, {
    reportFailure: false,
  });
  const deleteThreadMutation = useAtomCommand(threadEnvironment.delete, {
    reportFailure: false,
  });
  const settleThreadMutation = useAtomCommand(threadEnvironment.settle, {
    reportFailure: false,
  });
  const unsettleThreadMutation = useAtomCommand(threadEnvironment.unsettle, {
    reportFailure: false,
  });
  const pinThreadMutation = useAtomCommand(threadEnvironment.pin, {
    reportFailure: false,
  });
  const unpinThreadMutation = useAtomCommand(threadEnvironment.unpin, {
    reportFailure: false,
  });
  const reorderPinnedThreadMutation = useAtomCommand(threadEnvironment.reorderPin, {
    reportFailure: false,
  });
  const reorderActiveThreadMutation = useAtomCommand(threadEnvironment.reorderActive, {
    reportFailure: false,
  });
  const snoozeThreadMutation = useAtomCommand(threadEnvironment.snooze, {
    reportFailure: false,
  });
  const unsnoozeThreadMutation = useAtomCommand(threadEnvironment.unsnooze, {
    reportFailure: false,
  });
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession);
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, {
    reportFailure: false,
  });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const confirmThreadUnpin = useClientSettings((settings) => settings.confirmThreadUnpin);
  const worktreeCardsEnabled = useSidebarWorktreeCardsEnabled();
  // The other live threads in the target's worktree card, or none when cards
  // are off. Read at call time: the card is a view over current shells.
  const readWorktreeSiblings = useCallback(
    (target: ScopedThreadRef) => {
      if (!worktreeCardsEnabled) return [];
      const shell = readThreadShell(target);
      if (!shell) return [];
      return worktreeCardSiblings(readThreadShells(), shell, {
        now: new Date().toISOString(),
      }).filter((sibling) => sibling.environmentId === target.environmentId);
    },
    [worktreeCardsEnabled],
  );
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const clearTerminalUiState = useTerminalUiStateStore((state) => state.clearTerminalUiState);
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  // Keep a ref so archiveThread can call handleNewThread without appearing in
  // its dependency array — handleNewThread is inherently unstable (depends on
  // the projects list) and would otherwise cascade new references into every
  // sidebar row via archiveThread → attemptArchiveThread.
  const handleNewThreadRef = useRef(handleNewThread);
  handleNewThreadRef.current = handleNewThread;

  const resolveThreadTarget = useCallback((target: ScopedThreadRef) => {
    const thread = readThreadShell(target);
    if (!thread) {
      return null;
    }
    return {
      thread,
      threadRef: target,
    };
  }, []);
  const getCurrentRouteThreadRef = useCallback(() => {
    const currentRouteParams = router.state.matches[router.state.matches.length - 1]?.params ?? {};
    return resolveThreadRouteRef(currentRouteParams);
  }, [router]);

  const archiveThread = useCallback(
    async (target: ScopedThreadRef, opts: { onArchived?: () => void } = {}) => {
      const resolved = resolveThreadTarget(target);
      if (!resolved) return AsyncResult.success(undefined);
      const { thread, threadRef } = resolved;
      if (thread.session?.status === "running" && thread.session.activeTurnId != null) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadArchiveBlockedError({
              environmentId: threadRef.environmentId,
              threadId: threadRef.threadId,
            }),
          ),
        );
      }

      const currentRouteThreadRef = getCurrentRouteThreadRef();
      const shouldNavigateAway =
        currentRouteThreadRef?.threadId === threadRef.threadId &&
        currentRouteThreadRef.environmentId === threadRef.environmentId;
      // Resolved before the mutation lands so the archived thread is still in
      // the store to read its worktree from.
      const siblingThreadId = shouldNavigateAway
        ? getWorktreeSiblingThreadIdAfterArchive({
            threads: readEnvironmentThreadRefs(threadRef.environmentId).flatMap((ref) => {
              const shell = readThreadShell(ref);
              return shell === null ? [] : [shell];
            }),
            archivedThreadId: threadRef.threadId,
            sortOrder: sidebarThreadSortOrder,
          })
        : null;
      const archiveResult = await archiveThreadMutation({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (archiveResult._tag === "Failure") {
        return archiveResult;
      }
      const wokeAt = threadWokeAt(thread, { now: new Date().toISOString() });
      if (wokeAt !== null) {
        markThreadVisited(scopedThreadKey(threadRef), wokeAt);
      }
      refreshArchivedThreadsForEnvironment(threadRef.environmentId);
      opts.onArchived?.();

      if (shouldNavigateAway) {
        // Both branches are awaited for their side effect only; `handleNewThread`
        // resolves with the created thread, which would otherwise widen the union
        // settlePromise infers.
        const navigationResult = await settlePromise(async () => {
          if (siblingThreadId) {
            await router.navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(
                scopeThreadRef(threadRef.environmentId, siblingThreadId),
              ),
              replace: true,
            });
            return;
          }
          await handleNewThreadRef.current(scopeProjectRef(thread.environmentId, thread.projectId));
        });
        if (navigationResult._tag === "Failure") {
          return navigationResult;
        }
        return archiveResult;
      }

      return archiveResult;
    },
    [
      archiveThreadMutation,
      getCurrentRouteThreadRef,
      markThreadVisited,
      resolveThreadTarget,
      router,
      sidebarThreadSortOrder,
    ],
  );

  const unarchiveThread = useCallback(
    async (target: ScopedThreadRef) => {
      const result = await unarchiveThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Success") {
        refreshArchivedThreadsForEnvironment(target.environmentId);
      }
      return result;
    },
    [unarchiveThreadMutation],
  );

  const deleteThread = useCallback(
    async (
      target: ScopedThreadRef,
      opts: {
        deletedThreadKeys?: ReadonlySet<string>;
        /** Remove an orphaned worktree without asking - the caller already confirmed. */
        deleteOrphanedWorktree?: boolean;
      } = {},
    ) => {
      const resolved = resolveThreadTarget(target);
      if (!resolved) {
        // Thread not in main store (e.g. archived thread) — dispatch delete directly.
        const result = await deleteThreadMutation({
          environmentId: target.environmentId,
          input: { threadId: target.threadId },
        });
        if (result._tag === "Success") {
          refreshArchivedThreadsForEnvironment(target.environmentId);
        }
        return result;
      }
      const { thread, threadRef } = resolved;
      const threads = readEnvironmentThreadRefs(threadRef.environmentId).flatMap((ref) => {
        const shell = readThreadShell(ref);
        return shell === null ? [] : [shell];
      });
      const threadProject = readProject({
        environmentId: threadRef.environmentId,
        projectId: thread.projectId,
      });
      const deletedIds =
        opts.deletedThreadKeys && opts.deletedThreadKeys.size > 0
          ? new Set<ThreadId>(
              [...opts.deletedThreadKeys].flatMap((threadKey) => {
                const ref = parseScopedThreadKey(threadKey);
                return ref && ref.environmentId === threadRef.environmentId ? [ref.threadId] : [];
              }),
            )
          : undefined;
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? threads.filter((entry) => entry.id === threadRef.threadId || !deletedIds.has(entry.id))
          : threads;
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(
        survivingThreads,
        threadRef.threadId,
      );
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== null;
      const localApi = readLocalApi();
      let shouldDeleteWorktree = false;
      if (canDeleteWorktree && opts.deleteOrphanedWorktree) {
        shouldDeleteWorktree = true;
      } else if (canDeleteWorktree && localApi) {
        const confirmationResult = await settlePromise(() =>
          localApi.dialogs.confirm(
            [
              "This thread is the only one linked to this worktree:",
              displayWorktreePath ?? orphanedWorktreePath,
              "",
              "Delete the worktree too?",
            ].join("\n"),
            { variant: "destructive" },
          ),
        );
        if (confirmationResult._tag === "Failure") {
          return confirmationResult;
        }
        shouldDeleteWorktree = confirmationResult.value;
      }

      if (thread.session && thread.session.status !== "stopped") {
        await stopThreadSession({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        });
      }

      await closeTerminal({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, deleteHistory: true },
      });

      const deletedThreadIds = deletedIds ?? new Set<ThreadId>();
      const currentRouteThreadRef = getCurrentRouteThreadRef();
      const shouldNavigateToFallback =
        currentRouteThreadRef?.threadId === threadRef.threadId &&
        currentRouteThreadRef.environmentId === threadRef.environmentId;
      const fallbackThreadId = getFallbackThreadIdAfterDelete({
        threads,
        deletedThreadId: threadRef.threadId,
        deletedThreadIds,
        sortOrder: sidebarThreadSortOrder,
      });
      const deleteResult = await deleteThreadMutation({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (deleteResult._tag === "Failure") {
        return deleteResult;
      }
      refreshArchivedThreadsForEnvironment(threadRef.environmentId);
      releaseComposerDraftUploads(threadRef);
      clearComposerDraftForThread(threadRef);
      clearProjectDraftThreadById(
        scopeProjectRef(threadRef.environmentId, thread.projectId),
        threadRef,
      );
      clearTerminalUiState(threadRef);

      if (shouldNavigateToFallback) {
        const fallbackThread = fallbackThreadId
          ? readThreadShell(scopeThreadRef(threadRef.environmentId, fallbackThreadId))
          : null;
        await navigateAfterThreadDeletion(() =>
          fallbackThread
            ? router.navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(
                  scopeThreadRef(fallbackThread.environmentId, fallbackThread.id),
                ),
                replace: true,
              })
            : router.navigate({ to: "/", replace: true }),
        );
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return deleteResult;
      }

      const removeResult = await removeWorktree({
        environmentId: threadRef.environmentId,
        input: {
          cwd: threadProject.workspaceRoot,
          path: orphanedWorktreePath,
          force: true,
        },
      });
      const refreshResult =
        removeResult._tag === "Success"
          ? await refreshVcsStatus({
              environmentId: threadRef.environmentId,
              input: { cwd: threadProject.workspaceRoot },
            })
          : null;
      const cleanupFailure =
        removeResult._tag === "Failure"
          ? removeResult
          : refreshResult?._tag === "Failure"
            ? refreshResult
            : null;
      if (cleanupFailure) {
        const removalFailed = removeResult._tag === "Failure";
        const error = squashAtomCommandFailure(cleanupFailure);
        const message = error instanceof Error ? error.message : "An error occurred.";
        console.error("Worktree cleanup failed after thread deletion", {
          threadId: threadRef.threadId,
          projectCwd: threadProject.workspaceRoot,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: removalFailed
              ? "Failed to delete worktree"
              : "Worktree deleted, but Git status refresh failed",
            description: removalFailed
              ? `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`
              : message,
          }),
        );
        // The thread was deleted. Cleanup has its own toast; returning its
        // failure would make callers incorrectly report a thread deletion error.
      }
      return deleteResult;
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalUiState,
      closeTerminal,
      deleteThreadMutation,
      getCurrentRouteThreadRef,
      refreshVcsStatus,
      removeWorktree,
      router,
      resolveThreadTarget,
      sidebarThreadSortOrder,
      stopThreadSession,
    ],
  );

  const settleThread = useCallback(
    async (target: ScopedThreadRef) => {
      // Version skew: never send the command to a server that predates it —
      // the raw protocol rejection would read as a random failure.
      if (!readEnvironmentSupportsSettlement(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSettlementUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      const resolved = resolveThreadTarget(target);
      const wokeAt = resolved
        ? threadWokeAt(resolved.thread, { now: new Date().toISOString() })
        : null;
      // Settle is a high-frequency lifecycle action and stays silent — no
      // toast.
      const result = await settleThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Success" && wokeAt !== null) {
        markThreadVisited(scopedThreadKey(target), wokeAt);
      }
      return result;
    },
    [markThreadVisited, resolveThreadTarget, settleThreadMutation],
  );

  const unsettleThread = useCallback(
    async (target: ScopedThreadRef) => {
      if (!readEnvironmentSupportsSettlement(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSettlementUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      // reason "user" pins the thread active: auto-settle (PR merged /
      // inactivity) stays suppressed until real activity clears the pin.
      return unsettleThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, reason: "user" },
      });
    },
    [unsettleThreadMutation],
  );

  // A worktree card is pinned while any live member is, so a keyboard or
  // header toggle on an unpinned member of a pinned card must unpin.
  const isWorktreeCardPinned = useCallback(
    (target: ScopedThreadRef) =>
      readThreadShell(target)?.pinnedAt != null ||
      readWorktreeSiblings(target).some((sibling) => sibling.pinnedAt != null),
    [readWorktreeSiblings],
  );

  const pinThread = useCallback(
    async (target: ScopedThreadRef, opts: { orderKey?: string; scope?: ThreadPinScope } = {}) => {
      // Version skew: never send the command to a server that predates it.
      if (!readEnvironmentSupportsPinning(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadPinningUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      // Every pin path places the thread at the top of the arranged run:
      // callers with a better anchor (the sidebar, which knows the displayed
      // order) pass their own key; everyone else (chat header, context menus)
      // gets the default so the same action never places differently.
      // orderKey rides only to servers that decode it; pre-reorder servers
      // get the bare pin they understand and the thread stays keyless.
      const supportsReorder = readEnvironmentSupportsPinReorder(target.environmentId);
      const runTop = smallestPinnedOrderKey();
      const orderKey = supportsReorder ? (opts.orderKey ?? topOfPinnedRunOrderKey()) : undefined;
      const result = await pinThreadMutation({
        environmentId: target.environmentId,
        input: {
          threadId: target.threadId,
          ...(orderKey !== undefined ? { orderKey } : {}),
        },
      });
      if (result._tag === "Failure" || (opts.scope ?? "worktree") === "thread") return result;
      // Unpinned siblings follow the thread into the pinned block, keyed in
      // sequence between it and the run's previous top so the card stays
      // whole on every client. Stop on the first failure; each landed pin
      // is a complete placement on its own.
      let previous = orderKey ?? null;
      for (const sibling of readWorktreeSiblings(target)) {
        if (sibling.pinnedAt != null) continue;
        const siblingKey =
          supportsReorder && orderKey !== undefined
            ? (pinOrderKeyBetween(previous, runTop) ?? undefined)
            : undefined;
        const siblingResult = await pinThreadMutation({
          environmentId: sibling.environmentId,
          input: {
            threadId: sibling.id,
            ...(siblingKey !== undefined ? { orderKey: siblingKey } : {}),
          },
        });
        if (siblingResult._tag === "Failure") return siblingResult;
        previous = siblingKey ?? previous;
      }
      return result;
    },
    [pinThreadMutation, readWorktreeSiblings],
  );

  const unpinThread = useCallback(
    async (target: ScopedThreadRef, opts: { scope?: ThreadPinScope } = {}) => {
      if (!readEnvironmentSupportsPinning(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadPinningUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      // A card is pinned while any member is, so an unpinned member can be
      // asked to unpin its worktree: the thread itself is skipped, its
      // pinned siblings are not.
      const shell = readThreadShell(target);
      const result =
        shell?.pinnedAt == null && (opts.scope ?? "worktree") === "worktree"
          ? AsyncResult.success(undefined)
          : await unpinThreadMutation({
              environmentId: target.environmentId,
              input: { threadId: target.threadId },
            });
      if (result._tag === "Failure" || (opts.scope ?? "worktree") === "thread") return result;
      for (const sibling of readWorktreeSiblings(target)) {
        if (sibling.pinnedAt == null) continue;
        const siblingResult = await unpinThreadMutation({
          environmentId: sibling.environmentId,
          input: { threadId: sibling.id },
        });
        if (siblingResult._tag === "Failure") return siblingResult;
      }
      return result;
    },
    [readWorktreeSiblings, unpinThreadMutation],
  );

  const confirmAndUnpinThread = useCallback(
    async (target: ScopedThreadRef) => {
      const localApi = readLocalApi();
      const resolved = resolveThreadTarget(target);
      const confirmationResult = await requestThreadUnpinConfirmation({
        enabled: confirmThreadUnpin,
        title: resolved?.thread.title ?? "this thread",
        siblingCount: readWorktreeSiblings(target).filter((sibling) => sibling.pinnedAt != null)
          .length,
        confirm: localApi ? (message) => localApi.dialogs.confirm(message) : null,
      });
      if (confirmationResult._tag === "Failure") {
        return confirmationResult;
      }
      if (!confirmationResult.value) {
        return AsyncResult.success(undefined);
      }
      return unpinThread(target);
    },
    [confirmThreadUnpin, readWorktreeSiblings, resolveThreadTarget, unpinThread],
  );

  const reorderPinnedThread = useCallback(
    async (target: ScopedThreadRef, orderKey: string) => {
      // Callers (the sidebar drag handler) only enable dragging on
      // reorder-capable environments; this guard covers races around
      // capability changes mid-drag.
      if (!readEnvironmentSupportsPinReorder(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadPinReorderUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      return reorderPinnedThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, orderKey },
      });
    },
    [reorderPinnedThreadMutation],
  );

  const reorderActiveThread = useCallback(
    async (target: ScopedThreadRef, orderKey: string) => {
      if (!readEnvironmentSupportsActiveReorder(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadActiveReorderUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      return reorderActiveThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, orderKey },
      });
    },
    [reorderActiveThreadMutation],
  );

  const snoozeThread = useCallback(
    async (target: ScopedThreadRef, snoozedUntil: string) => {
      // Version skew: never send the command to a server that predates it.
      if (!readEnvironmentSupportsSnooze(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSnoozeUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      const resolved = resolveThreadTarget(target);
      // Blocked-on-you work and queued turns can't be snoozed away —
      // client-side twin of the server invariants so the UI rejects before
      // a round trip.
      if (resolved && !canSnooze(resolved.thread, { now: new Date().toISOString() })) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSnoozeBlockedError({
              environmentId: resolved.threadRef.environmentId,
              threadId: resolved.threadRef.threadId,
            }),
          ),
        );
      }
      return snoozeThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, snoozedUntil },
      });
    },
    [resolveThreadTarget, snoozeThreadMutation],
  );

  const unsnoozeThread = useCallback(
    async (target: ScopedThreadRef) => {
      if (!readEnvironmentSupportsSnooze(target.environmentId)) {
        return AsyncResult.failure(
          Cause.fail(
            new ThreadSnoozeUnsupportedError({
              environmentId: target.environmentId,
              threadId: target.threadId,
            }),
          ),
        );
      }
      return unsnoozeThreadMutation({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, reason: "user" },
      });
    },
    [unsnoozeThreadMutation],
  );

  const confirmAndDeleteThread = useCallback(
    async (target: ScopedThreadRef) => {
      const localApi = readLocalApi();
      const resolved = resolveThreadTarget(target);

      if (confirmThreadDelete && localApi) {
        const title = resolved?.thread.title ?? "this thread";
        const confirmationResult = await settlePromise(() =>
          localApi.dialogs.confirm(
            [
              `Delete thread "${title}"?`,
              "This permanently clears conversation history for this thread.",
            ].join("\n"),
            { variant: "destructive" },
          ),
        );
        if (confirmationResult._tag === "Failure") {
          return confirmationResult;
        }
        if (!confirmationResult.value) {
          return AsyncResult.success(undefined);
        }
      }

      return deleteThread(target);
    },
    [confirmThreadDelete, deleteThread, resolveThreadTarget],
  );

  return useMemo(
    () => ({
      archiveThread,
      unarchiveThread,
      deleteThread,
      confirmAndDeleteThread,
      settleThread,
      unsettleThread,
      snoozeThread,
      unsnoozeThread,
      pinThread,
      unpinThread,
      confirmAndUnpinThread,
      isWorktreeCardPinned,
      reorderPinnedThread,
      reorderActiveThread,
    }),
    [
      archiveThread,
      confirmAndDeleteThread,
      confirmAndUnpinThread,
      isWorktreeCardPinned,
      deleteThread,
      pinThread,
      reorderPinnedThread,
      reorderActiveThread,
      settleThread,
      snoozeThread,
      unarchiveThread,
      unpinThread,
      unsettleThread,
      unsnoozeThread,
    ],
  );
}
