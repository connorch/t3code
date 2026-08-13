import { autoAnimate } from "@formkit/auto-animate";
import {
  closestCorners,
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import {
  ArchiveIcon,
  ArrowUpDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CloudIcon,
  EyeOffIcon,
  FolderPlusIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useParams, useRouter } from "@tanstack/react-router";

import { isElectron } from "../env";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { isTerminalFocused } from "../lib/terminalFocus";
import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import { refreshWorktreeArchivesForEnvironment } from "../lib/worktreeArchivesState";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { readLocalApi } from "../localApi";
import {
  legacyProjectCwdPreferenceKey,
  resolveProjectExpanded,
  resolveProjectHidden,
  useUiStateStore,
} from "../uiStateStore";
import { useThreadActions } from "../hooks/useThreadActions";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { openCommandPalette } from "../commandPaletteBus";
import { startNewThreadFromContext } from "../lib/chatThreadActions";
import { useClientSettings, useUpdateClientSettings } from "../hooks/useSettings";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { useNowMinute } from "../hooks/useNowMinute";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import { sortThreads } from "../lib/threadSort";
import {
  buildSidebarProjectSnapshots,
  type SidebarProjectSnapshot,
} from "../sidebarProjectGrouping";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useProjects, useThreadShells } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import { primaryServerKeybindingsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { SidebarThreadSummary } from "../types";
import { cn } from "~/lib/utils";
import {
  isTrailingDoubleClick,
  orderItemsByPreferredIds,
  resolveAdjacentThreadId,
  searchSidebarThreadsByTitle,
  sortLogicalProjectsForSidebar,
} from "./Sidebar.logic";
import {
  partitionThreadsForConnorSidebar,
  resolveConnorGroupIndicator,
  resolveConnorThreadDot,
  resolveGroupNavigationThread,
  resolveWorktreeDisplayName,
  type ConnorGroupIndicator,
  type ConnorSidebarGroup,
  type ConnorThreadDot,
} from "./SidebarConnor.logic";
import { ProjectFavicon } from "./ProjectFavicon";
import { resolveThreadPr } from "./ThreadStatusIndicators";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "./ui/menu";
import { SidebarContent, SidebarGroup, SidebarMenuButton } from "./ui/sidebar";
import { useSidebar } from "./ui/sidebar";
import { SidebarChromeFooter, SidebarChromeHeader } from "./sidebar/SidebarChrome";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useComposerDraftStore } from "../composerDraftStore";

type ConnorGroup = ConnorSidebarGroup<EnvironmentThreadShell>;

function compactTimeLabel(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

function threadTimeLabel(thread: SidebarThreadSummary): string {
  return compactTimeLabel(formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt));
}

// ── Status glyphs ───────────────────────────────────────────────────
// The collapsed-group indicator is the whole point of Connor mode: one glyph
// answers "does this worktree need me". Colors follow the system convention
// (amber approval, indigo input, sky working, emerald done).

function GroupIndicatorGlyph({ indicator }: { indicator: ConnorGroupIndicator }) {
  if (indicator === null) return null;
  if (indicator.kind === "question") {
    return (
      <CircleHelpIcon
        role="img"
        aria-label={
          indicator.tone === "approval" ? "Approval pending" : "The agent asked a question"
        }
        className={cn(
          "size-3.5 shrink-0",
          indicator.tone === "approval"
            ? "text-amber-600 dark:text-amber-300"
            : "text-indigo-600 dark:text-indigo-300",
        )}
      />
    );
  }
  if (indicator.kind === "failed") {
    return (
      <CircleAlertIcon
        role="img"
        aria-label="Failed"
        className="size-3.5 shrink-0 text-red-600 dark:text-red-400"
      />
    );
  }
  if (indicator.kind === "working") {
    return (
      <CircleDashedIcon
        role="img"
        aria-label="Working"
        className="size-3.5 shrink-0 animate-status-pulse text-sky-600 motion-reduce:animate-none dark:text-sky-400"
      />
    );
  }
  return (
    <span
      role="img"
      aria-label="Unread response"
      className="size-1.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400"
    />
  );
}

const THREAD_DOT_CLASS: Record<Exclude<ConnorThreadDot, null>, string> = {
  approval: "bg-amber-500 dark:bg-amber-300/90",
  input: "bg-indigo-500 dark:bg-indigo-300/90",
  working: "bg-sky-500 animate-status-pulse dark:bg-sky-300/80",
  failed: "bg-red-500 dark:bg-red-400",
  unread: "bg-emerald-500 dark:bg-emerald-400",
};

const THREAD_DOT_LABEL: Record<Exclude<ConnorThreadDot, null>, string> = {
  approval: "Approval pending",
  input: "The agent asked a question",
  working: "Working",
  failed: "Failed",
  unread: "Unread response",
};

// ── Project-level grouping (Stack mode only) ────────────────────────
// Same settings, labels, and expansion store as the Default sidebar, so
// switching modes never loses the user's sort or collapsed projects.

const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};

const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};

function projectExpansionPreferenceKeys(project: SidebarProjectSnapshot): string[] {
  return [
    project.projectKey,
    ...project.memberProjects.map((member) => member.physicalProjectKey),
    ...project.memberProjects.map((member) => legacyProjectCwdPreferenceKey(member.workspaceRoot)),
  ];
}

