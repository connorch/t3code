import type {
  OrchestrationThreadShell,
  PreviewSessionSnapshot,
  ProjectScript,
  ThreadId,
} from "@t3tools/contracts";

export function shouldShowPreviewEmptyState(snapshot: PreviewSessionSnapshot | null): boolean {
  return snapshot === null || snapshot.navStatus._tag === "Idle";
}

export function getConfiguredPreviewUrls(
  scripts: ReadonlyArray<ProjectScript> | undefined,
): ReadonlyArray<string> {
  return scripts?.flatMap((script) => (script.previewUrl ? [script.previewUrl] : [])) ?? [];
}

/**
 * Picks the servers started from terminals of threads that share the active
 * thread's worktree. Threads without a worktree share the project root, so
 * they count as one worktree. `projectThreads` must be the active thread's
 * project threads; servers not started from a T3 terminal never match.
 */
export function selectWorktreeServers<
  S extends { readonly terminal: { readonly threadId: ThreadId } | null },
>(input: {
  readonly servers: ReadonlyArray<S>;
  readonly activeThread: Pick<OrchestrationThreadShell, "worktreePath"> | null;
  readonly projectThreads: ReadonlyArray<Pick<OrchestrationThreadShell, "id" | "worktreePath">>;
}): ReadonlyArray<S> {
  const { activeThread } = input;
  if (activeThread === null) return [];
  const threadIds = new Set(
    input.projectThreads
      .filter((thread) => thread.worktreePath === activeThread.worktreePath)
      .map((thread) => thread.id),
  );
  return input.servers.filter(
    (server) => server.terminal !== null && threadIds.has(server.terminal.threadId),
  );
}
