import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectWorktreeServers } from "./previewEmptyStateLogic";

describe("selectWorktreeServers", () => {
  const thread = (id: string, worktreePath: string | null) => ({
    id: ThreadId.make(id),
    worktreePath,
  });
  const server = (port: number, threadId: string | null) => ({
    port,
    terminal: threadId === null ? null : { threadId: ThreadId.make(threadId) },
  });
  const servers = [
    server(5173, "active"),
    server(5174, "sibling"),
    server(5175, "other-worktree"),
    server(5176, "root-thread"),
    server(8080, null),
  ];
  const projectThreads = [
    thread("active", "/wt/a"),
    thread("sibling", "/wt/a"),
    thread("other-worktree", "/wt/b"),
    thread("root-thread", null),
  ];
  const ports = (active: ReturnType<typeof thread> | null) =>
    selectWorktreeServers({ servers, activeThread: active, projectThreads }).map((s) => s.port);

  it("keeps servers started by any thread in the active worktree", () => {
    expect(ports(thread("active", "/wt/a"))).toEqual([5173, 5174]);
  });

  it("treats threads without a worktree as sharing the project root", () => {
    expect(ports(thread("root-active", null))).toEqual([5176]);
  });

  it("matches nothing without an active thread", () => {
    expect(ports(null)).toEqual([]);
  });
});
