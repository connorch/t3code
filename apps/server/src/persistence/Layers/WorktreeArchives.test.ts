import { ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { WorktreeArchiveRepositoryLive } from "./WorktreeArchives.ts";
import { WorktreeArchiveRepository } from "../Services/WorktreeArchives.ts";

const worktreeArchivesLayer = it.layer(
  WorktreeArchiveRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

worktreeArchivesLayer("WorktreeArchive repository", (it) => {
  it.effect("round-trips records and lists them newest first", () =>
    Effect.gen(function* () {
      const repository = yield* WorktreeArchiveRepository;

      const older = {
        id: "archive-older",
        projectId: ProjectId.make("project-1"),
        worktreePath: "/tmp/worktrees/repo/feature-a",
        branch: "feature-a",
        name: "Feature A",
        threads: [
          { id: ThreadId.make("thread-1"), title: "First thread" },
          { id: ThreadId.make("thread-2"), title: "Second thread" },
        ],
        contextArchivePath: "/tmp/state/worktree-archives/archive-older.tar.gz",
        archivedAt: "2026-08-10T00:00:00.000Z",
      };
      const newer = {
        id: "archive-newer",
        projectId: ProjectId.make("project-1"),
        worktreePath: "/tmp/worktrees/repo/feature-b",
        branch: null,
        name: "Feature B",
        threads: [],
        contextArchivePath: null,
        archivedAt: "2026-08-11T00:00:00.000Z",
      };

      yield* repository.insert(older);
      yield* repository.insert(newer);

      const listed = yield* repository.list();
      assert.deepStrictEqual(
        listed.map((record) => record.id),
        ["archive-newer", "archive-older"],
      );

      const found = yield* repository.getById({ id: older.id });
      if (Option.isNone(found)) {
        return yield* Effect.die("Expected the older archive record to exist.");
      }
      assert.deepStrictEqual(found.value, older);

      yield* repository.deleteById({ id: older.id });
      const remaining = yield* repository.list();
      assert.deepStrictEqual(
        remaining.map((record) => record.id),
        ["archive-newer"],
      );
    }),
  );
});
