/**
 * WorktreeArchiveService - Archive and restore whole worktrees.
 *
 * Archiving a worktree compresses its `./.context` directory (when present)
 * into the server's worktree-archives directory, archives every live thread
 * pointing at the worktree, records the action, and removes the worktree
 * directory. Unarchiving reverses each step: recreate the worktree on its
 * original branch and path, restore `.context`, and unarchive the recorded
 * threads.
 *
 * @module WorktreeArchiveService
 */
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  CommandId,
  WorktreeArchiveError,
  type GitCommandError,
  type OrchestrationThreadShell,
  type VcsArchiveWorktreeInput,
  type VcsArchiveWorktreeResult,
  type VcsListWorktreeArchivesResult,
  type VcsUnarchiveWorktreeInput,
  type VcsUnarchiveWorktreeResult,
  type VcsWorktreeArchive,
} from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import {
  WorktreeArchiveRepository,
  type WorktreeArchiveRecord,
} from "../persistence/Services/WorktreeArchives.ts";

const CONTEXT_DIR_NAME = ".context";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const toArchiveContract = (record: WorktreeArchiveRecord): VcsWorktreeArchive => ({
  id: record.id,
  projectId: record.projectId,
  worktreePath: record.worktreePath,
  branch: record.branch,
  name: record.name,
  threads: record.threads,
  hasContextArchive: record.contextArchivePath !== null,
  archivedAt: record.archivedAt,
});

export class WorktreeArchiveService extends Context.Service<
  WorktreeArchiveService,
  {
    readonly archive: (
      input: VcsArchiveWorktreeInput,
    ) => Effect.Effect<VcsArchiveWorktreeResult, WorktreeArchiveError | GitCommandError>;
    readonly unarchive: (
      input: VcsUnarchiveWorktreeInput,
    ) => Effect.Effect<VcsUnarchiveWorktreeResult, WorktreeArchiveError | GitCommandError>;
    readonly list: () => Effect.Effect<VcsListWorktreeArchivesResult, WorktreeArchiveError>;
  }