function ConnorSortMenu(props: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  showHiddenProjects: boolean;
  hiddenProjectCount: number;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
  onShowHiddenProjectsChange: (show: boolean) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              aria-label="Sort options"
              className="inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sort options</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-52">
        <MenuGroup>
          <div className="px-2 py-1 font-medium text-muted-foreground sm:text-xs">
            Sort projects
          </div>
          <MenuRadioGroup
            value={props.projectSortOrder}
            onValueChange={(value) =>
              props.onProjectSortOrderChange(value as SidebarProjectSortOrder)
            }
          >
            {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 font-medium text-muted-foreground sm:text-xs">
            Sort threads
          </div>
          <MenuRadioGroup
            value={props.threadSortOrder}
            onValueChange={(value) =>
              props.onThreadSortOrderChange(value as SidebarThreadSortOrder)
            }
          >
            {(
              Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 font-medium text-muted-foreground sm:text-xs">Filter</div>
          <MenuCheckboxItem
            variant="switch"
            closeOnClick={false}
            checked={props.showHiddenProjects}
            onCheckedChange={(checked) => props.onShowHiddenProjectsChange(checked === true)}
            className="min-h-7 py-1 sm:text-xs"
          >
            {props.hiddenProjectCount > 0
              ? `Show hidden projects (${props.hiddenProjectCount})`
              : "Show hidden projects"}
          </MenuCheckboxItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

// ── Thread rows ─────────────────────────────────────────────────────

const ConnorThreadRow = memo(function ConnorThreadRow(props: {
  thread: EnvironmentThreadShell;
  /** Minute-quantized clock: busts the memo so relative-time labels never go stale. */
  nowMinute: string;
  isActive: boolean;
  isRenaming: boolean;
  renamingTitle: string;
  onThreadClick: (event: ReactMouseEvent, threadRef: ScopedThreadRef) => void;
  onThreadActivate: (threadRef: ScopedThreadRef) => void;
  onContextMenu: (threadRef: ScopedThreadRef, position: { x: number; y: number }) => void;
  onArchiveThread: (threadRef: ScopedThreadRef) => void;
  onStartRename: (threadRef: ScopedThreadRef, title: string) => void;
  onRenameTitleChange: (title: string) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string, originalTitle: string) => void;
  onCancelRename: () => void;
}) {
  const { thread } = props;
  const threadRef = useMemo(
    () => scopeThreadRef(thread.environmentId, thread.id),
    [thread.environmentId, thread.id],
  );
  const threadKey = scopedThreadKey(threadRef);
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const dot = resolveConnorThreadDot(thread, lastVisitedAt);

  const handleClick = useCallback(
    (event: ReactMouseEvent) => props.onThreadClick(event, threadRef),
    [props.onThreadClick, threadRef],
  );
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      props.onContextMenu(threadRef, { x: event.clientX, y: event.clientY });
    },
    [props.onContextMenu, threadRef],
  );
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      props.onThreadActivate(threadRef);
    },
    [props.onThreadActivate, threadRef],
  );
  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent) => {
      if (props.isRenaming || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if ((event.target as HTMLElement).closest("button, a, input")) return;
      event.preventDefault();
      props.onStartRename(threadRef, thread.title);
    },
    [props.isRenaming, props.onStartRename, thread.title, threadRef],
  );
  const renameCommittedRef = useRef(false);
  useEffect(() => {
    if (props.isRenaming) renameCommittedRef.current = false;
  }, [props.isRenaming]);

  const title = props.isRenaming ? (
    <input
      autoFocus
      value={props.renamingTitle}
      aria-label="Thread title"
      onChange={(event) => props.onRenameTitleChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          renameCommittedRef.current = true;
          props.onCommitRename(threadRef, props.renamingTitle, thread.title);
        } else if (event.key === "Escape") {
          event.preventDefault();
          renameCommittedRef.current = true;
          props.onCancelRename();
        }
      }}
      onBlur={() => {
        if (!renameCommittedRef.current) {
          props.onCommitRename(threadRef, props.renamingTitle, thread.title);
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm text-card-foreground outline-none focus:border-foreground"
    />
  ) : (
    <span
      className={cn(
        "min-w-0 flex-1 truncate",
        props.isActive
          ? "font-medium text-sidebar-foreground"
          : dot !== null
            ? "text-sidebar-foreground/90"
            : "text-sidebar-muted-foreground/80 group-hover/connor-row:text-sidebar-foreground",
      )}
    >
      {thread.title}
    </span>
  );

  return (
    <li data-thread-item className="list-none">
      <div
        role="button"
        tabIndex={0}
        data-testid={`sidebar-connor-thread-${thread.id}`}
        title={thread.title}
        className={cn(
          "group/connor-row flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          props.isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "hover:bg-sidebar-row-hover",
        )}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
      >
        {title}
        {/* Stacked cell: the hover-revealed archive button replaces the
            status dot / time label instead of sitting next to it. The
            indicator is pointer-events-none: its hover opacity (< 1) promotes
            it above the sibling button in paint order, where it would
            otherwise swallow the button's clicks. */}
        <span className="ml-auto grid shrink-0 items-center justify-items-end">
          <span className="pointer-events-none col-start-1 row-start-1 flex items-center transition-opacity group-hover/connor-row:opacity-0">
            {dot !== null ? (
              <span
                role="img"
                aria-label={THREAD_DOT_LABEL[dot]}
                className={cn("size-1.5 rounded-full", THREAD_DOT_CLASS[dot])}
              />
            ) : (
              <span className="text-xs tabular-nums text-sidebar-muted-foreground/50">
                {threadTimeLabel(thread)}
              </span>
            )}
          </span>
          <button
            type="button"
            aria-label="Archive thread"
            title="Archive thread"
            onClick={(event) => {
              event.stopPropagation();
              props.onArchiveThread(threadRef);
            }}
            className="col-start-1 row-start-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-control-surface hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/connor-row:opacity-100"
          >
            <ArchiveIcon className="size-3.5" />
          </button>
        </span>
      </div>
    </li>
  );
});

// ── Worktree group header name (shared rename affordance) ───────────

function WorktreeName(props: {
  name: string;
  isRenaming: boolean;
  renamingName: string;
  className?: string;
  onRenameNameChange: (name: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
}) {
  const committedRef = useRef(false);
  useEffect(() => {
    if (props.isRenaming) committedRef.current = false;
  }, [props.isRenaming]);
  // Auto width, not flex-1: the remote-machine glyph sits immediately after the
  // name rather than being pushed to the far end of the row.
  if (!props.isRenaming) {
    return <span className={cn("min-w-0 truncate", props.className)}>{props.name}</span>;
  }
  return (
    <input
      autoFocus
      value={props.renamingName}
      aria-label="Worktree name"
      onChange={(event) => props.onRenameNameChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          committedRef.current = true;
          props.onCommitRename();
        } else if (event.key === "Escape") {
          event.preventDefault();
          committedRef.current = true;
          props.onCancelRename();
        }
      }}
      onBlur={() => {
        if (!committedRef.current) props.onCommitRename();
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border border-input bg-card px-1 text-sm font-medium text-card-foreground outline-none focus:border-foreground"
    />
  );
}

/** Shown only for groups living on a non-primary machine; the local checkout
    is the unmarked default, so it stays glyph-free. */
function RemoteEnvironmentGlyph({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // The empty title suppresses the card's native tooltip over the icon.
          <span
            title=""
            aria-label={`Runs on ${label}`}
            className="inline-flex shrink-0 items-center"
          />
        }
      >
        <CloudIcon aria-hidden className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

interface GroupSectionProps {
  group: ConnorGroup;
  /** Where git status is read: the worktree, or the project root for the root checkout. */
  gitCwd: string | null;
  /** Machine name when the group is remote; null for the local checkout. */
  remoteEnvironmentLabel: string | null;
  /** Rows in display order: the thread-sort setting's ordering. */
  displayThreads: readonly EnvironmentThreadShell[];
  name: string;
  expanded: boolean;
  containsActive: boolean;
  indicator: ConnorGroupIndicator;
  isRenaming: boolean;
  renamingName: string;
  onGroupClick: (group: ConnorGroup) => void;
  onGroupToggle: (group: ConnorGroup) => void;
  onGroupContextMenu: (group: ConnorGroup, position: { x: number; y: number }) => void;
  onNewThreadInGroup: (group: ConnorGroup) => void;
  onArchiveGroup: (group: ConnorGroup) => void;
  onStartGroupRename: (group: ConnorGroup) => void;
  onRenameNameChange: (name: string) => void;
  onCommitGroupRename: (group: ConnorGroup) => void;
  onCancelGroupRename: () => void;
  renderThreadRow: (thread: EnvironmentThreadShell) => React.ReactNode;
}

function useGroupHeaderInteractions(props: GroupSectionProps) {
  const { group } = props;
  // With no chevron on the row, the row itself is the expand affordance:
  // opening a worktree navigates into it, clicking the open one closes it.
  const activate = () => {
    if (props.expanded) props.onGroupToggle(group);
    else props.onGroupClick(group);
  };
  const handleClick = (event: ReactMouseEvent) => {
    if (props.isRenaming) return;
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    if (isTrailingDoubleClick(event.detail)) return;
    activate();
  };
  const handleDoubleClick = (event: ReactMouseEvent) => {
    if (props.isRenaming || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if ((event.target as HTMLElement).closest("button, a, input")) return;
    event.preventDefault();
    props.onStartGroupRename(group);
  };
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onGroupContextMenu(group, { x: event.clientX, y: event.clientY });
  };
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };
  const location = group.worktreePath ?? "Root checkout";
  const headerTitle = `${location}${group.branch ? ` (${group.branch})` : ""}`;
  return { handleClick, handleDoubleClick, handleContextMenu, handleKeyDown, headerTitle };
}

/** Hover-revealed "new thread in this group" affordance. */
function GroupPlusButton(props: {
  group: ConnorGroup;
  onNewThreadInGroup: (group: ConnorGroup) => void;
}) {
  const label =
    props.group.kind === "local" ? "New thread in this checkout" : "New thread in this worktree";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        props.onNewThreadInGroup(props.group);
      }}
      className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
    >
      <PlusIcon className="size-3.5" />
    </button>
  );
}

/** Hover-revealed "archive this worktree" affordance (worktree cards only). */
function GroupArchiveButton(props: {
  group: ConnorGroup;
  onArchiveGroup: (group: ConnorGroup) => void;
}) {
  return (
    <button
      type="button"
      aria-label="Archive worktree"
      title="Archive worktree"
      onClick={(event) => {
        event.stopPropagation();
        props.onArchiveGroup(props.group);
      }}
      className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
    >
      <ArchiveIcon className="size-3.5" />
    </button>
  );
}

