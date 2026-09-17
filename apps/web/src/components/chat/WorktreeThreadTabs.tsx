import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, MessageSquare, Pencil, Plus } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  DraftId,
  composerDraftHasUserContent,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { startNewThreadInCurrentWorkspace } from "../../lib/chatThreadActions";
import { releaseComposerDraftUploads } from "../../lib/composerDraftUploads";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { useThreadShell, useThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useWorktreeThreadTabsStore } from "../../worktreeThreadTabsStore";
import { resolveSidebarThreadStatus } from "../Sidebar.logic";
import { PanelTabCloseButton } from "../ui/panel-tab-close-button";
import { ScrollArea } from "../ui/scroll-area";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  collectWorktreeThreadTabs,
  orderWorktreeThreadTabs,
  threadTabCheckoutKey,
  type WorktreeThreadTab,
} from "./WorktreeThreadTabs.logic";

const EMPTY_ORDER: readonly string[] = [];

const ThreadTab = memo(function ThreadTab(props: {
  tab: WorktreeThreadTab;
  environmentId: EnvironmentId;
  active: boolean;
  onActivate: (tab: WorktreeThreadTab) => void;
  onClose: (tab: WorktreeThreadTab, title: string) => void;
}) {
  const { tab } = props;
  const ref = useMemo(
    () => scopeThreadRef(props.environmentId, tab.threadId),
    [props.environmentId, tab.threadId],
  );
  const thread = useThreadShell(tab.kind === "server" ? ref : null);
  // Only this tab subscribes to its prompt, not the whole strip or conversation.
  const draftTitle = useComposerDraftStore((state) =>
    tab.kind === "draft"
      ? (state.draftsByThreadKey[tab.draftId]?.prompt.trim().split("\n", 1)[0] ?? "")
      : "",
  );
  const title =
    tab.kind === "draft"
      ? draftTitle
        ? `Draft: ${draftTitle}`
        : "New thread"
      : (thread?.title ?? "Thread");
  const status = thread ? resolveSidebarThreadStatus(thread) : "ready";
  const statusLabel = {
    approval: "Needs approval",
    input: "Needs input",
    working: "Working",
    monitoring: "Monitoring",
    failed: "Failed",
    ready: "",
  }[status];
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: tab.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
      data-thread-tab={tab.id}
      data-active-thread-tab={props.active}
      className={cn(
        "group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs [-webkit-app-region:no-drag]",
        props.active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        isDragging && "relative z-10 opacity-80",
      )}
    >
      <span onPointerDown={(event) => event.stopPropagation()}>
        <PanelTabCloseButton
          label={`${tab.kind === "draft" ? "Discard draft" : "Archive thread"}: ${title}`}
          tooltip={tab.kind === "draft" ? "Discard draft" : "Archive thread"}
          onClick={() => props.onClose(tab, title)}
        >
          {tab.kind === "draft" ? (
            <Pencil className="size-3" />
          ) : status === "approval" || status === "input" || status === "failed" ? (
            <CircleAlert
              className={cn("size-3", status === "failed" ? "text-destructive" : "text-warning")}
            />
          ) : status === "working" || status === "monitoring" ? (
            <span className="size-1.5 rounded-full bg-success" />
          ) : (
            <MessageSquare className="size-3" />
          )}
        </PanelTabCloseButton>
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-current={props.active ? "page" : undefined}
              aria-label={statusLabel ? `${title} (${statusLabel})` : title}
              className="min-w-0 cursor-pointer truncate rounded-sm text-left focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => props.onActivate(tab)}
            />
          }
        >
          {title}
        </TooltipTrigger>
        <TooltipPopup>
          {title}
          {statusLabel ? ` · ${statusLabel}` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});

