import { describe, expect, it } from "vite-plus/test";

import {
  partitionThreadsForConnorSidebar,
  resolveConnorGroupIndicator,
  resolveConnorThreadDot,
  resolveGroupNavigationThread,
  resolveWorktreeDisplayName,
  worktreeGroupKey,
  type ConnorGroupableThread,
  type ConnorStatusThread,
} from "./SidebarConnor.logic";

type TestThread = ConnorGroupableThread & ConnorStatusThread;

function makeThread(overrides: Partial<TestThread> & { id: string }): TestThread {
  return {
    environmentId: "env-1",
    projectId: "proj-1",
    title: `Thread ${overrides.id}`,
    branch: null,
    worktreePath: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    archivedAt: null,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "default",
    latestTurn: null,
    session: null,
    backgroundLiveness: null,
    ...overrides,
  };
}

function completedTurn(completedAt: string): TestThread["latestTurn"] {
  return {
    turnId: "turn-1",
    state: "completed",
    requestedAt: completedAt,
    startedAt: completedAt,
    completedAt,
    assistantMessageId: null,
  } as unknown as TestThread["latestTurn"];
}

function errorSession(): TestThread["session"] {
  return {
    threadId: "t",
    status: "error",
    providerName: null,
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: "boom",
    updatedAt: "2026-08-06T00:00:00.000Z",
  } as unknown as TestThread["session"];
}

const WT_A = "/Users/x/.t3/worktrees/repo/branch-a";
const WT_B = "/Users/x/.t3/worktrees/repo/branch-b";

