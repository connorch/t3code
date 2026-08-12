import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";
import type { DraftThreadEnvMode } from "../composerDraftStore";

interface ThreadContextLike {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
  startFromOrigin?: boolean;
}

interface NewThreadHandler {
  (
    projectRef: ScopedProjectRef,
    options?: {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: DraftThreadEnvMode;
      startFromOrigin?: boolean;
    },
    // The opened draft's identity, which most callers have no use for.
  ): Promise<unknown>;
}

export interface ChatThreadActionContext {
  readonly activeDraftThread: ThreadContextLike | null;
  readonly activeThread: ThreadContextLike | undefined;
  readonly defaultProjectRef: ScopedProjectRef | null;
  readonly handleNewThread: NewThreadHandler;
}

export function resolveNewDraftStartFromOrigin(input: {
  envMode: DraftThreadEnvMode;
  newWorktreesStartFromOrigin: boolean;
}): boolean {
  return input.envMode === "worktree" && input.newWorktreesStartFromOrigin;
}

export function resolveThreadActionProjectRef(
  context: ChatThreadActionContext,
): ScopedProjectRef | null {
  if (context.activeThread) {
    return scopeProjectRef(context.activeThread.environmentId, context.activeThread.projectId);
  }
  if (context.activeDraftThread) {
    return scopeProjectRef(
      context.activeDraftThread.environmentId,
      context.activeDraftThread.projectId,
    );
  }
  return context.defaultProjectRef;
}

// New threads inherit only the *project* from the current context. Branch,
// worktree, and env mode always come from the user's configured defaults —
// carrying them over from the viewed thread meant "new thread" silently
// reused checkouts and branches. Explicit affordances (branch toolbar's
// "new thread in this worktree") pass those options to handleNewThread
// directly instead.
export async function startNewThreadFromContext(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  await context.handleNewThread(projectRef);
  return true;
}

// The explicit counterpart to the above: `chat.newInWorkspace` carries the
// viewed thread's workspace on purpose — its worktree when it has one,
// otherwise the current checkout (branch null = whatever the checkout is on).
// A viewed draft is itself a workspace selection, so it carries verbatim —
// handleNewThread reuses the open draft, and this keeps that a no-op.
export async function startNewThreadInCurrentWorkspace(
  context: ChatThreadActionContext,
): Promise<boolean> {
  const projectRef = resolveThreadActionProjectRef(context);
  if (!projectRef) {
    return false;
  }

  const currentCheckout = {
    branch: null,
    worktreePath: null,
    envMode: "local" as const,
    startFromOrigin: false,
  };
  const thread = context.activeThread;
  const draft = thread ? null : context.activeDraftThread;
  const options = thread
    ? thread.worktreePath
      ? {
          branch: thread.branch ?? null,
          worktreePath: thread.worktreePath,
          envMode: "worktree" as const,
          startFromOrigin: false,
        }
      : currentCheckout
    : draft
      ? {
          branch: draft.branch ?? null,
          worktreePath: draft.worktreePath ?? null,
          envMode:
            draft.envMode ?? (draft.worktreePath ? ("worktree" as const) : ("local" as const)),
          startFromOrigin: draft.startFromOrigin ?? false,
        }
      : currentCheckout;
  await context.handleNewThread(projectRef, options);
  return true;
}