>()("t3/worktreeArchive/WorktreeArchiveService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
  const terminalManager = yield* TerminalManager.TerminalManager;
  const repository = yield* WorktreeArchiveRepository;

  const internalError = (operation: string, detail: string) => (cause: unknown) =>
    new WorktreeArchiveError({ operation, detail, cause });

  const randomUUID = (operation: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.mapError(internalError(operation, "Failed to generate an identifier.")),
    );

  const serverCommandId = (tag: string, operation: string) =>
    Effect.map(randomUUID(operation), (uuid) => CommandId.make(`server:${tag}:${uuid}`));

  // `tar` ships with macOS, Linux, and Windows 10+ (bsdtar as tar.exe), so a
  // single code path covers every supported host.
  const runTar = (operation: string, args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const { exitCode, stderr } = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* commandSpawner.spawn(
            ChildProcess.make("tar", [...args], { stdin: "ignore", stdout: "ignore" }),
          );
          const [stderrText, code] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(child.stderr)), child.exitCode],
            { concurrency: "unbounded" },
          );
          return { exitCode: code, stderr: stderrText };
        }),
      ).pipe(Effect.mapError(internalError(operation, "Failed to run tar.")));
      if (exitCode !== 0) {
        return yield* new WorktreeArchiveError({
          operation,
          detail: `tar exited with code ${exitCode}: ${stderr.trim() || "no stderr output"}`,
        });
      }
    });

  const pathExists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));

  const requireProject = (operation: string, projectId: VcsArchiveWorktreeInput["projectId"]) =>
    projectionSnapshotQuery.getProjectShellById(projectId).pipe(
      Effect.mapError(internalError(operation, "Failed to look up the project.")),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new WorktreeArchiveError({ operation, detail: "Project not found." })),
          onSome: Effect.succeed,
        }),
      ),
    );

  const dispatchCommand = (
    operation: string,
    command: Parameters<typeof orchestrationEngine.dispatch>[0],
  ) =>
    orchestrationEngine
      .dispatch(command)
      .pipe(Effect.mapError(internalError(operation, `Failed to dispatch ${command.type}.`)));

  // Mirrors the follow-up the ws dispatchCommand handler performs after a
  // client-initiated thread.archive: stop a live provider session and close
  // the thread's terminals. Both are best-effort.
  const stopSessionAndCloseTerminals = (operation: string, thread: OrchestrationThreadShell) =>
    Effect.gen(function* () {
      if (thread.session !== null && thread.session.status !== "stopped") {
        yield* Effect.gen(function* () {
          const commandId = yield* serverCommandId("worktree-archive-session-stop", operation);
          const createdAt = yield* nowIso;
          yield* dispatchCommand(operation, {
            type: "thread.session.stop",
            commandId,
            threadId: thread.id,
            createdAt,
          });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to stop provider session during worktree archive", {
              threadId: thread.id,
              cause,
            }),
          ),
        );
      }
      yield* terminalManager.close({ threadId: thread.id }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to close thread terminals during worktree archive", {
            threadId: thread.id,
            error: error.message,
          }),
        ),
      );
    });

  const archive: WorktreeArchiveService["Service"]["archive"] = Effect.fn(
    "WorktreeArchiveService.archive",
  )(function* (input) {
    const operation = "WorktreeArchiveService.archive";
    const project = yield* requireProject(operation, input.projectId);

    const shellSnapshot = yield* projectionSnapshotQuery
      .getShellSnapshot()
      .pipe(Effect.mapError(internalError(operation, "Failed to load thread state.")));
    const threads = shellSnapshot.threads.filter(
      (thread) =>
        thread.projectId === input.projectId && thread.worktreePath === input.worktreePath,
    );

    const runningCount = threads.filter(
      (thread) =>
        thread.session !== null &&
        thread.session.status === "running" &&
        thread.session.activeTurnId !== null,
    ).length;
    if (runningCount > 0) {
      return yield* new WorktreeArchiveError({
        operation,
        detail:
          runningCount === 1
            ? "Cannot archive a worktree while a thread is running."
            : `Cannot archive a worktree while ${runningCount} threads are running.`,
      });
    }

    const archiveId = yield* randomUUID(operation);
    const archivedAt = yield* nowIso;

    // Compress .context before anything touches the worktree directory; the
    // later removal renames the directory aside and deletes it asynchronously.
    const contextDir = path.join(input.worktreePath, CONTEXT_DIR_NAME);
    let contextArchivePath: string | null = null;
    if (yield* pathExists(contextDir)) {
      contextArchivePath = path.join(config.worktreeArchivesDir, `${archiveId}.tar.gz`);
      yield* runTar(operation, [
        "-czf",
        contextArchivePath,
        "-C",
        input.worktreePath,
        CONTEXT_DIR_NAME,
      ]);
    }

    const record: WorktreeArchiveRecord = {
      id: archiveId,
      projectId: input.projectId,
      worktreePath: input.worktreePath,
      branch: threads.findLast((thread) => thread.branch !== null)?.branch ?? null,
      name: input.name,
      threads: threads.map((thread) => ({ id: thread.id, title: thread.title })),
      contextArchivePath,
      archivedAt,
    };

    // Persist the record before the destructive steps so a partial failure
    // still leaves an entry the user can unarchive (unarchive tolerates a
    // worktree directory that was never removed).
    yield* repository
      .insert(record)
      .pipe(Effect.mapError(internalError(operation, "Failed to record the worktree archive.")));

    for (const thread of threads) {
      const commandId = yield* serverCommandId("worktree-archive-thread", operation);
      yield* dispatchCommand(operation, {
        type: "thread.archive",
        commandId,
        threadId: thread.id,
      });
      yield* stopSessionAndCloseTerminals(operation, thread);
    }

    // Removal failures leave the directory behind but keep the archive valid;
    // unarchive skips worktree creation when the directory still exists.
    yield* gitWorkflow
      .removeWorktree({ cwd: project.workspaceRoot, path: input.worktreePath, force: true })
      .pipe(
        Effect.catch((error) =>
          Effect.logWarning("failed to remove worktree directory during archive", {
            worktreePath: input.worktreePath,
            error: error.message,
          }),
        ),
      );

    return { archive: toArchiveContract(record) };
  });

  const unarchive: WorktreeArchiveService["Service"]["unarchive"] = Effect.fn(
    "WorktreeArchiveService.unarchive",
  )(function* (input) {
    const operation = "WorktreeArchiveService.unarchive";
    const record = yield* repository.getById({ id: input.archiveId }).pipe(
      Effect.mapError(internalError(operation, "Failed to load the worktree archive.")),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new WorktreeArchiveError({ operation, detail: "Worktree archive not found." }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    const project = yield* requireProject(operation, record.projectId);

    // A directory that still exists is treated as the original worktree (for
    // example when the archive-time removal failed); recreate it otherwise.
    if (!(yield* pathExists(record.worktreePath))) {
      if (record.branch === null) {
        return yield* new WorktreeArchiveError({
          operation,
          detail: "Cannot restore this worktree: no branch was recorded when it was archived.",
        });
      }
      yield* gitWorkflow.createWorktree({
        cwd: project.workspaceRoot,
        refName: record.branch,
        path: record.worktreePath,
      });
    }

    if (record.contextArchivePath !== null) {
      const contextDir = path.join(record.worktreePath, CONTEXT_DIR_NAME);
      const tarballExists = yield* pathExists(record.contextArchivePath);
      if (tarballExists && !(yield* pathExists(contextDir))) {
        yield* runTar(operation, ["-xzf", record.contextArchivePath, "-C", record.worktreePath]);
      }
    }

    // Best-effort: threads deleted or manually unarchived since the worktree
    // was archived simply fail their invariant check and are skipped.
    for (const thread of record.threads) {
      const commandId = yield* serverCommandId("worktree-unarchive-thread", operation);
      yield* orchestrationEngine
        .dispatch({ type: "thread.unarchive", commandId, threadId: thread.id })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to unarchive thread during worktree unarchive", {
              threadId: thread.id,
              cause,
            }),
          ),
        );
    }

    if (record.contextArchivePath !== null) {
      yield* fileSystem
        .remove(record.contextArchivePath, { force: true })
        .pipe(Effect.ignoreCause({ log: true }));
    }
    yield* repository
      .deleteById({ id: record.id })
      .pipe(Effect.mapError(internalError(operation, "Failed to delete the worktree archive.")));

    return {
      worktree: { path: record.worktreePath, refName: record.branch ?? "HEAD" },
    };
  });

  const list: WorktreeArchiveService["Service"]["list"] = () =>
    repository.list().pipe(
      Effect.map((records) => ({ archives: records.map(toArchiveContract) })),
      Effect.mapError(
        internalError("WorktreeArchiveService.list", "Failed to list worktree archives."),
      ),
    );

  return { archive, unarchive, list } satisfies WorktreeArchiveService["Service"];
});

export const layer = Layer.effect(WorktreeArchiveService, make);
