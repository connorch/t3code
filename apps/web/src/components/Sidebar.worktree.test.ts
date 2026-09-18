import { describe, expect, it } from "vite-plus/test";
import {
  applyWorktreeCardToDropTarget,
  dropSplitsForeignWorktreeCard,
  gatherWorktreeCards,
  resolveWorktreeCardPositions,
  worktreeCardKey,
  worktreeCardMembers,
  worktreeCardOrderWithin,
  worktreeCardSiblings,
  worktreeCardStaysContiguous,
} from "./Sidebar.worktree";

const thread = (id: string, worktreePath: string | null, environmentId = "env") => ({
  id,
  environmentId,
  worktreePath,
});

describe("gatherWorktreeCards", () => {
  it("pulls later members up behind the highest-ranking one, keeping flat order", () => {
    const { pinned, active } = gatherWorktreeCards({
      pinned: [],
      active: [thread("a", "/wt/x"), thread("b", null), thread("c", "/wt/x"), thread("d", "/wt/y")],
    });
    expect(pinned).toEqual([]);
    expect(active.map((t) => t.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("moves unpinned members into the pinned list when any member is pinned", () => {
    const { pinned, active } = gatherWorktreeCards({
      pinned: [thread("p", null), thread("a", "/wt/x")],
      active: [thread("b", null), thread("c", "/wt/x")],
    });
    expect(pinned.map((t) => t.id)).toEqual(["p", "a", "c"]);
    expect(active.map((t) => t.id)).toEqual(["b"]);
  });

  it("keeps the same path on different environments apart", () => {
    const { active } = gatherWorktreeCards({
      pinned: [],
      active: [thread("a", "/wt/x", "one"), thread("b", null), thread("c", "/wt/x", "two")],
    });
    expect(active.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("resolveWorktreeCardPositions", () => {
  it("paints only runs of two or more", () => {
    const positions = resolveWorktreeCardPositions([
      thread("a", "/wt/x"),
      thread("b", "/wt/x"),
      thread("c", "/wt/x"),
      thread("d", "/wt/y"),
      thread("e", null),
      thread("f", null),
    ]);
    expect(positions).toEqual(["first", "middle", "last", null, null, null]);
  });
});

describe("worktreeCardMembers", () => {
  it("returns the contiguous run around the thread", () => {
    const list = [thread("a", "/wt/x"), thread("b", "/wt/x"), thread("c", null)];
    expect(worktreeCardMembers(list, list[1]!).map((t) => t.id)).toEqual(["a", "b"]);
    expect(worktreeCardMembers(list, list[2]!).map((t) => t.id)).toEqual(["c"]);
  });
});

describe("applyWorktreeCardToDropTarget", () => {
  it("moves the siblings with the dragged row as one block in card order", () => {
    const target = applyWorktreeCardToDropTarget(
      { section: "active", pinnedOrder: [], activeOrder: ["b", "x", "a", "c"] },
      "x",
      ["x", "a", "c"],
    );
    expect(target.activeOrder).toEqual(["b", "x", "a", "c"]);
    const moved = applyWorktreeCardToDropTarget(
      { section: "active", pinnedOrder: [], activeOrder: ["a", "c", "b", "x"] },
      "x",
      ["x", "a", "c"],
    );
    expect(moved.activeOrder).toEqual(["b", "x", "a", "c"]);
  });

  it("carries siblings across the pinned divider with the dragged row", () => {
    const target = applyWorktreeCardToDropTarget(
      { section: "pinned", pinnedOrder: ["p", "x"], activeOrder: ["a", "b"] },
      "x",
      ["x", "a"],
    );
    expect(target.pinnedOrder).toEqual(["p", "x", "a"]);
    expect(target.activeOrder).toEqual(["b"]);
  });
});

describe("worktreeCardOrderWithin", () => {
  it("lists the members in their section order", () => {
    expect(worktreeCardOrderWithin(["b", "y", "x", "c"], ["x", "y"])).toEqual(["y", "x"]);
  });
});

describe("worktreeCardStaysContiguous", () => {
  it("accepts reorders inside the card and rejects leaving it", () => {
    expect(worktreeCardStaysContiguous(["b", "y", "x", "c"], ["x", "y"])).toBe(true);
    expect(worktreeCardStaysContiguous(["x", "b", "y", "c"], ["x", "y"])).toBe(false);
  });
});

describe("dropSplitsForeignWorktreeCard", () => {
  const cardKeyOf = (key: string) => (key.startsWith("w") ? "card" : null);
  it("flags a slot between two members of another card", () => {
    expect(dropSplitsForeignWorktreeCard(["w1", "x", "w2"], ["x"], cardKeyOf)).toBe(true);
    expect(dropSplitsForeignWorktreeCard(["x", "w1", "w2"], ["x"], cardKeyOf)).toBe(false);
    expect(dropSplitsForeignWorktreeCard(["w1", "w2", "w3"], ["w2"], cardKeyOf)).toBe(false);
  });
});

describe("worktreeCardSiblings", () => {
  type Shell = Parameters<typeof worktreeCardSiblings>[0][number];
  const shell = (
    id: string,
    overrides: {
      worktreePath?: string | null;
      archivedAt?: string | null;
      settledOverride?: Shell["settledOverride"];
      snoozedUntil?: string | null;
    } = {},
  ): Shell => ({
    id,
    environmentId: "env",
    worktreePath: overrides.worktreePath === undefined ? "/wt/x" : overrides.worktreePath,
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: overrides.settledOverride ?? null,
    snoozedUntil: overrides.snoozedUntil ?? null,
    snoozedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    session: null,
    latestTurn: null,
  });
  it("excludes the thread itself and members that left the card", () => {
    const now = "2026-09-17T12:00:00.000Z";
    const siblings = worktreeCardSiblings(
      [
        shell("self"),
        shell("live"),
        shell("settled", { settledOverride: "settled" }),
        shell("snoozed", { snoozedUntil: "2026-09-18T12:00:00.000Z" }),
        shell("archived", { archivedAt: now }),
        shell("elsewhere", { worktreePath: "/wt/y" }),
        shell("root", { worktreePath: null }),
      ],
      shell("self"),
      { now },
    );
    expect(siblings.map((s) => s.id)).toEqual(["live"]);
    expect(
      worktreeCardSiblings([shell("a")], shell("root", { worktreePath: null }), { now }),
    ).toEqual([]);
    expect(worktreeCardKey(shell("root", { worktreePath: "  " }))).toBeNull();
  });

  it("gives a parked thread no siblings, so it inherits no card state", () => {
    const now = "2026-09-17T12:00:00.000Z";
    const live = [shell("live"), shell("other")];
    expect(
      worktreeCardSiblings(live, shell("settled", { settledOverride: "settled" }), { now }),
    ).toEqual([]);
    expect(
      worktreeCardSiblings(live, shell("snoozed", { snoozedUntil: "2026-09-18T12:00:00.000Z" }), {
        now,
      }),
    ).toEqual([]);
  });
});
