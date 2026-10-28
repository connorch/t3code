import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  resolveNewThreadModelSelectionOverride,
  startNewThreadInCurrentWorkspace,
  type ChatThreadActionContext,
} from "./chatThreadActions";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");
const FALLBACK_PROJECT_ID = ProjectId.make("project-2");

const PROJECT_DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const CARRIED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "carried-model",
};

function createContext(overrides: Partial<ChatThreadActionContext> = {}): ChatThreadActionContext {
  return {
    activeDraftThread: null,
    activeThread: undefined,
    defaultProjectRef: scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID),
    handleNewThread: async () => {},
    ...overrides,
  };
}

describe("chatThreadActions", () => {
  it("does not carry a non-explicit model from the destination draft back into itself", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-a",
      }),
    ).toBeNull();
  });

  it("keeps the project default above any carried selection", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
      }),
    ).toEqual(PROJECT_DEFAULT_SELECTION);
  });

  it("carries the active thread's worktree when starting in the current workspace", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadInCurrentWorkspace(
      createContext({
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/foo",
          worktreePath: "/tmp/worktrees/foo",
        },
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      branch: "feature/foo",
      worktreePath: "/tmp/worktrees/foo",
      envMode: "worktree",
      startFromOrigin: false,
    });
  });

  it("preselects the current checkout when the active thread runs on the root checkout", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadInCurrentWorkspace(
      createContext({
        activeThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "main",
          worktreePath: null,
        },
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      branch: null,
      worktreePath: null,
      envMode: "local",
      startFromOrigin: false,
    });
  });

  it("carries an open draft's workspace selection verbatim", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadInCurrentWorkspace(
      createContext({
        activeDraftThread: {
          environmentId: ENVIRONMENT_ID,
          projectId: PROJECT_ID,
          branch: "feature/bar",
          worktreePath: null,
          envMode: "worktree",
          startFromOrigin: true,
        },
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(scopeProjectRef(ENVIRONMENT_ID, PROJECT_ID), {
      branch: "feature/bar",
      worktreePath: null,
      envMode: "worktree",
      startFromOrigin: true,
    });
  });

  it("defaults to the current checkout when there is no active thread context", async () => {
    const handleNewThread = vi.fn<ChatThreadActionContext["handleNewThread"]>(async () => {});

    const didStart = await startNewThreadInCurrentWorkspace(
      createContext({
        handleNewThread,
      }),
    );

    expect(didStart).toBe(true);
    expect(handleNewThread).toHaveBeenCalledWith(
      scopeProjectRef(ENVIRONMENT_ID, FALLBACK_PROJECT_ID),
      {
        branch: null,
        worktreePath: null,
        envMode: "local",
        startFromOrigin: false,
      },
    );
  });
});