/** Checkout navigation uses shell metadata only; inactive conversations stay unmounted. */
export const WorktreeThreadTabs = memo(function WorktreeThreadTabs(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  threadId: ThreadId;
  worktreePath: string | null;
  branch: string | null;
  draftId?: DraftId;
}) {
  const threads = useThreadShells();
  const draftSessions = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const visibleDraftIds = useComposerDraftStore(
    useShallow((state) =>
      Object.keys(state.draftThreadsByThreadKey).filter(
        (id) => id === props.draftId || composerDraftHasUserContent(state.draftsByThreadKey[id]),
      ),
    ),
  );
  const activeDraft = props.draftId ? draftSessions[props.draftId] : undefined;
  const checkout = {
    environmentId: props.environmentId,
    projectId: props.projectId,
    worktreePath: props.worktreePath,
    pendingWorktreeDraftId:
      activeDraft?.envMode === "worktree" && !props.worktreePath ? (props.draftId ?? null) : null,
  };
  const checkoutKey = threadTabCheckoutKey(checkout);
  const savedOrder = useWorktreeThreadTabsStore(
    (state) => state.orderByCheckout[checkoutKey] ?? EMPTY_ORDER,
  );
  const move = useWorktreeThreadTabsStore((state) => state.move);
  const tabs = orderWorktreeThreadTabs(
    collectWorktreeThreadTabs({
      checkout,
      threads,
      drafts: visibleDraftIds.flatMap((id) => {
        const session = draftSessions[id];
        return session ? [{ draftId: DraftId.make(id), session }] : [];
      }),
    }),
    savedOrder,
  );
  const activeTabId = tabs.find((tab) =>
    props.draftId
      ? tab.kind === "draft" && tab.draftId === props.draftId
      : tab.kind === "server" && tab.threadId === props.threadId,
  )?.id;
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const revealActiveTab = () => {
      strip.querySelector('[data-active-thread-tab="true"]')?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    };
    revealActiveTab();
    const observer = new ResizeObserver(revealActiveTab);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [activeTabId, tabs.length, savedOrder]);
  const navigate = useNavigate();
  const handleNewThread = useNewThreadHandler();
  const { archiveThread } = useThreadActions();
  const confirmArchive = useClientSettings((settings) => settings.confirmThreadArchive);
  const closingIds = useRef(new Set<string>());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const reportFailure = (title: string, error: unknown) => {
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  };
  const closeTab = async (tab: WorktreeThreadTab, title: string) => {
    if (closingIds.current.has(tab.id)) return;
    closingIds.current.add(tab.id);
    try {
      if (tab.kind === "draft") {
        releaseComposerDraftUploads(tab.draftId);
        useComposerDraftStore.getState().clearDraftThread(tab.draftId);
        return;
      }
      if (confirmArchive) {
        const api = readLocalApi();
        if (!api) throw new Error("Client API unavailable.");
        if (!(await api.dialogs.confirm(`Archive thread "${title}"?`))) return;
      }
      const result = await archiveThread(scopeThreadRef(props.environmentId, tab.threadId));
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        reportFailure("Failed to archive thread", squashAtomCommandFailure(result));
      }
    } catch (error) {
      reportFailure(
        tab.kind === "draft" ? "Failed to discard draft" : "Failed to archive thread",
        error,
      );
    } finally {
      closingIds.current.delete(tab.id);
    }
  };

  return (
    <nav
      aria-label="Threads in this checkout"
      className="flex h-8 shrink-0 items-center gap-1 px-3 sm:px-5"
      data-worktree-thread-tabs
    >
      <ScrollArea
        ref={stripRef}
        hideScrollbars
        scrollFade
        className="min-w-0 w-auto shrink rounded-none"
      >
        <div className="flex h-full w-max items-center gap-1">
          <DndContext
            sensors={sensors}
            modifiers={[restrictToHorizontalAxis, restrictToFirstScrollableAncestor]}
            onDragEnd={({ active, over }) => {
              if (over)
                move(
                  checkoutKey,
                  tabs.map((tab) => tab.id),
                  String(active.id),
                  String(over.id),
                );
            }}
          >
            <SortableContext
              items={tabs.map((tab) => tab.id)}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <ThreadTab
                  key={tab.id}
                  tab={tab}
                  environmentId={props.environmentId}
                  active={tab.id === activeTabId}
                  onActivate={(target) => {
                    void (target.kind === "draft"
                      ? navigate({ to: "/draft/$draftId", params: { draftId: target.draftId } })
                      : navigate({
                          to: "/$environmentId/$threadId",
                          params: buildThreadRouteParams(
                            scopeThreadRef(props.environmentId, target.threadId),
                          ),
                        }));
                  }}
                  onClose={(target, title) => {
                    void closeTab(target, title);
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </ScrollArea>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label="New thread in this checkout"
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => {
                void startNewThreadInCurrentWorkspace({
                  activeThread: props.draftId ? undefined : props,
                  activeDraftThread: activeDraft ?? null,
                  defaultProjectRef: null,
                  handleNewThread,
                }).catch((error) => reportFailure("Failed to create thread", error));
              }}
            />
          }
        >
          <Plus className="size-3" />
        </TooltipTrigger>
        <TooltipPopup>New thread in this checkout</TooltipPopup>
      </Tooltip>
    </nav>
  );
});
