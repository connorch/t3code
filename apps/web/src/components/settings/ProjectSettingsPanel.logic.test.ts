import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { planProjectRemoval } from "@t3tools/client-runtime/state/projects";

import { linkProjectGroups, unlinkProject } from "./ProjectSettingsPanel.logic";

describe("project removal confirmation", () => {
  const local = {
    id: ProjectId.make("shared-id"),
    environmentId: EnvironmentId.make("local"),
    title: "Repo",
    workspaceRoot: "/work/repo",
    environmentLabel: "Local",
  };
  const remote = {
    ...local,
    environmentId: EnvironmentId.make("remote"),
    environmentLabel: "Remote",
  };

  it("limits a checkout's thread count to its environment and project", () => {
    const plan = planProjectRemoval({
      members: [local],
      groupMemberCount: 2,
      hasOtherMembers: false,
      displayName: "Repo",
      threads: [
        { environmentId: local.environmentId, projectId: local.id },
        { environmentId: remote.environmentId, projectId: remote.id },
      ],
    });
    expect(plan.projectThreads).toHaveLength(1);
    expect(plan.confirmationMessage).toBe(
      'Remove checkout "Repo" and delete its 1 thread?\nPath: /work/repo\nEnvironment: Local\nThis permanently clears conversation history for those threads and any archived threads.\nOther entries in this grouped project are unaffected.\nThis action cannot be undone.',
    );
  });

  it("keeps an environment-filtered group scoped to its selected checkout", () => {
    const plan = planProjectRemoval({
      members: [remote],
      groupMemberCount: 1,
      hasOtherMembers: true,
      displayName: "Repo",
      threads: [],
    });
    expect(plan.targetKind).toBe("checkout");
    expect(plan.confirmationMessage).toContain("Environment: Remote");
    expect(plan.confirmationMessage).toContain(
      "Other entries in this grouped project are unaffected.",
    );
    expect(plan.confirmationMessage).toContain(
      "This permanently clears any archived conversation history.",
    );
  });

  // regression: #21409 project-wide removal must count every checkout's threads and keep files
  it("states the full group count and preserves files when removing a project everywhere", () => {
    const plan = planProjectRemoval({
      members: [local, remote],
      groupMemberCount: 2,
      hasOtherMembers: false,
      displayName: "Repo",
      threads: [],
    });
    expect(plan.targetKind).toBe("project");
    expect(plan.confirmationMessage).toContain("This removes 2 grouped project entries.");
    expect(plan.confirmationMessage).toContain(
      "This removes only the project entries, not the files on disk.",
    );
  });
});

describe("linkProjectGroups", () => {
  const newLinkId = () => "fresh";

  it("gives every member of both groups a new shared link id", () => {
    expect(
      linkProjectGroups({
        links: {},
        memberKeys: ["studio:/a"],
        targetMemberKeys: ["macbook:/b", "macbook:/c"],
        newLinkId,
      }),
    ).toEqual({ "studio:/a": "fresh", "macbook:/b": "fresh", "macbook:/c": "fresh" });
  });

  it("extends an existing link instead of minting a new id", () => {
    expect(
      linkProjectGroups({
        links: { "studio:/a": "old", "macbook:/b": "old" },
        memberKeys: ["studio:/a", "macbook:/b"],
        targetMemberKeys: ["linux:/c"],
        newLinkId,
      }),
    ).toEqual({ "studio:/a": "old", "macbook:/b": "old", "linux:/c": "old" });
  });

  it("merges two links, moving the target link's other members too", () => {
    expect(
      linkProjectGroups({
        links: { "studio:/a": "one", "macbook:/b": "two", "linux:/c": "two" },
        memberKeys: ["studio:/a"],
        targetMemberKeys: ["macbook:/b", "linux:/c"],
        newLinkId,
      }),
    ).toEqual({ "studio:/a": "one", "macbook:/b": "one", "linux:/c": "one" });
  });
});

describe("unlinkProject", () => {
  it("removes one member and keeps a link that still has two", () => {
    expect(
      unlinkProject({ "studio:/a": "one", "macbook:/b": "one", "linux:/c": "one" }, "linux:/c"),
    ).toEqual({ "studio:/a": "one", "macbook:/b": "one" });
  });

  it("drops the whole link when one member would remain", () => {
    expect(
      unlinkProject({ "studio:/a": "one", "macbook:/b": "one", "linux:/c": "two" }, "studio:/a"),
    ).toEqual({ "linux:/c": "two" });
  });

  it("returns the same map for an unlinked project", () => {
    const links = { "studio:/a": "one" };
    expect(unlinkProject(links, "macbook:/b")).toBe(links);
  });
});
