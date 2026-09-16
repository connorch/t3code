import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";
import clearAutomaticProjectModelDefaults from "./044_ClearAutomaticProjectModelDefaults.ts";

// WorktreeArchives previously occupied upstream slots 41 and 44. Keep its DDL
// idempotent and repair the upstream migrations skipped by those fork databases.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const forkSlot44 = yield* sql<{ readonly name: string }>`
    SELECT name FROM effect_sql_migrations WHERE migration_id = 44
  `;
  if (forkSlot44.some((migration) => migration.name === "WorktreeArchives")) {
    yield* clearAutomaticProjectModelDefaults;
  }

  const authColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
  `;

  if (!authColumns.some((column) => column.name === "client_surface")) {
    yield* sql`
      ALTER TABLE auth_sessions
      ADD COLUMN client_surface TEXT
    `;
  }

  if (!authColumns.some((column) => column.name === "client_app_version")) {
    yield* sql`
      ALTER TABLE auth_sessions
      ADD COLUMN client_app_version TEXT
    `;
  }

  yield* sql`
    CREATE TABLE IF NOT EXISTS worktree_archives (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch TEXT,
      name TEXT NOT NULL,
      threads TEXT NOT NULL,
      context_archive_path TEXT,
      archived_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_worktree_archives_archived_at
    ON worktree_archives(archived_at DESC)
  `;
});
