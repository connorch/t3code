import { describe, expect, it } from "vite-plus/test";

import {
  linkProjectGroups,
  projectGroupTitleNeedsUpdate,
  unlinkProject,
} from "./ProjectSettingsPanel.logic";

describe("projectGroupTitleNeedsUpdate", () => {
  it("updates divergent member titles even when the next title is the derived group label", () => {
    expect(
      projectGroupTitleNeedsUpdate(["local-title", "remote-title"], "Repository name", true),
    ).toBe(true);
  });

  it("skips an untouched blur when the derived label differs from member titles", () => {
    expect(projectGroupTitleNeedsUpdate(["repo-slug", "repo-slug"], "Repository Name", false)).toBe(
      false,
    );
  });

  it("skips an update when every member already has the next title", () => {
    expect(projectGroupTitleNeedsUpdate(["Shared name", "Shared name"], "Shared name", true)).toBe(
      false,
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