describe("partitionThreadsForConnorSidebar", () => {
  it("splits worktree threads into groups and leaves the rest flat", () => {
    const threads = [
      makeThread({ id: "t1", createdAt: "2026-08-01T00:00:00.000Z" }),
      makeThread({ id: "t2", worktreePath: WT_A, createdAt: "2026-08-02T00:00:00.000Z" }),
      makeThread({ id: "t3", worktreePath: WT_A, createdAt: "2026-08-03T00:00:00.000Z" }),
      makeThread({ id: "t4", worktreePath: WT_B, createdAt: "2026-08-04T00:00:00.000Z" }),
    ];
    const { ungroupedThreads, worktreeGroups } = partitionThreadsForConnorSidebar(threads);
    expect(ungroupedThreads.map((thread) => thread.id)).toEqual(["t1"]);
    expect(worktreeGroups.map((group) => group.worktreePath)).toEqual([WT_B, WT_A]);
    expect(worktreeGroups[1]!.threads.map((thread) => thread.id)).toEqual(["t2", "t3"]);
  });

  it("keeps within-group threads in creation order, oldest first", () => {
    const threads = [
      makeThread({ id: "new", worktreePath: WT_A, createdAt: "2026-08-05T00:00:00.000Z" }),
      makeThread({ id: "old", worktreePath: WT_A, createdAt: "2026-08-01T00:00:00.000Z" }),
    ];
    const { worktreeGroups } = partitionThreadsForConnorSidebar(threads);
    expect(worktreeGroups[0]!.threads.map((thread) => thread.id)).toEqual(["old", "new"]);
  });

  it("orders groups by their first thread, newest worktree on top", () => {
    const threads = [
      makeThread({ id: "a1", worktreePath: WT_A, createdAt: "2026-08-01T00:00:00.000Z" }),
      // A later thread in an old worktree must not float the group above a
      // newer worktree: ordering is static, activity lives in indicators.
      makeThread({ id: "a2", worktreePath: WT_A, createdAt: "2026-08-09T00:00:00.000Z" }),
      makeThread({ id: "b1", worktreePath: WT_B, createdAt: "2026-08-05T00:00:00.000Z" }),
    ];
    const { worktreeGroups } = partitionThreadsForConnorSidebar(threads);
    expect(worktreeGroups.map((group) => group.worktreePath)).toEqual([WT_B, WT_A]);
  });

  it("excludes archived threads and treats blank worktree paths as ungrouped", () => {
    const threads = [
      makeThread({ id: "archived", worktreePath: WT_A, archivedAt: "2026-08-02T00:00:00.000Z" }),
      makeThread({ id: "blank", worktreePath: "   " }),
    ];
    const { ungroupedThreads, worktreeGroups } = partitionThreadsForConnorSidebar(threads);
    expect(worktreeGroups).toEqual([]);
    expect(ungroupedThreads.map((thread) => thread.id)).toEqual(["blank"]);
  });

  it("does not merge equal worktree paths across environments", () => {
    const threads = [
      makeThread({ id: "local", worktreePath: WT_A, environmentId: "env-1" }),
      makeThread({ id: "remote", worktreePath: WT_A, environmentId: "env-2" }),
    ];
    const { worktreeGroups } = partitionThreadsForConnorSidebar(threads);
    expect(worktreeGroups).toHaveLength(2);
  });

  it("takes the branch from the newest member that has one", () => {
    const threads = [
      makeThread({
        id: "first",
        worktreePath: WT_A,
        branch: "old-branch",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
      makeThread({
        id: "second",
        worktreePath: WT_A,
        branch: "new-branch",
        createdAt: "2026-08-02T00:00:00.000Z",
      }),
      makeThread({
        id: "third",
        worktreePath: WT_A,
        branch: null,
        createdAt: "2026-08-03T00:00:00.000Z",
      }),
    ];
    const { worktreeGroups } = partitionThreadsForConnorSidebar(threads);
    expect(worktreeGroups[0]!.branch).toBe("new-branch");
  });
});

describe("resolveWorktreeDisplayName", () => {
  const group = {
    key: worktreeGroupKey("env-1", WT_A),
    worktreePath: WT_A,
    threads: [{ title: "First thread" }, { title: "Second thread" }],
  };

  it("prefers the custom name", () => {
    expect(resolveWorktreeDisplayName(group, { [group.key]: "My worktree" })).toBe("My worktree");
  });

  it("falls back to the first thread's title", () => {
    expect(resolveWorktreeDisplayName(group, {})).toBe("First thread");
  });

  it("falls back to the directory name when there are no titles", () => {
    expect(resolveWorktreeDisplayName({ ...group, threads: [] }, {})).toBe("branch-a");
  });
});

describe("resolveConnorGroupIndicator", () => {
  it("prioritizes approval over question over failed over working over unread", () => {
    const unread = makeThread({ id: "u", latestTurn: completedTurn("2026-08-02T00:00:00.000Z") });
    const visited = { [`env-1:u`]: "2026-08-01T00:00:00.000Z" };
    const working = makeThread({ id: "w", backgroundLiveness: "working" });
    const failed = makeThread({ id: "f", session: errorSession() });
    const question = makeThread({ id: "q", hasPendingUserInput: true });
    const approval = makeThread({ id: "a", hasPendingApprovals: true });

    expect(
      resolveConnorGroupIndicator([unread, working, failed, question, approval], visited),
    ).toEqual({
      kind: "question",
      tone: "approval",
    });
    expect(resolveConnorGroupIndicator([unread, working, failed, question], visited)).toEqual({
      kind: "question",
      tone: "input",
    });
    expect(resolveConnorGroupIndicator([unread, working, failed], visited)).toEqual({
      kind: "failed",
    });
    expect(resolveConnorGroupIndicator([unread, working], visited)).toEqual({ kind: "working" });
    expect(resolveConnorGroupIndicator([unread], visited)).toEqual({ kind: "unread" });
    expect(resolveConnorGroupIndicator([makeThread({ id: "idle" })], {})).toBeNull();
  });

  it("does not count never-visited completions as unread", () => {
    const thread = makeThread({ id: "t", latestTurn: completedTurn("2026-08-02T00:00:00.000Z") });
    expect(resolveConnorGroupIndicator([thread], {})).toBeNull();
  });
});

describe("resolveConnorThreadDot", () => {
  it("maps statuses to dots", () => {
    expect(
      resolveConnorThreadDot(makeThread({ id: "a", hasPendingApprovals: true }), undefined),
    ).toBe("approval");
    expect(
      resolveConnorThreadDot(makeThread({ id: "q", hasPendingUserInput: true }), undefined),
    ).toBe("input");
    expect(
      resolveConnorThreadDot(makeThread({ id: "w", backgroundLiveness: "working" }), undefined),
    ).toBe("working");
    const unread = makeThread({ id: "u", latestTurn: completedTurn("2026-08-02T00:00:00.000Z") });
    expect(resolveConnorThreadDot(unread, "2026-08-01T00:00:00.000Z")).toBe("unread");
    expect(resolveConnorThreadDot(unread, "2026-08-03T00:00:00.000Z")).toBeNull();
  });
});

describe("resolveGroupNavigationThread", () => {
  const groupOf = (threads: TestThread[]) => ({
    key: worktreeGroupKey("env-1", WT_A),
    environmentId: "env-1",
    projectId: "proj-1",
    worktreePath: WT_A,
    branch: null,
    threads,
  });

  it("prefers the remembered last-viewed thread", () => {
    const group = groupOf([makeThread({ id: "t1" }), makeThread({ id: "t2" })]);
    expect(resolveGroupNavigationThread(group, { [group.key]: "env-1:t1" }, {})?.id).toBe("t1");
  });

  it("ignores a remembered thread that no longer exists in the group", () => {
    const group = groupOf([
      makeThread({ id: "t1", createdAt: "2026-08-01T00:00:00.000Z" }),
      makeThread({ id: "t2", createdAt: "2026-08-02T00:00:00.000Z" }),
    ]);
    // Falls through to most recently visited.
    expect(
      resolveGroupNavigationThread(
        group,
        { [group.key]: "env-1:deleted" },
        { "env-1:t1": "2026-08-05T00:00:00.000Z" },
      )?.id,
    ).toBe("t1");
  });

  it("falls back to the newest thread when nothing was ever visited", () => {
    const group = groupOf([
      makeThread({ id: "old", createdAt: "2026-08-01T00:00:00.000Z" }),
      makeThread({ id: "new", createdAt: "2026-08-02T00:00:00.000Z" }),
    ]);
    expect(resolveGroupNavigationThread(group, {}, {})?.id).toBe("new");
  });
});
