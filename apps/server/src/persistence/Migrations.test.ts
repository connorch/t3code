import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "./Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("runMigrations", (it) => {
  it.effect("replaces the fork's stale WorktreeArchives slot 54 with upstream's migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 53 });
      // A fork database that ran the removed archive feature.
      yield* sql`CREATE TABLE worktree_archives (archive_id TEXT PRIMARY KEY)`;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name, created_at)
        VALUES (54, 'WorktreeArchives', '2026-09-01T00:00:00.000Z')
      `;

      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
      assert.ok(columns.some((column) => column.name === "auto_settle_disabled_at"));
      const ledger = yield* sql<{ readonly name: string }>`
        SELECT name FROM effect_sql_migrations WHERE migration_id = 54
      `;
      assert.deepEqual(ledger, [{ name: "ProjectionThreadsAutoSettleDisabledAt" }]);
    }),
  );
});
