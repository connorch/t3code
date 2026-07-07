// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";

import { FileFinder, type MixedItem, type MixedSearchResult } from "@ff-labs/fff-node";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type {
  ProjectEntry,
  ProjectListEntriesResult,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";

const WORKSPACE_INDEX_MAX_ENTRIES = 25_000;
const WORKSPACE_INDEX_PAGE_SIZE = WORKSPACE_INDEX_MAX_ENTRIES + 2;
const WORKSPACE_INDEX_SCAN_TIMEOUT = "15 seconds";
const WORKSPACE_INDEX_IDLE_TTL = "15 minutes";
const WORKSPACE_INDEX_SCAN_POLL_INTERVAL = "50 millis";
const WORKSPACE_IGNORED_ENTRY_LIMIT = 5_000;
const WORKSPACE_IGNORED_OUTPUT_MAX_BUFFER = 8 * 1024 * 1024;
const JUNK_IGNORED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".electron-runtime",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".svelte-kit",
  ".turbo",
  ".venv",
  ".vite",
  ".vendor",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "dist-electron",
  "jspm_packages",
  "node_modules",
  "out",
  "output",
  "target",
  "venv",
]);
const JUNK_IGNORED_GIT_PATHSPECS = [...JUNK_IGNORED_DIRECTORY_NAMES].flatMap((directoryName) => [
  `:(exclude)${directoryName}/**`,
  `:(exclude)**/${directoryName}/**`,
]);

export class WorkspaceSearchIndexCreateFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexCreateFailed>()(
  "WorkspaceSearchIndexCreateFailed",
  {
    cwd: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to create the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexScanTimedOut extends Schema.TaggedErrorClass<WorkspaceSearchIndexScanTimedOut>()(
  "WorkspaceSearchIndexScanTimedOut",
  {
    cwd: Schema.String,
    timeout: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace search index for '${this.cwd}' did not finish scanning within ${this.timeout}`;
  }
}

export class WorkspaceSearchIndexSearchFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexSearchFailed>()(
  "WorkspaceSearchIndexSearchFailed",
  {
    cwd: Schema.String,
    queryLength: Schema.Number,
    pageSize: Schema.Number,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Workspace search failed for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexRefreshFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexRefreshFailed>()(
  "WorkspaceSearchIndexRefreshFailed",
  {
    cwd: Schema.String,
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Failed to refresh the workspace search index for '${this.cwd}'.`;
  }
}

export class WorkspaceSearchIndexDestroyFailed extends Schema.TaggedErrorClass<WorkspaceSearchIndexDestroyFailed>()(
  "WorkspaceSearchIndexDestroyFailed",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to destroy the workspace search index for '${this.cwd}'.`;
  }
}

export type WorkspaceSearchIndexError =
  | WorkspaceSearchIndexCreateFailed
  | WorkspaceSearchIndexScanTimedOut
  | WorkspaceSearchIndexSearchFailed
  | WorkspaceSearchIndexRefreshFailed;

export class WorkspaceSearchIndex extends Context.Service<
  WorkspaceSearchIndex,
  {
    readonly list: () => Effect.Effect<ProjectListEntriesResult, WorkspaceSearchIndexSearchFailed>;
    readonly search: (
      query: string,
      limit: number,
    ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceSearchIndexSearchFailed>;
    readonly refresh: () => Effect.Effect<
      void,
      WorkspaceSearchIndexRefreshFailed | WorkspaceSearchIndexScanTimedOut
    >;
  }
>()("t3/workspace/WorkspaceSearchIndex") {}

function toPosixPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function trimDirectorySeparator(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  return separatorIndex === -1 ? undefined : input.slice(0, separatorIndex);
}

function toProjectEntry(item: MixedItem): ProjectEntry | null {
  const normalizedPath = trimDirectorySeparator(toPosixPath(item.item.relativePath));
  if (!normalizedPath) {
    return null;
  }

  return {
    path: normalizedPath,
    kind: item.type,
    ...(item.type === "file" && item.item.gitStatus === "ignored" ? { ignored: true } : {}),
  };
}

function mapMixedSearchResult(
  result: MixedSearchResult,
  limit: number,
): { readonly entries: ProjectEntry[]; readonly truncated: boolean } {
  const entries: ProjectEntry[] = [];
  for (const item of result.items) {
    const entry = toProjectEntry(item);
    if (entry) {
      entries.push(entry);
    }
    if (entries.length >= limit) {
      break;
    }
  }

  const rootDirectoryCount = result.items.some(
    (item) => item.type === "directory" && item.item.relativePath.length === 0,
  )
    ? 1
    : 0;
  return {
    entries,
    truncated: result.totalMatched - rootDirectoryCount > limit,
  };
}

function withDirectoryAncestors(entries: ReadonlyArray<ProjectEntry>): ProjectEntry[] {
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    let parentPath = parentPathOf(entry.path);
    while (parentPath) {
      if (!entryByPath.has(parentPath)) {
        entryByPath.set(parentPath, {
          path: parentPath,
          kind: "directory",
          ...(entry.ignored === true ? { ignored: true } : {}),
        });
      }
      parentPath = parentPathOf(parentPath);
    }
  }
  return [...entryByPath.values()];
}

function isJunkIgnoredPath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  return segments.some((segment) => JUNK_IGNORED_DIRECTORY_NAMES.has(segment));
}

function parseNullSeparatedPaths(output: string): string[] {
  return output
    .split("\0")
    .map((entry) => trimDirectorySeparator(toPosixPath(entry)))
    .filter((entry) => entry.length > 0);
}

function toIgnoredEntries(relativePaths: ReadonlyArray<string>): ProjectEntry[] {
  const entryByPath = new Map<string, ProjectEntry>();
  for (const relativePath of relativePaths) {
    if (isJunkIgnoredPath(relativePath)) continue;
    entryByPath.set(relativePath, { path: relativePath, kind: "file", ignored: true });

    let parentPath = parentPathOf(relativePath);
    while (parentPath) {
      if (!entryByPath.has(parentPath)) {
        entryByPath.set(parentPath, { path: parentPath, kind: "directory", ignored: true });
      }
      parentPath = parentPathOf(parentPath);
    }

    if (entryByPath.size >= WORKSPACE_IGNORED_ENTRY_LIMIT) break;
  }
  return [...entryByPath.values()];
}

function mergeProjectEntries(
  baseEntries: ReadonlyArray<ProjectEntry>,
  supplementalEntries: ReadonlyArray<ProjectEntry>,
): ProjectEntry[] {
  const entryByPath = new Map(baseEntries.map((entry) => [entry.path, entry]));
  for (const supplementalEntry of supplementalEntries) {
    const existingEntry = entryByPath.get(supplementalEntry.path);
    if (!existingEntry) {
      entryByPath.set(supplementalEntry.path, supplementalEntry);
      continue;
    }
    if (supplementalEntry.ignored === true && existingEntry.ignored !== true) {
      entryByPath.set(supplementalEntry.path, { ...existingEntry, ignored: true });
    }
  }
  return [...entryByPath.values()];
}

function pathMatchesQuery(path: string, query: string): boolean {
  if (query.length === 0) return true;
  const normalizedPath = path.toLowerCase();
  if (normalizedPath.includes(query)) return true;

  let queryIndex = 0;
  for (const character of normalizedPath) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) return true;
    }
  }
  return false;
}

function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  return separatorIndex === -1 ? input : input.slice(separatorIndex + 1);
}

function stripLeadingDots(input: string): string {
  return input.replace(/^\.+/, "");
}

function fuzzyDistance(value: string, query: string): number | null {
  let queryIndex = 0;
  let firstMatchIndex = -1;
  let previousMatchIndex = -1;
  let gapCount = 0;

  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex++) {
    if (value[valueIndex] !== query[queryIndex]) continue;
    if (firstMatchIndex === -1) {
      firstMatchIndex = valueIndex;
    } else if (previousMatchIndex !== -1) {
      gapCount += valueIndex - previousMatchIndex - 1;
    }
    previousMatchIndex = valueIndex;
    queryIndex += 1;
  }

  return queryIndex === query.length ? firstMatchIndex + gapCount : null;
}

function queryMatchScore(value: string, query: string, baseScore: number): number | null {
  if (value === query) return baseScore;
  if (value.startsWith(query)) return baseScore + 10;

  const includesIndex = value.indexOf(query);
  if (includesIndex !== -1) {
    const previous = includesIndex === 0 ? "" : value[includesIndex - 1];
    const boundaryBonus =
      includesIndex === 0 ||
      previous === "/" ||
      previous === "-" ||
      previous === "_" ||
      previous === "."
        ? 20
        : 30;
    return baseScore + boundaryBonus + includesIndex;
  }

  const distance = fuzzyDistance(value, query);
  return distance === null ? null : baseScore + 100 + distance;
}

function scoreProjectEntryPath(entry: ProjectEntry, query: string): number {
  if (query.length === 0) {
    return entry.kind === "directory" ? 0 : 1;
  }

  const path = entry.path.toLowerCase();
  const basename = basenameOf(path);
  const basenameWithoutDots = stripLeadingDots(basename);
  const pathWithoutDots = stripLeadingDots(path);
  const scores = [
    queryMatchScore(basename, query, 0),
    basenameWithoutDots === basename ? null : queryMatchScore(basenameWithoutDots, query, 0),
    queryMatchScore(path, query, 40),
    pathWithoutDots === path ? null : queryMatchScore(pathWithoutDots, query, 40),
  ].filter((score): score is number => score !== null);

  return scores.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...scores);
}

function rankSearchEntries(entries: ReadonlyArray<ProjectEntry>, query: string): ProjectEntry[] {
  return entries.toSorted((left, right) => {
    const scoreDelta = scoreProjectEntryPath(left, query) - scoreProjectEntryPath(right, query);
    if (scoreDelta !== 0) return scoreDelta;
    const kindDelta = left.kind === right.kind ? 0 : left.kind === "file" ? -1 : 1;
    if (kindDelta !== 0) return kindDelta;
    return left.path.localeCompare(right.path);
  });
}

const scanGitIgnoredEntries = Effect.fn("WorkspaceSearchIndex.scanGitIgnoredEntries")(function* (
  cwd: string,
) {
  const result = yield* Effect.sync(() => {
    try {
      return NodeChildProcess.execFileSync(
        "git",
        [
          "-C",
          cwd,
          "ls-files",
          "-cio",
          "--exclude-standard",
          "-z",
          "--",
          ".",
          ...JUNK_IGNORED_GIT_PATHSPECS,
        ],
        {
          encoding: "utf8",
          maxBuffer: WORKSPACE_IGNORED_OUTPUT_MAX_BUFFER,
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5_000,
        },
      );
    } catch {
      return "";
    }
  });
  return toIgnoredEntries(parseNullSeparatedPaths(result));
});

const createFinder = Effect.fn("WorkspaceSearchIndex.createFinder")(function* (cwd: string) {
  const result = yield* Effect.try({
    try: () =>
      FileFinder.create({
        basePath: cwd,
        disableMmapCache: true,
        disableContentIndexing: true,
        aiMode: false,
        enableFsRootScanning: true,
        enableHomeDirScanning: true,
      }),
    catch: (cause) =>
      new WorkspaceSearchIndexCreateFailed({
        cwd,
        reason: "FileFinder.create threw unexpectedly.",
        cause,
      }),
  });
  if (result.ok) return result.value;
  return yield* new WorkspaceSearchIndexCreateFailed({
    cwd,
    reason: result.error,
  });
});

const waitForScan = <E>(cwd: string, finder: FileFinder, onFailure: (cause: unknown) => E) =>
  Effect.try({
    try: () => finder.isScanning(),
    catch: onFailure,
  }).pipe(
    Effect.repeat({
      while: (scanning) => scanning,
      schedule: Schedule.spaced(WORKSPACE_INDEX_SCAN_POLL_INTERVAL),
    }),
    Effect.timeoutOrElse({
      duration: WORKSPACE_INDEX_SCAN_TIMEOUT,
      orElse: () =>
        new WorkspaceSearchIndexScanTimedOut({ cwd, timeout: WORKSPACE_INDEX_SCAN_TIMEOUT }),
    }),
    Effect.withSpan("WorkspaceSearchIndex.waitForScan"),
  );

export const make = Effect.fn("WorkspaceSearchIndex.make")(function* (cwd: string) {
  const finder = yield* Effect.acquireRelease(createFinder(cwd), (finder) =>
    Effect.try({
      try: () => finder.destroy(),
      catch: (cause) => new WorkspaceSearchIndexDestroyFailed({ cwd, cause }),
    }).pipe(Effect.orDie),
  );
  yield* waitForScan(
    cwd,
    finder,
    (cause) =>
      new WorkspaceSearchIndexCreateFailed({
        cwd,
        reason: "FileFinder.isScanning threw while creating the index.",
        cause,
      }),
  );

  const runMixedSearch = Effect.fn("WorkspaceSearchIndex.runMixedSearch")(function* (
    query: string,
    pageSize: number,
  ) {
    const result = yield* Effect.try({
      try: () => finder.mixedSearch(query, { pageSize }),
      catch: (cause) =>
        new WorkspaceSearchIndexSearchFailed({
          cwd,
          queryLength: query.length,
          pageSize,
          reason: "FileFinder.mixedSearch threw unexpectedly.",
          cause,
        }),
    });
    if (!result.ok) {
      return yield* new WorkspaceSearchIndexSearchFailed({
        cwd,
        queryLength: query.length,
        pageSize,
        reason: result.error,
      });
    }
    return result.value;
  });
  let ignoredEntriesCache: ProjectEntry[] | null = null;
  const getIgnoredEntries = Effect.fn("WorkspaceSearchIndex.getIgnoredEntries")(function* () {
    if (ignoredEntriesCache) return ignoredEntriesCache;
    const ignoredEntries = yield* scanGitIgnoredEntries(cwd);
    ignoredEntriesCache = ignoredEntries;
    return ignoredEntries;
  });

  const refresh: WorkspaceSearchIndex["Service"]["refresh"] = Effect.fn(
    "WorkspaceSearchIndex.refresh",
  )(function* () {
    const result = yield* Effect.try({
      try: () => finder.scanFiles(),
      catch: (cause) =>
        new WorkspaceSearchIndexRefreshFailed({
          cwd,
          reason: "FileFinder.scanFiles threw unexpectedly.",
          cause,
        }),
    });
    if (!result.ok) {
      return yield* new WorkspaceSearchIndexRefreshFailed({
        cwd,
        reason: result.error,
      });
    }
    yield* waitForScan(
      cwd,
      finder,
      (cause) =>
        new WorkspaceSearchIndexRefreshFailed({
          cwd,
          reason: "FileFinder.isScanning threw while refreshing the index.",
          cause,
        }),
    );
    ignoredEntriesCache = null;
  });

  const list: WorkspaceSearchIndex["Service"]["list"] = Effect.fn("WorkspaceSearchIndex.list")(
    function* () {
      const result = yield* runMixedSearch("", WORKSPACE_INDEX_PAGE_SIZE);
      const mapped = mapMixedSearchResult(result, WORKSPACE_INDEX_MAX_ENTRIES);
      const ignoredEntries = yield* getIgnoredEntries();
      const sortedEntries = mergeProjectEntries(
        withDirectoryAncestors(mapped.entries),
        ignoredEntries,
      ).toSorted((left, right) => left.path.localeCompare(right.path));
      const entries = sortedEntries.slice(0, WORKSPACE_INDEX_MAX_ENTRIES);
      return {
        entries,
        truncated: mapped.truncated || entries.length < sortedEntries.length,
      };
    },
  );

  const search: WorkspaceSearchIndex["Service"]["search"] = Effect.fn(
    "WorkspaceSearchIndex.search",
  )(function* (query, limit) {
    const result = yield* runMixedSearch(query, Math.max(1, limit + 1));
    const mapped = mapMixedSearchResult(result, limit);
    const ignoredEntries = (yield* getIgnoredEntries())
      .filter((entry) => pathMatchesQuery(entry.path, query))
      .filter((entry) => entry.kind === "file");
    const rankedEntries = rankSearchEntries(
      mergeProjectEntries(mapped.entries, ignoredEntries),
      query,
    );
    const entries = rankedEntries.slice(0, limit);
    return {
      entries,
      truncated: mapped.truncated || entries.length < rankedEntries.length,
    };
  });

  return WorkspaceSearchIndex.of({ list, refresh, search });
});

/**
 * A layer factory is required because every index is scoped to a concrete
 * workspace root. WorkspaceSearchIndexMap owns memoization and idle cleanup;
 * using a default cwd here would mix resources from different workspaces.
 */
export const layer = (cwd: string) => Layer.effect(WorkspaceSearchIndex, make(cwd));

export class WorkspaceSearchIndexMap extends LayerMap.Service<WorkspaceSearchIndexMap>()(
  "t3/workspace/WorkspaceSearchIndexMap",
  {
    lookup: layer,
    idleTimeToLive: WORKSPACE_INDEX_IDLE_TTL,
  },
) {}
