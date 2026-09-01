import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

// Fork migration. Lived at slot 041 before the 2026-09 upstream sync took
// slots 041-043; fork databases that already ran it sit at high-water mark 41
// and will skip upstream's 041_AuthSessionClientConnection, so this migration
// also backfills those auth_sessions columns. Every statement is idempotent,
// making the re-run safe on databases coming from either lineage.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

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