// ── Worktree cards: one open at a time ──────────────────────────────

function StackGroupSection(props: GroupSectionProps) {
  const { group } = props;
  const interactions = useGroupHeaderInteractions(props);
  const gitStatusQuery = useEnvironmentQuery(
    group.branch !== null && props.gitCwd !== null
      ? vcsEnvironment.status({
          environmentId: group.environmentId,
          input: { cwd: props.gitCwd },
        })
      : null,
  );
  const groupPr = resolveThreadPr({
    threadBranch: group.branch,
    gitStatus: gitStatusQuery.data ?? null,
  });
  return (
    <li className="list-none py-px">
      {/* Card chrome is the expanded worktree's focus treatment; collapsed
          worktrees are plain rows. The transparent border keeps both states
          on the same geometry so expanding never nudges the row by 1px. */}
      <section
        className={cn(
          "overflow-hidden rounded-lg border border-transparent transition-colors",
          props.expanded && "border-sidebar-border bg-sidebar-row-hover/35",
        )}
      >
        <div
          role="button"
          tabIndex={0}
          data-testid={`sidebar-connor-group-${group.key}`}
          aria-expanded={props.expanded}
          title={interactions.headerTitle}
          className={cn(
            // Same px-1 inset as the project header, less 1px for the card
            // border, so worktree rows start on the project row's edge.
            "group/connor-group flex h-7 w-full cursor-pointer items-center gap-1.5 ps-[calc(--spacing(1)-1px)] pe-2.5 text-left outline-none select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            !props.expanded && "rounded-lg hover:bg-sidebar-row-hover",
          )}
          onClick={interactions.handleClick}
          onDoubleClick={interactions.handleDoubleClick}
          onKeyDown={interactions.handleKeyDown}
          onContextMenu={interactions.handleContextMenu}
        >
          {/* Branch glyph sits in the project favicon's size-4 slot, kept even
              when there is no branch, so every title shares one start line. */}
          <span className="flex size-4 shrink-0 items-center justify-center">
            {group.branch ? (
              <GitBranchIcon
                aria-hidden
                className={cn(
                  "size-3 text-sidebar-muted-foreground/70",
                  groupPr?.state === "open" && "text-success-foreground",
                  groupPr?.state === "merged" && "text-merged-foreground",
                )}
              />
            ) : null}
          </span>
          <WorktreeName
            name={props.name}
            isRenaming={props.isRenaming}
            renamingName={props.renamingName}
            className={cn(
              "text-sm font-medium",
              props.containsActive ? "text-sidebar-foreground" : "text-sidebar-muted-foreground",
            )}
            onRenameNameChange={props.onRenameNameChange}
            onCommitRename={() => props.onCommitGroupRename(group)}
            onCancelRename={props.onCancelGroupRename}
          />
          {props.remoteEnvironmentLabel ? (
            <RemoteEnvironmentGlyph label={props.remoteEnvironmentLabel} />
          ) : null}
          {/* Stacked cell: archive/+ replace the status glyph on hover.
              The glyph lives in a size-5 slot matching the + button so
              they share a center; -me-1.5 cancels ghost-button padding
              so the icons optically match the left inset. pointer-events-none
              on the glyph: hover opacity (< 1) would otherwise promote it
              above the buttons and swallow their clicks. */}
          <span className="-me-1.5 ml-auto grid shrink-0 items-center justify-items-end">
            <span className="pointer-events-none col-start-1 row-start-1 inline-flex size-5 items-center justify-center transition-opacity group-hover/connor-group:opacity-0">
              <GroupIndicatorGlyph indicator={props.indicator} />
            </span>
            {/* Zero-width until revealed, so the idle row only reserves the
                status glyph's slot and the name runs that much further right.
                Width snaps rather than transitions: animating it would reflow
                the truncated name on every frame of the hover. */}
            <span className="col-start-1 row-start-1 flex w-0 items-center overflow-hidden opacity-0 transition-opacity group-hover/connor-group:w-auto group-hover/connor-group:opacity-100 focus-within:w-auto focus-within:opacity-100">
              {group.kind === "worktree" ? (
                <GroupArchiveButton group={group} onArchiveGroup={props.onArchiveGroup} />
              ) : null}
              <GroupPlusButton group={group} onNewThreadInGroup={props.onNewThreadInGroup} />
            </span>
          </span>
        </div>
        {props.expanded ? (
          <>
            {/* Start inset lines the branch up under the worktree name:
                header inset + the glyph slot + its gap. */}
            <div className="truncate ps-[calc(--spacing(1)+--spacing(4)+--spacing(1.5)-1px)] pe-2.5 pb-1 text-xs text-sidebar-muted-foreground/70">
              {group.branch ?? (group.kind === "local" ? "local checkout" : "worktree")}
            </div>
            <ul className="flex flex-col gap-px p-1 pt-0">
              {props.displayThreads.map((thread) => props.renderThreadRow(thread))}
            </ul>
          </>
        ) : null}
      </section>
    </li>
  );
}

// ── Project section header (Stack mode only) ────────────────────────

interface ConnorProjectDragHandleProps {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  setActivatorNodeRef: ReturnType<typeof useSortable>["setActivatorNodeRef"];
}

/** Sortable shell for a project section under manual sorting; the whole
    header row is the drag activator, same as the Default sidebar. */
function ConnorSortableProjectItem({
  projectKey,
  children,
}: {
  projectKey: string;
  children: (dragHandleProps: ConnorProjectDragHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectKey });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "relative list-none rounded-md",
        isDragging && "z-20 opacity-80",
        isOver && !isDragging && "ring-1 ring-primary/40",
      )}
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

