import type { EnvironmentId, VcsWorktreeArchive } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronRightIcon,
  GitBranchIcon,
  LoaderIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import {
  refreshWorktreeArchivesForEnvironment,
  worktreeArchivesAtom,
} from "../lib/worktreeArchivesState";
import { useEnvironments } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import { useAtomCommand } from "../state/use-atom-command";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { cn } from "~/lib/utils";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settings/settingsLayout";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { stackedThreadToast, toastManager } from "./ui/toast";

/** History page: archived worktrees with their snapshotted thread lists. */
export function ArchivedWorktreesPage() {
  const { environments } = useEnvironments();
  const showWhenEmpty = environments.length <= 1;

  return (
    <SettingsPageContainer>
      {environments.map((environment) => (
        <EnvironmentWorktreeArchives
          key={environment.environmentId}
          environmentId={environment.environmentId}
          title={environments.length > 1 ? environment.label : "Archived worktrees"}
          showWhenEmpty={showWhenEmpty}
        />
      ))}
      {environments.length === 0 ? (
        <SettingsSection title="Archived worktrees">
          <SettingsRow
            title="No connected environments"
            description="Connect an environment to see its archived worktrees."
          />
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}

function EnvironmentWorktreeArchives(props: {
  environmentId: EnvironmentId;
  title: string;
  showWhenEmpty: boolean;
}) {
  const archivesQuery = useEnvironmentQuery(worktreeArchivesAtom(props.environmentId));
  const archives = archivesQuery.data?.archives ?? [];

  if (archivesQuery.data !== null && archives.length === 0 && !props.showWhenEmpty) {
    return null;
  }

  return (
    <SettingsSection title={props.title}>
      {archivesQuery.data === null ? (
        <SettingsRow
          title={
            <span className="flex items-center gap-2">
              {archivesQuery.isPending ? (
                <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <ArchiveIcon className="size-4 text-muted-foreground" />
              )}
              {archivesQuery.error === null
                ? "Loading archived worktrees"
                : "Could not load archived worktrees"}
            </span>
          }
          description={archivesQuery.error ?? "Checking this environment."}
        />
      ) : archives.length === 0 ? (
        <SettingsRow
          title={
            <span className="flex items-center gap-2">
              <ArchiveIcon className="size-4 text-muted-foreground" />
              No archived worktrees
            </span>
          }
          description="Archive a worktree from the sidebar and it will appear here."
        />
      ) : (
        archives.map((archive) => (
          <ArchivedWorktreeRow
            key={archive.id}
            environmentId={props.environmentId}
            archive={archive}
          />
        ))
      )}
    </SettingsSection>
  );
}

function ArchivedWorktreeRow(props: { environmentId: EnvironmentId; archive: VcsWorktreeArchive }) {
  const { environmentId, archive } = props;
  const [expanded, setExpanded] = useState(false);
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const unarchiveWorktree = useAtomCommand(vcsEnvironment.unarchiveWorktree, {
    reportFailure: false,
  });

  const handleUnarchive = useCallback(() => {
    void (async () => {
      setIsUnarchiving(true);
      try {
        const result = await unarchiveWorktree({
          environmentId,
          input: { archiveId: archive.id },
        });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to unarchive worktree",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
          return;
        }
        refreshWorktreeArchivesForEnvironment(environmentId);
        refreshArchivedThreadsForEnvironment(environmentId);
        toastManager.add({
          type: "success",
          title: "Worktree restored",
          description: archive.name,
        });
      } finally {
        setIsUnarchiving(false);
      }
    })();
  }, [archive.id, archive.name, environmentId, unarchiveWorktree]);

  const threadCountLabel =
    archive.threads.length === 1 ? "1 thread" : `${archive.threads.length} threads`;

  return (
    <SettingsRow
      title={archive.name}
      description={
        <>
          {archive.branch ? (
            <span className="inline-flex items-center gap-1">
              <GitBranchIcon aria-hidden className="size-3" />
              {archive.branch}
              {" · "}
            </span>
          ) : null}
          Archived {formatRelativeTimeLabel(archive.archivedAt)}
          {archive.hasContextArchive ? " · .context saved" : ""}
          <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground/60">
            {archive.worktreePath}
          </span>
        </>
      }
      control={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 cursor-pointer gap-1 px-2 text-muted-foreground"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRightIcon
              aria-hidden
              className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            />
            {threadCountLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
            disabled={isUnarchiving}
            onClick={handleUnarchive}
          >
            {isUnarchiving ? (
              <LoaderIcon aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <ArchiveRestoreIcon aria-hidden className="size-3.5" />
            )}
            Unarchive
          </Button>
        </>
      }
    >
      <Collapsible open={expanded}>
        <CollapsibleContent>
          {/* Read-only snapshot of the threads captured at archive time. */}
          <ul className="mt-2 mb-2 flex flex-col gap-0.5 border-l border-border/70 ps-3">
            {archive.threads.map((thread) => (
              <li
                key={thread.id}
                className="truncate py-0.5 text-[13px] text-muted-foreground select-none"
              >
                {thread.title}
              </li>
            ))}
            {archive.threads.length === 0 ? (
              <li className="py-0.5 text-[13px] text-muted-foreground/70 select-none">
                No threads were in this worktree.
              </li>
            ) : null}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </SettingsRow>
  );
}
