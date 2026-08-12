import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

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