function ConnorProjectHeader(props: {
  project: SidebarProjectSnapshot;
  expanded: boolean;
  containsActive: boolean;
  /** True when the project is marked hidden but the filter is showing it. */
  hidden: boolean;
  /** True when the project has no worktrees or threads; hovering the row
   * then explains the emptiness instead of rendering an empty-state line. */
  empty: boolean;
  /** Worktrees under this project; surfaced as a count only while collapsed,
   * since expanding the project already shows them. */
  worktreeCount: number;
  dragHandleProps: ConnorProjectDragHandleProps | null;
  suppressClickAfterDragRef: React.RefObject<boolean>;
  onToggle: (project: SidebarProjectSnapshot) => void;
  onNewThreadInProject: (project: SidebarProjectSnapshot) => void;
  onContextMenu: (project: SidebarProjectSnapshot, position: { x: number; y: number }) => void;
}) {
  const { project, dragHandleProps } = props;
  const header = (
    <div
      role="button"
      tabIndex={0}
      data-testid={`sidebar-connor-project-${project.projectKey}`}
      aria-expanded={props.expanded}
      title={props.empty ? undefined : project.workspaceRoot}
      ref={dragHandleProps?.setActivatorNodeRef}
      {...(dragHandleProps ? dragHandleProps.attributes : {})}
      {...(dragHandleProps ? dragHandleProps.listeners : {})}
      className={cn(
        "group/connor-project flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-left outline-none select-none hover:bg-sidebar-row-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        dragHandleProps ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      )}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, input")) return;
        // A drop fires a trailing click on the activator; consuming the flag
        // here keeps the drag from also toggling expansion.
        if (props.suppressClickAfterDragRef.current) {
          props.suppressClickAfterDragRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        props.onToggle(project);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        props.onToggle(project);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onContextMenu(project, { x: event.clientX, y: event.clientY });
      }}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <ProjectFavicon
          environmentId={project.environmentId}
          cwd={project.workspaceRoot}
          className={cn(
            "size-4 transition-opacity group-hover/connor-project:opacity-0",
            props.hidden && "opacity-50 grayscale",
          )}
        />
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "absolute size-3.5 text-sidebar-muted-foreground/70 opacity-0 transition group-hover/connor-project:opacity-100",
            props.expanded && "rotate-90",
          )}
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm font-medium",
          props.hidden
            ? "text-sidebar-muted-foreground/70"
            : props.containsActive || props.expanded
              ? "text-sidebar-foreground"
              : "text-sidebar-foreground/80",
        )}
      >
        {project.displayName}
      </span>
      {props.hidden ? (
        <EyeOffIcon
          role="img"
          aria-label="Hidden project"
          className="size-3 shrink-0 text-sidebar-muted-foreground/60"
        />
      ) : null}
      {/* The count and the new-thread button share one trailing slot, so the
       * count can sit flush right and the button simply takes its place on
       * hover instead of pushing it inward. */}
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        {!props.expanded && props.worktreeCount > 0 ? (
          <span
            aria-label={`${props.worktreeCount} worktree${props.worktreeCount === 1 ? "" : "s"}`}
            className="absolute text-xs tabular-nums text-sidebar-muted-foreground/70 transition-opacity group-hover/connor-project:opacity-0"
          >
            {props.worktreeCount}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={`New thread in ${project.displayName}`}
          title={`New thread in ${project.displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onNewThreadInProject(project);
          }}
          className="absolute inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-control-surface hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/connor-project:opacity-100"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </span>
    </div>
  );
  if (!props.empty) return header;
  return (
    <Tooltip>
      <TooltipTrigger render={header} />
      <TooltipPopup side="right">No threads yet</TooltipPopup>
    </Tooltip>
  );
}

// ── Search result row ───────────────────────────────────────────────

function ConnorSearchResultRow(props: {
  thread: EnvironmentThreadShell;
  projectCwd: string | null;
  isHighlighted: boolean;
  isRouteActive: boolean;
  resultId: string;
  onHighlight: () => void;
  onSelect: () => void;
}) {
  const { thread } = props;
  return (
    <li id={props.resultId} role="option" aria-selected={props.isHighlighted} className="list-none">
      <div
        role="button"
        tabIndex={-1}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm select-none",
          props.isHighlighted || props.isRouteActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "text-sidebar-muted-foreground/80 hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        )}
        onPointerMove={props.onHighlight}
        onClick={props.onSelect}
      >
        <ProjectFavicon
          environmentId={thread.environmentId}
          cwd={props.projectCwd ?? ""}
          className="size-4 shrink-0"
          fallbackIcon={MessageSquareIcon}
        />
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        {thread.branch ? (
          <span className="max-w-28 shrink-0 truncate text-xs text-sidebar-muted-foreground/55">
            {thread.branch}
          </span>
        ) : null}
      </div>
    </li>
  );
}

// ── The sidebar ─────────────────────────────────────────────────────

export default function SidebarConnor() {
  const threads = useThreadShells();
  const projects = useProjects();
  const router = useRouter();
  const nowMinute = useNowMinute();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const { deleteThread, archiveThread } = useThreadActions();
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const archiveWorktreeMutation = useAtomCommand(vcsEnvironment.archiveWorktree, {
    reportFailure: false,
  });
  const newThreadContext = useHandleNewThread();
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const worktreeNameByKey = useUiStateStore((state) => state.worktreeNameByKey);
  const worktreeLastThreadKeyByKey = useUiStateStore((state) => state.worktreeLastThreadKeyByKey);
  const setWorktreeName = useUiStateStore((state) => state.setWorktreeName);
  const setWorktreeLastThreadKey = useUiStateStore((state) => state.setWorktreeLastThreadKey);
  // Projects group above the worktrees, sharing the Default sidebar's sort
  // settings and project-expansion store.
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const sidebarProjectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const updateSettings = useUpdateClientSettings();
  const projectOrder = useUiStateStore((state) => state.projectOrder);
  const projectExpandedById = useUiStateStore((state) => state.projectExpandedById);
  const setProjectExpanded = useUiStateStore((state) => state.setProjectExpanded);
  const reorderProjects = useUiStateStore((state) => state.reorderProjects);
  const projectHiddenById = useUiStateStore((state) => state.projectHiddenById);
  const connorShowHiddenProjects = useUiStateStore((state) => state.connorShowHiddenProjects);
  const setProjectHidden = useUiStateStore((state) => state.setProjectHidden);
  const setConnorShowHiddenProjects = useUiStateStore((state) => state.setConnorShowHiddenProjects);
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) =>
      toastManager.add({ type: "success", title: "Path copied", description: path }),
    onError: (error) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      ),
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) =>
      toastManager.add({ type: "success", title: "Branch copied", description: branch }),
    onError: (error) =>
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy branch",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      ),
  });

  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeThreadRef = useMemo(
    () => resolveActiveThreadRouteRef(routeTarget, routeDraftThread),
    [routeDraftThread, routeTarget],
  );
  const routeThreadKey = routeThreadRef ? scopedThreadKey(routeThreadRef) : null;

  const projectCwdByKey = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          `${project.environmentId}:${project.id}`,
          project.workspaceRoot,
        ]),
      ),
    [projects],
  );

  const { groups: allGroups } = useMemo(() => partitionThreadsForConnorSidebar(threads), [threads]);

  const groupKeyByThreadKey = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const group of allGroups) {
      for (const thread of group.threads) {
        mapping.set(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), group.key);
      }
    }
    return mapping;
  }, [allGroups]);

  const routeGroupKey =
    routeThreadKey === null ? null : (groupKeyByThreadKey.get(routeThreadKey) ?? null);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  // Anything not on the primary environment is "somewhere else": the card
  // gets a machine glyph, the local checkout stays unmarked.
  const resolveRemoteEnvironmentLabel = useCallback(
    (environmentId: EnvironmentId): string | null =>
      primaryEnvironmentId === null || environmentId === primaryEnvironmentId
        ? null
        : (environmentLabelById.get(environmentId) ?? "Remote machine"),
    [environmentLabelById, primaryEnvironmentId],
  );
  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
        getPreferenceIds: (project) => [
          getProjectOrderKey(project),
          legacyProjectCwdPreferenceKey(project.workspaceRoot),
        ],
      }),
    [projectOrder, projects],
  );
  const projectGroups = useMemo(() => {
    const unsorted = buildSidebarProjectSnapshots({
      projects: sidebarProjectSortOrder === "manual" ? orderedProjects : projects,
      settings: projectGroupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) => environmentLabelById.get(environmentId) ?? null,
    });
    return sortLogicalProjectsForSidebar(unsorted, threads, sidebarProjectSortOrder);
  }, [
    environmentLabelById,
    orderedProjects,
    primaryEnvironmentId,
    projectGroupingSettings,
    projects,
    sidebarProjectSortOrder,
    threads,
  ]);
  // Stack mode's tree: project → cards (Root Checkout, then worktrees).
  // The thread-sort setting orders rows inside each card; the cards
  // themselves keep static creation order.
  const projectSections = useMemo(() => {
    return projectGroups.flatMap((project) => {
      const preferenceKeys = projectExpansionPreferenceKeys(project);
      // Hidden projects leave the list entirely unless the filter shows
      // them; then they render dimmed with an unhide affordance.
      const hidden = resolveProjectHidden(projectHiddenById, preferenceKeys);
      if (hidden && !connorShowHiddenProjects) return [];
      const memberKeys = new Set(
        project.memberProjectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`),
      );
      const projectThreads = threads.filter((thread) =>
        memberKeys.has(`${thread.environmentId}:${thread.projectId}`),
      );
      const partition = partitionThreadsForConnorSidebar(projectThreads);
      return [
        {
          project,
          hidden,
          expanded: resolveProjectExpanded(projectExpandedById, preferenceKeys),
          containsActive:
            routeThreadKey !== null &&
            projectThreads.some(
              (thread) =>
                scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === routeThreadKey,
            ),
          groups: partition.groups.map((group) => ({
            // Local-checkout groups learn their path from the owning project
            // so the card tooltip and copy-path work like a worktree's.
            group:
              group.kind === "local"
                ? {
                    ...group,
                    worktreePath:
                      projectCwdByKey.get(`${group.environmentId}:${group.projectId}`) ?? null,
                  }
                : group,
            displayThreads: sortThreads(group.threads, sidebarThreadSortOrder),
          })),
        },
      ];
    });
  }, [
    connorShowHiddenProjects,
    projectCwdByKey,
    projectExpandedById,
    projectGroups,
    projectHiddenById,
    routeThreadKey,
    sidebarThreadSortOrder,
    threads,
  ]);
  const hiddenProjectCount = useMemo(
    () =>
      projectGroups.filter((project) =>
        resolveProjectHidden(projectHiddenById, projectExpansionPreferenceKeys(project)),
      ).length,
    [projectGroups, projectHiddenById],
  );

  // Remember the last thread viewed per worktree — this is what a click on
  // the collapsed group reopens.
  useEffect(() => {
    if (routeThreadKey === null || routeGroupKey === null) return;
    setWorktreeLastThreadKey(routeGroupKey, routeThreadKey);
  }, [routeGroupKey, routeThreadKey, setWorktreeLastThreadKey]);

  // Worktree cards are an accordion. Navigation moves the accordion; the
  // chevron can also open/close a card without navigating.
  const [stackExpandedKey, setStackExpandedKey] = useState<string | null>(routeGroupKey);
  const lastRouteGroupKeyRef = useRef(routeGroupKey);
  useEffect(() => {
    if (routeGroupKey !== null && routeGroupKey !== lastRouteGroupKeyRef.current) {
      setStackExpandedKey(routeGroupKey);
    }
    lastRouteGroupKeyRef.current = routeGroupKey;
  }, [routeGroupKey]);

  const isGroupExpanded = useCallback(
    (groupKey: string): boolean => stackExpandedKey === groupKey,
    [stackExpandedKey],
  );

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (isMobile) setOpenMobile(false);
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [isMobile, router, setOpenMobile],
  );

  const handleGroupClick = useCallback(
    (group: ConnorGroup) => {
      const target = resolveGroupNavigationThread(
        group,
        worktreeLastThreadKeyByKey,
        threadLastVisitedAtById,
      );
      if (target) navigateToThread(scopeThreadRef(target.environmentId, target.id));
      setStackExpandedKey(group.key);
    },
    [navigateToThread, threadLastVisitedAtById, worktreeLastThreadKeyByKey],
  );

  const handleGroupToggle = useCallback((group: ConnorGroup) => {
    setStackExpandedKey((current) => (current === group.key ? null : group.key));
  }, []);

  // ── Thread rename ─────────────────────────────────────────────────
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const startThreadRename = useCallback((threadRef: ScopedThreadRef, title: string) => {
    setRenamingThreadKey(scopedThreadKey(threadRef));
    setRenamingTitle(title);
  }, []);
  const cancelThreadRename = useCallback(() => setRenamingThreadKey(null), []);
  const commitThreadRename = useCallback(
    (threadRef: ScopedThreadRef, title: string, originalTitle: string) => {
      void (async () => {
        const trimmed = title.trim();
        setRenamingThreadKey(null);
        if (trimmed.length === 0) {
          toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
          return;
        }
        if (trimmed === originalTitle) return;
        const result = await updateThreadMetadata({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, title: trimmed },
        });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to rename thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [updateThreadMetadata],
  );

  // ── Worktree rename ───────────────────────────────────────────────
  const [renamingWorktreeKey, setRenamingWorktreeKey] = useState<string | null>(null);
  const [renamingWorktreeName, setRenamingWorktreeName] = useState("");
  const startWorktreeRename = useCallback(
    (group: ConnorGroup) => {
      // The local-checkout card has a fixed title.
      if (group.kind !== "worktree") return;
      setRenamingWorktreeKey(group.key);
      setRenamingWorktreeName(resolveWorktreeDisplayName(group, worktreeNameByKey));
    },
    [worktreeNameByKey],
  );
  const cancelWorktreeRename = useCallback(() => setRenamingWorktreeKey(null), []);
  const commitWorktreeRename = useCallback(
    (group: ConnorGroup) => {
      setRenamingWorktreeKey(null);
      // Empty commits clear the custom name and fall back to the default
      // (first thread's title).
      setWorktreeName(group.key, renamingWorktreeName);
    },
    [renamingWorktreeName, setWorktreeName],
  );

  // ── New threads ───────────────────────────────────────────────────
  const handleNewThreadInGroup = useCallback(
    (group: ConnorGroup) => {
      if (isMobile) setOpenMobile(false);
      void (async () => {
        const result = await settlePromise(() =>
          newThreadContext.handleNewThread(
            scopeProjectRef(group.environmentId, group.projectId),
            group.kind === "worktree"
              ? {
                  branch: group.branch,
                  worktreePath: group.worktreePath,
                  envMode: "worktree",
                  startFromOrigin: false,
                }
              : // branch: null = whatever the checkout is currently on, not the
                // (possibly stale) branch of the newest member thread.
                {
                  branch: null,
                  worktreePath: null,
                  envMode: "local",
                  startFromOrigin: false,
                },
          ),
        );
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not create thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [isMobile, newThreadContext, setOpenMobile],
  );

  const handleProjectToggle = useCallback(
    (project: SidebarProjectSnapshot) => {
      const preferenceKeys = projectExpansionPreferenceKeys(project);
      const expanded = resolveProjectExpanded(
        useUiStateStore.getState().projectExpandedById,
        preferenceKeys,
      );
      setProjectExpanded(preferenceKeys, !expanded);
    },
    [setProjectExpanded],
  );

  // ── Manual project reordering (same @dnd-kit setup as the Default
  // sidebar; both write the shared projectOrder preference) ──────────
  const isManualProjectSorting = sidebarProjectSortOrder === "manual";
  const suppressProjectClickAfterDragRef = useRef(false);
  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
  }, []);
  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (!isManualProjectSorting) return;
      suppressProjectClickAfterDragRef.current = true;
    },
    [isManualProjectSorting],
  );
  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!isManualProjectSorting) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = projectGroups.find((project) => project.projectKey === active.id);
      const overProject = projectGroups.find((project) => project.projectKey === over.id);
      if (!activeProject || !overProject) return;
      const activeMemberKeys = activeProject.memberProjects.map(
        (member) => member.physicalProjectKey,
      );
      const overMemberKeys = overProject.memberProjects.map((member) => member.physicalProjectKey);
      reorderProjects(orderedProjects.map(getProjectOrderKey), activeMemberKeys, overMemberKeys);
    },
    [isManualProjectSorting, orderedProjects, projectGroups, reorderProjects],
  );
  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    suppressProjectClickAfterDragRef.current = false;
  }, []);

  const handleNewThreadInProject = useCallback(
    (project: SidebarProjectSnapshot) => {
      if (isMobile) setOpenMobile(false);
      const projectRef =
        project.memberProjectRefs[0] ?? scopeProjectRef(project.environmentId, project.id);
      void (async () => {
        const result = await settlePromise(() => newThreadContext.handleNewThread(projectRef));
        if (result._tag === "Failure") {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not create thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [isMobile, newThreadContext, setOpenMobile],
  );

  const openAddProjectCommandPalette = useCallback(
    () => openCommandPalette({ open: "add-project" }),
    [],
  );

  const handleProjectContextMenu = useCallback(
    (project: SidebarProjectSnapshot, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const preferenceKeys = projectExpansionPreferenceKeys(project);
        const isHidden = resolveProjectHidden(
          useUiStateStore.getState().projectHiddenById,
          preferenceKeys,
        );
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              { id: "new-thread", label: `New thread in ${project.displayName}` },
              { id: "copy-path", label: "Copy path", icon: "copy" },
              isHidden
                ? { id: "unhide-project", label: "Unhide project" }
                : { id: "hide-project", label: "Hide project" },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "new-thread":
            handleNewThreadInProject(project);
            return;
          case "copy-path":
            copyPathToClipboard(project.workspaceRoot, { path: project.workspaceRoot });
            return;
          case "hide-project":
            setProjectHidden(preferenceKeys, true);
            // The section vanishes on hide (filter off), so the toast is the
            // confirmation — and the Undo is the escape hatch for a mis-click.
            toastManager.add(
              stackedThreadToast({
                type: "success",
                title: `Hid "${project.displayName}"`,
                description: "Find it under Sort options → Show hidden projects.",
                timeout: 5_000,
                actionProps: {
                  children: "Undo",
                  onClick: () => setProjectHidden(preferenceKeys, false),
                },
              }),
            );
            return;
          case "unhide-project":
            setProjectHidden(preferenceKeys, false);
            return;
          default:
            return;
        }
      })();
    },
    [copyPathToClipboard, handleNewThreadInProject, setProjectHidden],
  );

  const handleNewThreadClick = useCallback(() => {
    if (isMobile) setOpenMobile(false);
    if (projects.length > 1) {
      openCommandPalette({ open: "new-thread-in" });
      return;
    }
    void startNewThreadFromContext({
      activeDraftThread: newThreadContext.activeDraftThread,
      activeThread: newThreadContext.activeThread ?? undefined,
      defaultProjectRef: newThreadContext.defaultProjectRef,
      handleNewThread: newThreadContext.handleNewThread,
    });
  }, [isMobile, newThreadContext, projects.length, setOpenMobile]);

  // ── Context menus ─────────────────────────────────────────────────
  const threadByKey = useMemo(
    () =>
      new Map(
        threads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [threads],
  );
  const threadByKeyRef = useRef(threadByKey);
  threadByKeyRef.current = threadByKey;

  const handleThreadContextMenu = useCallback(
    (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const threadKey = scopedThreadKey(threadRef);
        const thread = threadByKeyRef.current.get(threadKey);
        if (!thread) return;
        const threadWorkspacePath =
          thread.worktreePath ??
          projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ??
          null;
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              ...(thread.branch
                ? [{ id: "new-thread-on-branch", label: `New thread on ${thread.branch}` }]
                : []),
              { id: "rename", label: "Rename thread" },
              { id: "mark-unread", label: "Mark unread" },
              { id: "copy-path", label: "Copy path", icon: "copy" },
              ...(thread.branch ? [{ id: "copy-branch", label: "Copy branch", icon: "copy" }] : []),
              { id: "delete", label: "Delete", destructive: true, icon: "trash" },
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "new-thread-on-branch": {
            const result = await settlePromise(() =>
              newThreadContext.handleNewThread(
                scopeProjectRef(thread.environmentId, thread.projectId),
                {
                  branch: thread.branch,
                  worktreePath: thread.worktreePath,
                  envMode: thread.worktreePath ? "worktree" : "local",
                  startFromOrigin: false,
                },
              ),
            );
            if (result._tag === "Failure") {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Could not create thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          case "rename":
            startThreadRename(threadRef, thread.title);
            return;
          case "mark-unread":
            markThreadUnread(threadKey, thread.latestTurn?.completedAt);
            return;
          case "copy-path":
            if (!threadWorkspacePath) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Path unavailable",
                  description: "This thread does not have a workspace path to copy.",
                }),
              );
              return;
            }
            copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
            return;
          case "copy-branch":
            if (thread.branch) copyBranchToClipboard(thread.branch, { branch: thread.branch });
            return;
          case "delete": {
            if (confirmThreadDelete) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(
                  [
                    `Delete thread "${thread.title}"?`,
                    "This permanently clears conversation history for this thread.",
                  ].join("\n"),
                ),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            const result = await deleteThread(threadRef);
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Failed to delete thread",
                  description: error instanceof Error ? error.message : "An error occurred.",
                }),
              );
            }
            return;
          }
          default:
            return;
        }
      })();
    },
    [
      confirmThreadDelete,
      copyBranchToClipboard,
      copyPathToClipboard,
      deleteThread,
      markThreadUnread,
      newThreadContext,
      projectCwdByKey,
      startThreadRename,
    ],
  );

  const handleGroupContextMenu = useCallback(
    (group: ConnorGroup, position: { x: number; y: number }) => {
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        const isWorktree = group.kind === "worktree";
        const hasCustomName = isWorktree && (worktreeNameByKey[group.key]?.trim() ?? "") !== "";
        const clicked = await settlePromise(() =>
          api.contextMenu.show(
            [
              // The local-checkout card has a fixed title and its directory
              // is the project itself — no rename or delete.
              ...(isWorktree
                ? [{ id: "rename-worktree", label: "Rename worktree", icon: "pencil" }]
                : []),
              ...(hasCustomName ? [{ id: "reset-name", label: "Reset name" }] : []),
              {
                id: "new-thread",
                label:
                  isWorktree && group.branch ? `New thread on ${group.branch}` : "New thread here",
              },
              { id: "mark-unread", label: "Mark unread" },
              ...(group.worktreePath
                ? [{ id: "copy-path", label: "Copy path", icon: "copy" }]
                : []),
              ...(group.branch ? [{ id: "copy-branch", label: "Copy branch", icon: "copy" }] : []),
              ...(isWorktree
                ? [
                    {
                      id: "delete-worktree",
                      label: "Delete worktree",
                      destructive: true,
                      icon: "trash",
                    },
                  ]
                : []),
            ],
            position,
          ),
        );
        if (clicked._tag === "Failure") return;
        switch (clicked.value) {
          case "rename-worktree":
            startWorktreeRename(group);
            return;
          case "reset-name":
            setWorktreeName(group.key, null);
            return;
          case "new-thread":
            handleNewThreadInGroup(group);
            return;
          case "mark-unread": {
            // Unread the last-read thread; the card's indicator logic picks
            // it up and shows the group as unread.
            const target = resolveGroupNavigationThread(
              group,
              worktreeLastThreadKeyByKey,
              threadLastVisitedAtById,
            );
            if (target) {
              markThreadUnread(
                scopedThreadKey(scopeThreadRef(target.environmentId, target.id)),
                target.latestTurn?.completedAt,
              );
            }
            return;
          }
          case "copy-path":
            if (group.worktreePath) {
              copyPathToClipboard(group.worktreePath, { path: group.worktreePath });
            }
            return;
          case "copy-branch":
            if (group.branch) copyBranchToClipboard(group.branch, { branch: group.branch });
            return;
          case "delete-worktree": {
            if (group.kind !== "worktree") return;
            const displayName = resolveWorktreeDisplayName(group, worktreeNameByKey);
            const count = group.threads.length;
            const confirmed = await settlePromise(() =>
              api.dialogs.confirm(
                [
                  `Delete worktree "${displayName}" and its ${count} thread${count === 1 ? "" : "s"}?`,
                  "This removes the worktree directory and permanently clears conversation history.",
                ].join("\n"),
              ),
            );
            if (confirmed._tag === "Failure" || !confirmed.value) return;
            // Grown as deletions actually land, so orphaned-worktree
            // detection only discounts threads that are really gone; the
            // last delete orphans the worktree and removes it.
            const deletedThreadKeys = new Set<string>();
            for (const thread of group.threads) {
              const threadRef = scopeThreadRef(thread.environmentId, thread.id);
              const result = await deleteThread(threadRef, {
                deletedThreadKeys,
                deleteOrphanedWorktree: true,
              });
              if (result._tag === "Failure") {
                if (!isAtomCommandInterrupted(result)) {
                  const error = squashAtomCommandFailure(result);
                  toastManager.add(
                    stackedThreadToast({
                      type: "error",
                      title: "Failed to delete worktree",
                      description: error instanceof Error ? error.message : "An error occurred.",
                    }),
                  );
                }
                return;
              }
              deletedThreadKeys.add(scopedThreadKey(threadRef));
            }
            return;
          }
          default:
            return;
        }
      })();
    },
    [
      copyBranchToClipboard,
      copyPathToClipboard,
      deleteThread,
      handleNewThreadInGroup,
      markThreadUnread,
      setWorktreeName,
      startWorktreeRename,
      threadLastVisitedAtById,
      worktreeLastThreadKeyByKey,
      worktreeNameByKey,
    ],
  );

  // ── Archive ───────────────────────────────────────────────────────
  const handleArchiveGroup = useCallback(
    (group: ConnorGroup) => {
      if (group.kind !== "worktree") return;
      const firstThread = group.threads[0];
      if (!firstThread) return;
      const displayName = resolveWorktreeDisplayName(group, worktreeNameByKey);
      void (async () => {
        const result = await archiveWorktreeMutation({
          environmentId: firstThread.environmentId,
          input: {
            projectId: firstThread.projectId,
            worktreePath: group.worktreePath,
            name: displayName,
          },
        });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to archive worktree",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
          return;
        }
        refreshArchivedThreadsForEnvironment(firstThread.environmentId);
        refreshWorktreeArchivesForEnvironment(firstThread.environmentId);
        toastManager.add({
          type: "success",
          title: "Worktree archived",
          description: displayName,
        });
        if (routeGroupKey === group.key) {
          void router.navigate({ to: "/" });
        }
      })();
    },
    [archiveWorktreeMutation, routeGroupKey, router, worktreeNameByKey],
  );

  const handleArchiveThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      // Archiving a worktree's sole thread archives the whole worktree
      // instead — the server archives its threads as part of that.
      const threadKey = scopedThreadKey(threadRef);
      for (const section of projectSections) {
        for (const { group } of section.groups) {
          if (group.kind !== "worktree" || group.threads.length !== 1) continue;
          const sole = group.threads[0]!;
          if (scopedThreadKey(scopeThreadRef(sole.environmentId, sole.id)) === threadKey) {
            handleArchiveGroup(group);
            return;
          }
        }
      }
      void (async () => {
        const result = await archiveThread(threadRef);
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to archive thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      })();
    },
    [archiveThread, handleArchiveGroup, projectSections],
  );

  // ── Click / activate ──────────────────────────────────────────────
  const handleThreadClick = useCallback(
    (event: ReactMouseEvent, threadRef: ScopedThreadRef) => {
      if (isTrailingDoubleClick(event.detail)) return;
      navigateToThread(threadRef);
    },
    [navigateToThread],
  );

  // ── Search ────────────────────────────────────────────────────────
  const threadSearchInputRef = useRef<HTMLInputElement>(null);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(0);
  const isSearchingThreads = threadSearchQuery.trim().length > 0;
  const searchableThreads = useMemo(() => allGroups.flatMap((group) => group.threads), [allGroups]);
  const threadSearchResults = useMemo(
    () => searchSidebarThreadsByTitle(searchableThreads, threadSearchQuery),
    [searchableThreads, threadSearchQuery],
  );
  const threadSearchResultOrderKey = threadSearchResults
    .map((thread) => scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)))
    .join("\0");
  useEffect(() => {
    setActiveSearchResultIndex(0);
  }, [threadSearchResultOrderKey]);
  useEffect(() => {
    if (!isSearchingThreads) return;
    document
      .getElementById(`sidebar-connor-search-result-${activeSearchResultIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSearchResultIndex, isSearchingThreads, threadSearchResultOrderKey]);
  const clearThreadSearch = useCallback(() => {
    setThreadSearchQuery("");
    setActiveSearchResultIndex(0);
  }, []);
  const selectThreadSearchResult = useCallback(
    (thread: EnvironmentThreadShell) => {
      clearThreadSearch();
      // The route change moves the accordion to the found thread's worktree.
      navigateToThread(scopeThreadRef(thread.environmentId, thread.id));
    },
    [clearThreadSearch, navigateToThread],
  );
  const handleThreadSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && isSearchingThreads) {
        event.preventDefault();
        event.stopPropagation();
        clearThreadSearch();
        return;
      }
      if (threadSearchResults.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSearchResultIndex((index) => (index + 1) % threadSearchResults.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSearchResultIndex(
          (index) => (index - 1 + threadSearchResults.length) % threadSearchResults.length,
        );
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const result = threadSearchResults[activeSearchResultIndex];
        if (result) selectThreadSearchResult(result);
      }
    },
    [
      activeSearchResultIndex,
      clearThreadSearch,
      isSearchingThreads,
      selectThreadSearchResult,
      threadSearchResults,
    ],
  );

  // ── Keyboard traversal (⌘↑/⌘↓, ⌘1..9) over visible rows ───────────
  const orderedThreadKeys = useMemo(() => {
    const keys: string[] = [];
    const pushThread = (thread: EnvironmentThreadShell) =>
      keys.push(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)));
    const pushGroup = (group: ConnorGroup, displayThreads: readonly EnvironmentThreadShell[]) => {
      if (isGroupExpanded(group.key)) {
        for (const thread of displayThreads) pushThread(thread);
      } else {
        const target = resolveGroupNavigationThread(
          group,
          worktreeLastThreadKeyByKey,
          threadLastVisitedAtById,
        );
        if (target) pushThread(target);
      }
    };
    for (const section of projectSections) {
      if (!section.expanded) continue;
      for (const { group, displayThreads } of section.groups) {
        pushGroup(group, displayThreads);
      }
    }
    return keys;
  }, [isGroupExpanded, projectSections, threadLastVisitedAtById, worktreeLastThreadKeyByKey]);

  const routeTerminalOpen = useTerminalUiStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeTerminalOpen,
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return;
        const targetThread = threadByKeyRef.current.get(targetThreadKey);
        if (!targetThread) return;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(scopeThreadRef(targetThread.environmentId, targetThread.id));
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [keybindings, navigateToThread, orderedThreadKeys, routeTerminalOpen, routeThreadKey]);

  const attachListAutoAnimateRef = useCallback((node: HTMLUListElement | null) => {
    if (!node) return;
    autoAnimate(node, { duration: 150, easing: "ease-out" });
  }, []);

  const renderThreadRow = useCallback(
    (thread: EnvironmentThreadShell) => {
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      return (
        <ConnorThreadRow
          key={threadKey}
          thread={thread}
          nowMinute={nowMinute}
          isActive={routeThreadKey === threadKey}
          isRenaming={renamingThreadKey === threadKey}
          renamingTitle={renamingThreadKey === threadKey ? renamingTitle : ""}
          onThreadClick={handleThreadClick}
          onThreadActivate={navigateToThread}
          onContextMenu={handleThreadContextMenu}
          onArchiveThread={handleArchiveThread}
          onStartRename={startThreadRename}
          onRenameTitleChange={setRenamingTitle}
          onCommitRename={commitThreadRename}
          onCancelRename={cancelThreadRename}
        />
      );
    },
    [
      cancelThreadRename,
      commitThreadRename,
      handleArchiveThread,
      handleThreadClick,
      handleThreadContextMenu,
      navigateToThread,
      nowMinute,
      renamingThreadKey,
      renamingTitle,
      routeThreadKey,
      startThreadRename,
    ],
  );

  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal") ??
    shortcutLabelForCommand(keybindings, "chat.new");

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        className="gap-0"
        fixedHeader={
          <SidebarGroup className="gap-1 p-[var(--sidebar-content-inset)]">
            <div className="flex items-center gap-1">
              <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
                <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground/80" />
                <Input
                  ref={threadSearchInputRef}
                  nativeInput
                  unstyled
                  type="search"
                  value={threadSearchQuery}
                  onChange={(event) => {
                    setThreadSearchQuery(event.currentTarget.value);
                    setActiveSearchResultIndex(0);
                  }}
                  onKeyDown={handleThreadSearchKeyDown}
                  placeholder="Search"
                  aria-label="Search threads"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={isSearchingThreads && threadSearchResults.length > 0}
                  aria-controls={
                    isSearchingThreads && threadSearchResults.length > 0
                      ? "sidebar-connor-search-results"
                      : undefined
                  }
                  aria-activedescendant={
                    isSearchingThreads && threadSearchResults[activeSearchResultIndex]
                      ? `sidebar-connor-search-result-${activeSearchResultIndex}`
                      : undefined
                  }
                  className="min-w-0 flex-1 [&_[data-slot=input]]:h-auto [&_[data-slot=input]]:p-0 [&_[data-slot=input]]:leading-normal [&_[data-slot=input]]:text-sm [&_[data-slot=input]]:font-medium [&_[data-slot=input]]:text-sidebar-foreground [&_[data-slot=input]]:placeholder:text-sidebar-muted-foreground"
                />
                {isSearchingThreads ? (
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 shrink-0 rounded-sm text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
                    aria-label="Clear thread search"
                    onClick={() => {
                      clearThreadSearch();
                      threadSearchInputRef.current?.focus();
                    }}
                  >
                    <XIcon className="size-3" />
                  </Button>
                ) : null}
              </div>
              <div className="shrink-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <SidebarMenuButton
                        size="icon"
                        type="button"
                        className="relative focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                        onClick={handleNewThreadClick}
                        disabled={projects.length === 0}
                        aria-label="New thread"
                      />
                    }
                  >
                    <SquarePenIcon />
                    <span
                      className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                      aria-hidden="true"
                    />
                  </TooltipTrigger>
                  <TooltipPopup side="right">
                    {newThreadShortcutLabel
                      ? `New thread (${newThreadShortcutLabel})`
                      : "New thread"}
                  </TooltipPopup>
                </Tooltip>
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between ps-2 pe-0.5">
              <span className="text-xs font-medium text-sidebar-muted-foreground/80">Projects</span>
              <div className="flex items-center gap-1">
                <ConnorSortMenu
                  projectSortOrder={sidebarProjectSortOrder}
                  threadSortOrder={sidebarThreadSortOrder}
                  showHiddenProjects={connorShowHiddenProjects}
                  hiddenProjectCount={hiddenProjectCount}
                  onProjectSortOrderChange={(sortOrder) =>
                    updateSettings({ sidebarProjectSortOrder: sortOrder })
                  }
                  onThreadSortOrderChange={(sortOrder) =>
                    updateSettings({ sidebarThreadSortOrder: sortOrder })
                  }
                  onShowHiddenProjectsChange={setConnorShowHiddenProjects}
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Add project"
                        data-testid="sidebar-connor-add-project"
                        className="inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-md px-[calc(--spacing(1)-1px)] text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                        onClick={openAddProjectCommandPalette}
                      />
                    }
                  >
                    <FolderPlusIcon className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipPopup side="right">Add project</TooltipPopup>
                </Tooltip>
              </div>
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup className="ps-[calc(var(--sidebar-content-inset)+1px)] pe-[var(--sidebar-content-inset)] pb-1 pt-0">
          {isSearchingThreads ? (
            threadSearchResults.length > 0 ? (
              <ul
                id="sidebar-connor-search-results"
                role="listbox"
                aria-label="Thread search results"
                className="flex flex-col gap-px"
              >
                {threadSearchResults.map((thread, index) => {
                  const threadKey = scopedThreadKey(
                    scopeThreadRef(thread.environmentId, thread.id),
                  );
                  return (
                    <ConnorSearchResultRow
                      key={threadKey}
                      thread={thread}
                      projectCwd={
                        projectCwdByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                      }
                      isHighlighted={activeSearchResultIndex === index}
                      isRouteActive={routeThreadKey === threadKey}
                      resultId={`sidebar-connor-search-result-${index}`}
                      onHighlight={() => setActiveSearchResultIndex(index)}
                      onSelect={() => selectThreadSearchResult(thread)}
                    />
                  );
                })}
              </ul>
            ) : (
              <p
                role="status"
                className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground"
              >
                No threads found
              </p>
            )
          ) : (
            (() => {
              const renderProjectSectionContent = (
                section: (typeof projectSections)[number],
                dragHandleProps: ConnorProjectDragHandleProps | null,
              ) => (
                <>
                  <ConnorProjectHeader
                    project={section.project}
                    expanded={section.expanded}
                    containsActive={section.containsActive}
                    hidden={section.hidden}
                    empty={section.groups.length === 0}
                    worktreeCount={
                      section.groups.filter(({ group }) => group.kind === "worktree").length
                    }
                    dragHandleProps={dragHandleProps}
                    suppressClickAfterDragRef={suppressProjectClickAfterDragRef}
                    onToggle={handleProjectToggle}
                    onNewThreadInProject={handleNewThreadInProject}
                    onContextMenu={handleProjectContextMenu}
                  />
                  {section.expanded && section.groups.length > 0 ? (
                    // No start inset: worktree rows repeat the project row's
                    // own geometry (4px padding + 16px icon slot + 6px gap),
                    // so both levels share one icon and title alignment line.
                    <ul className="flex flex-col gap-px pb-1">
                      {section.groups.map(({ group, displayThreads }) => (
                        <StackGroupSection
                          key={group.key}
                          group={group}
                          gitCwd={
                            group.worktreePath ??
                            projectCwdByKey.get(`${group.environmentId}:${group.projectId}`) ??
                            null
                          }
                          remoteEnvironmentLabel={resolveRemoteEnvironmentLabel(
                            group.environmentId,
                          )}
                          displayThreads={displayThreads}
                          name={
                            group.kind === "local"
                              ? "Root Checkout"
                              : resolveWorktreeDisplayName(group, worktreeNameByKey)
                          }
                          expanded={isGroupExpanded(group.key)}
                          containsActive={routeGroupKey === group.key}
                          indicator={resolveConnorGroupIndicator(
                            group.threads,
                            threadLastVisitedAtById,
                          )}
                          isRenaming={renamingWorktreeKey === group.key}
                          renamingName={
                            renamingWorktreeKey === group.key ? renamingWorktreeName : ""
                          }
                          onGroupClick={handleGroupClick}
                          onGroupToggle={handleGroupToggle}
                          onGroupContextMenu={handleGroupContextMenu}
                          onNewThreadInGroup={handleNewThreadInGroup}
                          onArchiveGroup={handleArchiveGroup}
                          onStartGroupRename={startWorktreeRename}
                          onRenameNameChange={setRenamingWorktreeName}
                          onCommitGroupRename={commitWorktreeRename}
                          onCancelGroupRename={cancelWorktreeRename}
                          renderThreadRow={renderThreadRow}
                        />
                      ))}
                    </ul>
                  ) : null}
                </>
              );
              if (projectSections.length === 0) {
                return (
                  <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
                    {hiddenProjectCount === 0
                      ? "No projects yet"
                      : hiddenProjectCount === 1
                        ? "1 project is hidden"
                        : `${hiddenProjectCount} projects are hidden`}
                  </p>
                );
              }
              // Manual sorting swaps auto-animate for @dnd-kit: the two fight
              // over transforms, and dnd-kit owns row motion while dragging.
              return isManualProjectSorting ? (
                <DndContext
                  sensors={projectDnDSensors}
                  collisionDetection={projectCollisionDetection}
                  modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
                  onDragStart={handleProjectDragStart}
                  onDragEnd={handleProjectDragEnd}
                  onDragCancel={handleProjectDragCancel}
                >
                  <ul role="list" className="flex flex-col gap-px">
                    <SortableContext
                      items={projectSections.map((section) => section.project.projectKey)}
                      strategy={verticalListSortingStrategy}
                    >
                      {projectSections.map((section) => (
                        <ConnorSortableProjectItem
                          key={section.project.projectKey}
                          projectKey={section.project.projectKey}
                        >
                          {(dragHandleProps) =>
                            renderProjectSectionContent(section, dragHandleProps)
                          }
                        </ConnorSortableProjectItem>
                      ))}
                    </SortableContext>
                  </ul>
                </DndContext>
              ) : (
                <ul ref={attachListAutoAnimateRef} role="list" className="flex flex-col gap-px">
                  {projectSections.map((section) => (
                    <li key={section.project.projectKey} className="list-none">
                      {renderProjectSectionContent(section, null)}
                    </li>
                  ))}
                </ul>
              );
            })()
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter showHistory />
    </>
  );
}
