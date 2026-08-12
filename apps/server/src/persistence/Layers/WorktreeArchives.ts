import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteWorktreeArchiveInput,
  GetWorktreeArchiveInput,
  WorktreeArchiveRecord,
  WorktreeArchiveRepository,
  type WorktreeArchiveRepositoryShape,
} from "../Services/WorktreeArchives.ts";
import { VcsWorktreeArchiveThread } from "@t3tools/contracts";

const WorktreeArchiveDbRow = WorktreeArchiveRecord.mapFields(
  Struct.assign({
    threads: Schema.fromJsonString(Schema.Array(VcsWorktreeArchiveThread)),
  }),
);

const makeWorktreeArchiveRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertWorktreeArchiveRow = SqlSchema.void({
    Request: WorktreeArchiveRecord,
    execute: (row) =>
      sql`
        INSERT INTO worktree_archives (
          id,
          project_id,
          worktree_path,
          branch,
          name,
          threads,
          context_archive_path,
          archived_at
        )
        VALUES (
          ${row.id},
          ${row.projectId},
          ${row.worktreePath},
          ${row.branch},
          ${row.name},
          ${JSON.stringify(row.threads)},
          ${row.contextArchivePath},
          ${row.archivedAt}
        )
      `,
  });

  const getWorktreeArchiveRow = SqlSchema.findOneOption({
    Request: GetWorktreeArchiveInput,
    Result: WorktreeArchiveDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          id,
          project_id AS "projectId",
          worktree_path AS "worktreePath",
          branch,
          name,
          threads,
          context_archive_path AS "contextArchivePath",
          archived_at AS "archivedAt"
        FROM worktree_archives
        WHERE id = ${id}
      `,
  });

  const listWorktreeArchiveRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: WorktreeArchiveDbRow,
    execute: () =>
      sql`
        SELECT
          id,
          project_id AS "projectId",
          worktree_path AS "worktreePath",
          branch,
          name,
          threads,
          context_archive_path AS "contextArchivePath",
          archived_at AS "archivedAt"
        FROM worktree_archives
        ORDER BY archived_at DESC, id DESC
      `,
  });

  const deleteWorktreeArchiveRow = SqlSchema.void({
    Request: DeleteWorktreeArchiveInput,
    execute: ({ id }) =>
      sql`
        DELETE FROM worktree_archives
        WHERE id = ${id}
      `,
  });

  const insert: WorktreeArchiveRepositoryShape["insert"] = (record) =>
    insertWorktreeArchiveRow(record).pipe(
      Effect.mapError(toPersistenceSqlError("WorktreeArchiveRepository.insert:query")),
    );

  const getById: WorktreeArchiveRepositoryShape["getById"] = (input) =>
    getWorktreeArchiveRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("WorktreeArchiveRepository.getById:query")),
    );

  const list: WorktreeArchiveRepositoryShape["list"] = () =>
    listWorktreeArchiveRows({}).pipe(
      Effect.mapError(toPersistenceSqlError("WorktreeArchiveRepository.list:query")),
    );

  const deleteById: WorktreeArchiveRepositoryShape["deleteById"] = (input) =>
    deleteWorktreeArchiveRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("WorktreeArchiveRepository.deleteById:query")),
    );

  return {
    insert,
    getById,
    list,
    deleteById,
  } satisfies WorktreeArchiveRepositoryShape;
});

export const WorktreeArchiveRepositoryLive = Layer.effect(
  WorktreeArchiveRepository,
  makeWorktreeArchiveRepository,
);
