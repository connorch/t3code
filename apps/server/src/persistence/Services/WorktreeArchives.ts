/**
 * WorktreeArchiveRepository - Persistence for archived worktrees.
 *
 * A row records one "archive worktree" action: which worktree was archived,
 * the threads archived along with it (as a snapshot of id + title), and the
 * on-disk path of the compressed `.context` directory if one existed.
 *
 * @module WorktreeArchiveRepository
 */
import { IsoDateTime, ProjectId, VcsWorktreeArchiveThread } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const WorktreeArchiveRecord = Schema.Struct({
  id: Schema.String,
  projectId: ProjectId,
  worktreePath: Schema.String,
  branch: Schema.NullOr(Schema.String),
  name: Schema.String,
  threads: Schema.Array(VcsWorktreeArchiveThread),
  contextArchivePath: Schema.NullOr(Schema.String),
  archivedAt: IsoDateTime,
});
export type WorktreeArchiveRecord = typeof WorktreeArchiveRecord.Type;

export const GetWorktreeArchiveInput = Schema.Struct({
  id: Schema.String,
});
export type GetWorktreeArchiveInput = typeof GetWorktreeArchiveInput.Type;

export const DeleteWorktreeArchiveInput = Schema.Struct({
  id: Schema.String,
});
export type DeleteWorktreeArchiveInput = typeof DeleteWorktreeArchiveInput.Type;

/**
 * WorktreeArchiveRepositoryShape - Service API for worktree archive records.
 */
export interface WorktreeArchiveRepositoryShape {
  /**
   * Insert a worktree archive record.
   */
  readonly insert: (
    record: WorktreeArchiveRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a worktree archive record by id.
   */
  readonly getById: (
    input: GetWorktreeArchiveInput,
  ) => Effect.Effect<Option.Option<WorktreeArchiveRecord>, ProjectionRepositoryError>;

  /**
   * List all worktree archive records, newest first.
   */
  readonly list: () => Effect.Effect<
    ReadonlyArray<WorktreeArchiveRecord>,
    ProjectionRepositoryError
  >;

  /**
   * Delete a worktree archive record by id (used after a successful unarchive).
   */
  readonly deleteById: (
    input: DeleteWorktreeArchiveInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * WorktreeArchiveRepository - Service tag for worktree archive persistence.
 */
export class WorktreeArchiveRepository extends Context.Service<
  WorktreeArchiveRepository,
  WorktreeArchiveRepositoryShape
>()("t3/persistence/Services/WorktreeArchives/WorktreeArchiveRepository") {}
