import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DraftId, type DraftSessionState } from "../../composerDraftStore";
import { useWorktreeThreadTabsStore } from "../../worktreeThreadTabsStore";
import {
  collectWorktreeThreadTabs,
  orderWorktreeThreadTabs,
  threadTabCheckoutKey,
} from "./WorktreeThreadTabs.logic";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const checkout = {
  environmentId,
  projectId,
  worktreePath: "/repo/wt",
  pendingWorktreeDraftId: null,
};
function thread(
  id: string,
  overrides: Partial<Parameters<typeof collectWorktreeThreadTabs>[0]["threads"][number]> = {},
) {
  return {
    id: ThreadId.make(id),
    environmentId,
    projectId,
    worktreePath: "/repo/wt",
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}
function draft(id: string, overrides: Partial<DraftSessionState> = {}) {
  return {
    draftId: DraftId.make(id),
    session: {
      threadId: ThreadId.make(id),
      environmentId,
      projectId,
      logicalProjectKey: "project",
      createdAt: "2026-09-02T00:00:00Z",
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "feature",
      worktreePath: "/repo/wt",
      envMode: "worktree",
      startFromOrigin: false,
      ...overrides,
    } satisfies DraftSessionState,
  };
}

describe("checkout thread tabs", () => {
  it("includes only non-archived threads on the same physical worktree and environment", () => {
    const tabs = collectWorktreeThreadTabs({
      checkout,
      drafts: [],
      threads: [
        thread("same"),
        thread("other-worktree", { worktreePath: "/repo/other" }),
        thread("remote", { environmentId: EnvironmentId.make("remote") }),
        thread("archived", { archivedAt: "2026-09-02T00:00:00Z" }),
        thread("same-worktree-other-project", { projectId: ProjectId.make("other") }),
      ],
    });
    expect(tabs.map((tab) => tab.threadId)).toEqual(["same", "same-worktree-other-project"]);
  });

  it("scopes root checkouts to a project and excludes unallocated worktree drafts", () => {
    const root = { ...checkout, worktreePath: null };
    const pending = draft("pending", { worktreePath: null });
    const rootDraft = draft("root-draft", { worktreePath: null, envMode: "local" });
    const tabs = collectWorktreeThreadTabs({
      checkout: root,
      drafts: [pending, rootDraft],
      threads: [
        thread("root", { worktreePath: null }),
        thread("other-project", { worktreePath: null, projectId: ProjectId.make("other") }),
      ],
    });
    expect(tabs.map((tab) => tab.threadId)).toEqual(["root", "root-draft"]);
    expect(
      collectWorktreeThreadTabs({
        checkout: { ...root, pendingWorktreeDraftId: pending.draftId },
        threads: [],
        drafts: [pending, rootDraft],
      }).map((tab) => tab.threadId),
    ).toEqual(["pending"]);
    expect(threadTabCheckoutKey(root)).not.toBe(
      threadTabCheckoutKey({ ...root, environmentId: EnvironmentId.make("remote") }),
    );
  });

  it("keeps a draft's tab identity when it becomes a server thread, without duplicates", () => {
    const session = draft("new");
    const before = collectWorktreeThreadTabs({ checkout, drafts: [session], threads: [] });
    const after = collectWorktreeThreadTabs({
      checkout,
      drafts: [session],
      threads: [thread("new")],
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.kind).toBe("server");
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(
      collectWorktreeThreadTabs({
        checkout,
        drafts: [draft("new", { promotedTo: { environmentId, threadId: ThreadId.make("new") } })],
        threads: [],
      }),
    ).toEqual([]);
  });

  it("defaults to creation order and appends new threads after a custom order", () => {
    const tabs = collectWorktreeThreadTabs({
      checkout,
      drafts: [draft("draft")],
      threads: [thread("new", { createdAt: "2026-09-03T00:00:00Z" }), thread("old")],
    });
    expect(tabs.map((tab) => tab.threadId)).toEqual(["old", "draft", "new"]);
    expect(
      orderWorktreeThreadTabs(tabs, ["local:draft", "deleted", "local:old"]).map(
        (tab) => tab.threadId,
      ),
    ).toEqual(["draft", "old", "new"]);
  });
});

describe("saved checkout tab order", () => {
  beforeEach(() => useWorktreeThreadTabsStore.setState({ orderByCheckout: {} }));

  it("moves only the requested checkout and ignores stale drag targets", () => {
    const store = useWorktreeThreadTabsStore;
    store.getState().move("checkout-a", ["a", "b", "c"], "c", "a");
    store.getState().move("checkout-b", ["x", "y"], "x", "y");
    store.getState().move("checkout-a", ["c", "a", "b"], "missing", "a");
    expect(store.getState().orderByCheckout).toEqual({
      "checkout-a": ["c", "a", "b"],
      "checkout-b": ["y", "x"],
    });
  });
});
