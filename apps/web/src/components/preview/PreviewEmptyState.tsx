import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { Globe, History, RadioTower } from "lucide-react";
import { useMemo, useState } from "react";

import type { BrowserHistoryEntry } from "~/browserHistoryStore";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "~/components/ui/empty";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useThreadShell, useThreadShellsForProjectRefs } from "~/state/entities";
import { DiscoveryList } from "../ui/discovery-list";

import { PreviewLocalServerCard } from "./PreviewLocalServerCard";
import { PreviewRecentUrlCard } from "./PreviewRecentUrlCard";
import { selectWorktreeServers } from "./previewEmptyStateLogic";
import { useDiscoveredLocalServers } from "./useDiscoveredLocalServers";

type ServerScope = "worktree" | "all";

interface Props {
  threadRef: ScopedThreadRef;
  environmentId: EnvironmentId;
  configuredUrls?: ReadonlyArray<string> | undefined;
  recentEntries: ReadonlyArray<BrowserHistoryEntry>;
  onRemoveRecent: (url: string) => void;
  onOpenUrl: (url: string) => void;
}

export function PreviewEmptyState({
  threadRef,
  environmentId,
  configuredUrls,
  recentEntries,
  onRemoveRecent,
  onOpenUrl,
}: Props) {
  const servers = useDiscoveredLocalServers({
    environmentId,
    configuredUrls,
  });
  const activeThread = useThreadShell(threadRef);
  const activeProjectId = activeThread?.projectId ?? null;
  const projectRefs = useMemo(
    () => (activeProjectId ? [{ environmentId, projectId: activeProjectId }] : []),
    [activeProjectId, environmentId],
  );
  const projectThreads = useThreadShellsForProjectRefs(projectRefs);
  const worktreeServers = useMemo(
    () => selectWorktreeServers({ servers, activeThread, projectThreads }),
    [servers, activeThread, projectThreads],
  );
  const [scope, setScope] = useState<ServerScope>("worktree");
  // The toggle only appears when it filters something out.
  const canScope = worktreeServers.length > 0 && worktreeServers.length < servers.length;
  const visibleServers = canScope && scope === "worktree" ? worktreeServers : servers;
  const recents = recentEntries.filter((entry) => URL.canParse(entry.url)).slice(0, 8);

  if (servers.length === 0 && recents.length === 0) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <Globe className="size-4.5 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No preview yet</EmptyTitle>
        <EmptyDescription>
          Type a URL above, or run a dev script. Browser-ready localhost servers will show up here
          automatically.
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-y-auto px-5 py-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        {recents.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <History className="size-4 shrink-0" />
              <h2 className="font-medium">Recently used</h2>
            </div>
            <DiscoveryList>
              {recents.map((entry) => (
                <PreviewRecentUrlCard
                  key={entry.url}
                  threadRef={threadRef}
                  entry={entry}
                  onOpen={() => onOpenUrl(entry.url)}
                  onRemove={() => onRemoveRecent(entry.url)}
                />
              ))}
            </DiscoveryList>
          </div>
        ) : null}
        {servers.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <RadioTower className="size-4 shrink-0" />
              <h2 className="font-medium">Local servers</h2>
              {canScope ? (
                <ToggleGroup
                  aria-label="Local server scope"
                  className="ml-auto"
                  value={[scope]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (next === "worktree" || next === "all") setScope(next);
                  }}
                >
                  <Toggle value="worktree">This worktree {worktreeServers.length}</Toggle>
                  <Toggle value="all">All {servers.length}</Toggle>
                </ToggleGroup>
              ) : null}
            </div>
            <DiscoveryList>
              {visibleServers.map((server) => (
                <PreviewLocalServerCard
                  key={`${server.host}:${server.port}`}
                  threadRef={threadRef}
                  server={server}
                  onOpen={() => onOpenUrl(server.requestedUrl)}
                />
              ))}
            </DiscoveryList>
            <p className="px-1 text-xs text-muted-foreground">
              Select a live local server to open it in this browser tab.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
