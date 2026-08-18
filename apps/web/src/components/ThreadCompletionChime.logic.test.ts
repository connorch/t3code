import { describe, expect, it } from "vite-plus/test";

import { parseCompletedAtMs, scanThreadCompletions } from "./ThreadCompletionChime.logic";

const RUNNING = { key: "env:thread-a", completedAtMs: null } as const;
const FINISHED = { key: "env:thread-a", completedAtMs: 1_000 } as const;

describe("scanThreadCompletions", () => {
  it("stays silent on the first scan, even when turns already finished", () => {
    const { snapshot, completed } = scanThreadCompletions(null, [FINISHED]);

    expect(completed).toBe(false);
    expect(snapshot.get("env:thread-a")).toBe(1_000);
  });

  it("announces a turn that finishes while watching", () => {
    const seeded = scanThreadCompletions(null, [RUNNING]);

    expect(scanThreadCompletions(seeded.snapshot, [FINISHED]).completed).toBe(true);
  });

  it("announces the next turn on a thread that already finished one", () => {
    const seeded = scanThreadCompletions(null, [FINISHED]);
    const running = scanThreadCompletions(seeded.snapshot, [RUNNING]);

    expect(running.completed).toBe(false);
    expect(
      scanThreadCompletions(running.snapshot, [{ key: "env:thread-a", completedAtMs: 2_000 }])
        .completed,
    ).toBe(true);
  });

  it("announces a back-to-back turn even when the running state is never observed", () => {
    const seeded = scanThreadCompletions(null, [FINISHED]);

    expect(
      scanThreadCompletions(seeded.snapshot, [{ key: "env:thread-a", completedAtMs: 2_000 }])
        .completed,
    ).toBe(true);
  });

  it("does not re-announce an unchanged completion", () => {
    const seeded = scanThreadCompletions(null, [FINISHED]);

    expect(scanThreadCompletions(seeded.snapshot, [FINISHED]).completed).toBe(false);
  });

  it("stays silent for threads that appear already finished", () => {
    const seeded = scanThreadCompletions(null, [RUNNING]);

    expect(
      scanThreadCompletions(seeded.snapshot, [RUNNING, { key: "env:thread-b", completedAtMs: 5 }])
        .completed,
    ).toBe(false);
  });

  it("drops threads that are gone so their return is not announced", () => {
    const seeded = scanThreadCompletions(null, [FINISHED]);
    const withoutThread = scanThreadCompletions(seeded.snapshot, []);

    expect(withoutThread.snapshot.size).toBe(0);
    expect(scanThreadCompletions(withoutThread.snapshot, [FINISHED]).completed).toBe(false);
  });

  it("announces once when several threads finish in the same scan", () => {
    const seeded = scanThreadCompletions(null, [
      RUNNING,
      { key: "env:thread-b", completedAtMs: null },
    ]);
    const scan = scanThreadCompletions(seeded.snapshot, [
      FINISHED,
      { key: "env:thread-b", completedAtMs: 1_001 },
    ]);

    expect(scan.completed).toBe(true);
  });
});

describe("parseCompletedAtMs", () => {
  it("reads an ISO timestamp", () => {
    expect(parseCompletedAtMs("2026-08-17T12:00:00.000Z")).toBe(
      Date.parse("2026-08-17T12:00:00.000Z"),
    );
  });

  it("treats missing and unparseable timestamps as unfinished", () => {
    expect(parseCompletedAtMs(null)).toBe(null);
    expect(parseCompletedAtMs(undefined)).toBe(null);
    expect(parseCompletedAtMs("not a date")).toBe(null);
  });
});
