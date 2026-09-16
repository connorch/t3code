import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import worktreeArchives from "./053_WorktreeArchives.ts";

it.layer(NodeSqliteClient.layerMemory())("053_WorktreeArchives", (it) => {
  it.effect("repairs the fork's occupied migration slot and preserves archived worktrees", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 43 });
      // Reproduce the fork ledger: slot 44 created archives instead of clearing defaults.
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (44, 'WorktreeArchives')`;
      yield* sql`
        INSERT INTO projection_projects
          (project_id, title, workspace_root, default_model_selection_json, scripts_json, created_at, updated_at)
        VALUES ('project', 'Project', '/tmp/project', '{"instanceId":"codex","model":"gpt-5.6-sol"}', '[]', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')
      `;
      yield* sql`
        INSERT INTO orchestration_events
          (event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at, command_id, correlation_id, actor_kind, payload_json, metadata_json)
        VALUES ('created', 'project', 'project', 0, 'project.created', '2026-09-01T00:00:00Z', 'create', 'create', 'client', '{"defaultModelSelection":{"instanceId":"codex","model":"gpt-5.6-sol"}}', '{}')
      `;
      yield* sql`
        CREATE TABLE worktree_archives (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, worktree_path TEXT NOT NULL,
          branch TEXT, name TEXT NOT NULL, threads TEXT NOT NULL,
          context_archive_path TEXT, archived_at TEXT NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO worktree_archives VALUES ('archive', 'project', '/tmp/tree', 'feature', 'Saved', '[]', '/tmp/context.tar', '2026-09-01T00:00:00Z')
      `;
      const before = yield* sql`SELECT * FROM worktree_archives`;
      yield* runMigrations();
      assert.deepStrictEqual(yield* sql`SELECT * FROM worktree_archives`, before);
      const projects = yield* sql<{ readonly selection: string | null }>`
        SELECT default_model_selection_json AS selection FROM projection_projects WHERE project_id = 'project'
      `;
      assert.strictEqual(projects[0]?.selection, null);
      const events = yield* sql<{ readonly selection: string | null }>`
        SELECT json_extract(payload_json, '$.defaultModelSelection') AS selection FROM orchestration_events WHERE event_id = 'created'
      `;
      assert.strictEqual(events[0]?.selection, null);
      // Reapplying the compatibility migration must not lose archives.
      yield* worktreeArchives;
      assert.deepStrictEqual(yield* sql`SELECT * FROM worktree_archives`, before);
    }),
  );

  it.effect("creates archive storage on a fresh upstream database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(worktree_archives)`;
      assert.ok(columns.some((column) => column.name === "context_archive_path"));
      assert.deepStrictEqual(yield* runMigrations(), []);
    }),
  );
});
