import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ContextMenuItem, PreviewSessionSnapshot, PullRequestState } from "@t3tools/contracts";
import { getTerminalLabel } from "@t3tools/shared/terminalLabels";
import {
  Bot,
  FileDiff,
  Files,
  GitPullRequest,
  Globe2,
  Plus,
  TerminalSquare,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import type { DesktopPreviewOverlay } from "~/previewStateStore";
import type { RightPanelSurface } from "~/rightPanelStore";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { ScrollArea } from "~/components/ui/scroll-area";
import { faviconUrlForOrigin } from "~/lib/favicon";
import { useTheme } from "~/hooks/useTheme";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
import { FaviconImage } from "./preview/PreviewFaviconIcon";
import { PierreEntryIcon } from "./chat/PierreEntryIcon";
import {
  emptyGhostTooltip,
  iconGhostsForOpenSurfaces,
  shouldClaimSurfaceLauncherKey,
  type LaunchableSurfaceKind,
} from "./RightPanelTabs.logic";

interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  /** Forwarded to PreviewPanelShell so this surface persists its own width. */
  widthStorageKey?: string;
  /** Forwarded to PreviewPanelShell as the initial width before a user resize. */
  defaultWidth?: number;
  layoutControls?: ReactNode;
  surfaces: readonly RightPanelSurface[];
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  previewSessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  terminalLabelsById: ReadonlyMap<string, string>;
  onActivate: (surface: RightPanelSurface) => void;
  onReorderSurface: (surfaceId: string, targetSurfaceId: string) => void;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onCopyFilePath: (relativePath: string) => void;
  onAddBrowser: () => void;
  onAddTerminal: () => void;
  onAddDiff: () => void;
  onAddFiles: () => void;
  onAddPullRequest: () => void;
  onAddAgents: () => void;
  browserAvailable: boolean;
  terminalAvailable: boolean;
  diffAvailable: boolean;
  filesAvailable: boolean;
  pullRequestAvailable: boolean;
  agentsAvailable: boolean;
  pullRequestStatuses?: Readonly<Record<string, PullRequestTabStatus>>;
  /** Running + waiting subagents; badges the Agents ghost in the empty tab strip. */
  liveAgentCount: number;
  children: ReactNode;
}

export interface PullRequestTabStatus {
  projectId: string;
  repository: string;
  number: number;
  state: PullRequestState;
  isDraft: boolean;
}

const SURFACE_DISABLED_REASONS = {
  browser: "Browser previews are only available in the T3 Code desktop app.",
  terminal: "Terminal surfaces are only available from a project thread.",
  files: "Files are only available when a project is open.",
  diff: "Diff is only available for server threads in Git repositories.",
  pullRequest: "This thread's branch has no pull request yet.",
  agents: "Agents are only available from a thread.",
} as const;

type TabContextMenuAction = "copy-path" | "close" | "close-others" | "close-to-right" | "close-all";

function DisabledReasonTooltip(props: { reason: string; trigger: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={props.trigger} />
      <TooltipPopup side="top">{props.reason}</TooltipPopup>
    </Tooltip>
  );
}

function SurfaceMenuItem(props: {
  available: boolean;
  disabledReason?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const item = (
    <MenuItem
      className={!props.available ? "data-disabled:pointer-events-auto" : undefined}
      onClick={props.onClick}
      disabled={!props.available}
    >
      {props.children}
    </MenuItem>
  );
  if (props.available || !props.disabledReason) return item;
  return <DisabledReasonTooltip reason={props.disabledReason} trigger={item} />;
}

/** One launchable surface, shared by the ghost tabs, icon ghosts, and the narrow-panel + menu. */
interface SurfaceAction {
  label: string;
  /** Tooltip and aria-label for the icon-only ghost, e.g. "New terminal". */
  addLabel: string;
  description: string;
  icon: LucideIcon;
  surfaceKind: LaunchableSurfaceKind;
  /** Multi-instance surfaces keep their ghost while instances are open; singletons drop it. */
  multiInstance: boolean;
  shortcut: string;
  available: boolean;
  disabledReason: string | null;
  onClick: () => void;
  badgeCount: number;
}

function ActionIcon({ action, className }: { action: SurfaceAction; className: string }) {
  const Icon = action.icon;
  return (
    <span className="relative inline-flex shrink-0">
      <Icon className={className} />
      {action.badgeCount > 0 ? (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-info px-1 text-[9px] font-semibold tabular-nums text-white"
        >
          {action.badgeCount}
        </span>
      ) : null}
    </span>
  );
}

/** Labeled ghost tab shown in the empty tab strip; clicking it opens the surface in place. */
function GhostSurfaceTab({ action }: { action: SurfaceAction }) {
  const tooltip = emptyGhostTooltip(action);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={action.available ? action.onClick : undefined}
            aria-disabled={!action.available}
            {...(action.available ? { "aria-keyshortcuts": action.shortcut.toLowerCase() } : {})}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs text-muted-foreground",
              action.available
                ? "cursor-pointer hover:bg-accent/60 hover:text-foreground"
                : "cursor-not-allowed opacity-40",
            )}
          >
            <ActionIcon action={action} className="size-3" />
            {action.label}
          </button>
        }
      />
      <TooltipPopup side="bottom" className="flex items-center gap-1.5">
        <span>{tooltip.label}</span>
        {tooltip.shortcut ? <Kbd>{tooltip.shortcut}</Kbd> : null}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Icon-only ghost shown after real tabs so surfaces stay one click away in the same spot. */
function GhostSurfaceIconButton({ action }: { action: SurfaceAction }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={action.available ? action.onClick : undefined}
            aria-disabled={!action.available}
            aria-label={action.addLabel}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground",
              action.available
                ? "cursor-pointer hover:bg-accent/60 hover:text-foreground"
                : "cursor-not-allowed opacity-40",
            )}
          >
            <ActionIcon action={action} className="size-3" />
          </button>
        }
      />
      <TooltipPopup side="bottom">
        {action.available ? action.addLabel : action.disabledReason}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Open tab; drag-sortable within the strip to reorder surfaces. */
function SortableSurfaceTab(props: {
  surface: RightPanelSurface;
  active: boolean;
  pending: boolean;
  title: string;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  theme: "light" | "dark";
  pullRequestStatuses: Readonly<Record<string, PullRequestTabStatus>> | undefined;
  onActivate: () => void;
  onClose: () => void;
  onMouseDown: (event: ReactMouseEvent) => void;
  onAuxClick: (event: ReactMouseEvent) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: props.surface.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
      data-active-tab={props.active}
      onMouseDown={props.onMouseDown}
      onAuxClick={props.onAuxClick}
      onContextMenu={props.onContextMenu}
      className={cn(
        // no-drag keeps tab drags from moving the frameless desktop window.
        "cursor-pointer group/tab flex h-6 max-w-36 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1.5 text-xs [-webkit-app-region:no-drag]",
        props.active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        isDragging && "relative z-10 opacity-80",
      )}
    >
      <button
        type="button"
        className="cursor-pointer group/close relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
        aria-label={`Close ${props.title}`}
        onClick={props.onClose}
      >
        <span className="relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden">
          <SurfaceIcon
            surface={props.surface}
            sessions={props.sessions}
            desktopByTabId={props.desktopByTabId}
            theme={props.theme}
            pullRequestStatuses={props.pullRequestStatuses}
          />
          {props.pending ? (
            <span
              className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-current"
              aria-hidden
            />
          ) : null}
        </span>
        <X className="hidden size-3 group-hover/tab:block group-focus-visible/close:block" />
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="cursor-pointer flex min-w-0 items-center"
              onClick={props.onActivate}
            >
              <span className="truncate">{props.title}</span>
            </button>
          }
        />
        <TooltipPopup>{props.title}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function surfaceTitle(
  surface: RightPanelSurface,
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>,
  terminalLabelsById: ReadonlyMap<string, string>,
): string {
  switch (surface.kind) {
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.slice(surface.relativePath.lastIndexOf("/") + 1);
    case "terminal":
      return (
        terminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId)
      );
    case "pull-request":
      return `#${surface.number}`;
    case "agents":
      return "Agents";
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      if (!snapshot || snapshot.navStatus._tag === "Idle") return "Browser";
      if (snapshot.navStatus.title.trim().length > 0) return snapshot.navStatus.title;
      try {
        return new URL(snapshot.navStatus.url).host || "Browser";
      } catch {
        return "Browser";
      }
    }
  }
}

function PreviewFavicon({ capturedUrl, url }: { capturedUrl: string | null; url: string | null }) {
  const publicProviderUrl = faviconUrlForOrigin(url, 32);
  return (
    <FaviconImage
      sources={[capturedUrl, publicProviderUrl]}
      fallback={<Globe2 className="size-3 shrink-0" />}
      className="size-3 shrink-0 rounded-sm object-contain"
    />
  );
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function SurfaceIcon({
  surface,
  sessions,
  desktopByTabId,
  theme,
  pullRequestStatuses,
}: {
  surface: RightPanelSurface;
  sessions: Readonly<Record<string, PreviewSessionSnapshot>>;
  desktopByTabId: Readonly<Record<string, DesktopPreviewOverlay>>;
  theme: "light" | "dark";
  pullRequestStatuses: Readonly<Record<string, PullRequestTabStatus>> | undefined;
}) {
  switch (surface.kind) {
    case "preview": {
      const snapshot = surface.resourceId ? sessions[surface.resourceId] : null;
      const url = !snapshot || snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
      const favicon = snapshot ? (desktopByTabId[snapshot.tabId]?.favicon ?? null) : null;
      const capturedUrl =
        favicon && url && sameOrigin(favicon.pageUrl, url) ? favicon.dataUrl : null;
      return <PreviewFavicon capturedUrl={capturedUrl} url={url} />;
    }
    case "diff":
      return <FileDiff className="size-3 shrink-0" />;
    case "files":
      return <Files className="size-3 shrink-0" />;
    case "file":
      return (
        <PierreEntryIcon
          pathValue={surface.relativePath}
          kind="file"
          theme={theme}
          className="size-3"
        />
      );
    case "terminal":
      return <TerminalSquare className="size-3 shrink-0" />;
    case "pull-request": {
      const status = pullRequestStatuses?.[surface.id] ?? null;
      const toneClassName =
        status?.state === "merged"
          ? "text-violet-600 dark:text-violet-300/90"
          : status?.state === "closed"
            ? "text-red-600 dark:text-red-300/90"
            : status?.isDraft
              ? "text-zinc-500 dark:text-zinc-400/80"
              : status?.state === "open"
                ? "text-emerald-600 dark:text-emerald-300/90"
                : "text-muted-foreground";
      return <GitPullRequest className={cn("size-3 shrink-0", toneClassName)} />;
    }
    case "agents":
      return <Bot className="size-3 shrink-0" />;
  }
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  const ownsDesktopTitleBar = isElectron && props.mode === "inline";
  const { resolvedTheme } = useTheme();
  const tabListRef = useRef<HTMLDivElement>(null);
  const isLauncherVisible = props.surfaces.length === 0;

  const surfaceActions: readonly SurfaceAction[] = [
    {
      label: "Terminal",
      addLabel: "New terminal",
      description: "Start a shell in this workspace.",
      icon: TerminalSquare,
      surfaceKind: "terminal",
      multiInstance: true,
      shortcut: "T",
      available: props.terminalAvailable,
      disabledReason: props.terminalAvailable ? null : SURFACE_DISABLED_REASONS.terminal,
      onClick: props.onAddTerminal,
      badgeCount: 0,
    },
    {
      label: "Files",
      addLabel: "Files",
      description: "Browse and read workspace files.",
      icon: Files,
      surfaceKind: "files",
      multiInstance: false,
      shortcut: "F",
      available: props.filesAvailable,
      disabledReason: props.filesAvailable ? null : SURFACE_DISABLED_REASONS.files,
      onClick: props.onAddFiles,
      badgeCount: 0,
    },
    {
      label: "Diff",
      addLabel: "Diff",
      description: "Review changes in this thread.",
      icon: FileDiff,
      surfaceKind: "diff",
      multiInstance: false,
      shortcut: "D",
      available: props.diffAvailable,
      disabledReason: props.diffAvailable ? null : SURFACE_DISABLED_REASONS.diff,
      onClick: props.onAddDiff,
      badgeCount: 0,
    },
    {
      label: "Pull request",
      addLabel: "Pull request",
      description: "Open this branch's pull request.",
      icon: GitPullRequest,
      surfaceKind: "pull-request",
      multiInstance: false,
      shortcut: "P",
      available: props.pullRequestAvailable,
      disabledReason: props.pullRequestAvailable ? null : SURFACE_DISABLED_REASONS.pullRequest,
      onClick: props.onAddPullRequest,
      badgeCount: 0,
    },
    {
      label: "Browser",
      addLabel: "New browser",
      description: "Open a local app or URL.",
      icon: Globe2,
      surfaceKind: "preview",
      multiInstance: true,
      shortcut: "B",
      available: props.browserAvailable,
      disabledReason: props.browserAvailable ? null : SURFACE_DISABLED_REASONS.browser,
      onClick: props.onAddBrowser,
      badgeCount: 0,
    },
    {
      label: "Agents",
      addLabel: "Agents",
      description: "Follow subagents and workflows.",
      icon: Bot,
      surfaceKind: "agents",
      multiInstance: false,
      shortcut: "A",
      available: props.agentsAvailable,
      disabledReason: props.agentsAvailable ? null : SURFACE_DISABLED_REASONS.agents,
      onClick: props.onAddAgents,
      badgeCount: props.liveAgentCount,
    },
  ];
  const ghostIconActions = iconGhostsForOpenSurfaces(
    surfaceActions,
    props.surfaces.map((surface) => surface.kind),
  );
  const availableLauncherActions = surfaceActions.filter((action) => action.available);

  const shortcutActionsRef = useRef(availableLauncherActions);
  useEffect(() => {
    shortcutActionsRef.current = availableLauncherActions;
  });
  useEffect(() => {
    if (!isLauncherVisible) return;
    const handler = (event: KeyboardEvent) => {
      if (!shouldClaimSurfaceLauncherKey(event)) return;
      const action = shortcutActionsRef.current.find(
        (candidate) => candidate.shortcut.toLowerCase() === event.key.toLowerCase(),
      );
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action.onClick();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isLauncherVisible]);

  const handleTabContextMenu = useCallback(
    async (event: ReactMouseEvent, surface: RightPanelSurface) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const surfaceIndex = props.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;

      const items: ContextMenuItem<TabContextMenuAction>[] = [];
      if (surface.kind === "file") {
        items.push({ id: "copy-path", label: "Copy path" });
      }
      items.push(
        { id: "close", label: "Close" },
        {
          id: "close-others",
          label: "Close others",
          disabled: props.surfaces.length <= 1,
        },
        {
          id: "close-to-right",
          label: "Close to the right",
          disabled: surfaceIndex >= props.surfaces.length - 1,
        },
        {
          id: "close-all",
          label: "Close all",
          disabled: props.surfaces.length === 0,
        },
      );

      const action = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
      switch (action) {
        case "copy-path":
          if (surface.kind === "file") props.onCopyFilePath(surface.relativePath);
          break;
        case "close":
          props.onCloseSurface(surface);
          break;
        case "close-others":
          props.onCloseOtherSurfaces(surface);
          break;
        case "close-to-right":
          props.onCloseSurfacesToRight(surface);
          break;
        case "close-all":
          props.onCloseAllSurfaces();
          break;
        case null:
          break;
      }
    },
    [props],
  );
  // Distance constraint keeps plain clicks activating/closing tabs instead of starting a drag.
  const tabDragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const handleTabDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      props.onReorderSurface(String(active.id), String(over.id));
    },
    [props],
  );
  const handleTabMouseDown = useCallback((event: ReactMouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();
  }, []);
  const handleTabAuxClick = useCallback(
    (event: ReactMouseEvent, surface: RightPanelSurface) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      props.onCloseSurface(surface);
    },
    [props],
  );

  useEffect(() => {
    const activeTab = tabListRef.current?.querySelector<HTMLElement>("[data-active-tab='true']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSurfaceId]);

  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized !== undefined ? { maximized: props.maximized } : {})}
      {...(props.widthStorageKey !== undefined ? { widthStorageKey: props.widthStorageKey } : {})}
      {...(props.defaultWidth !== undefined ? { defaultWidth: props.defaultWidth } : {})}
    >
      <div
        className={cn(
          "flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-1 pl-2",
          // The sheet overlays from the viewport top, so its tab bar keeps
          // the titlebar's height: a compact row re-centers the layout
          // controls a few pixels higher and the cluster jumps on open.
          props.mode === "inline" && !props.layoutControls ? "pr-28" : "pr-3",
          ownsDesktopTitleBar && "wco:pr-[calc(var(--workspace-native-controls-inset)+6rem)]",
          props.mode === "inline" && props.maximized && COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
        data-right-panel-tabbar
        {...(isLauncherVisible
          ? {
              "data-surface-launcher-keys": availableLauncherActions
                .map((action) => action.shortcut)
                .join(""),
            }
          : {})}
      >
        <ScrollArea
          ref={tabListRef}
          hideScrollbars
          scrollFade
          className={cn(
            "@container/tab-strip min-w-0 flex-1 rounded-none",
            ownsDesktopTitleBar && "drag-region",
          )}
          data-right-panel-tab-list
        >
          <div className="flex h-full w-max min-w-full items-center gap-1">
            <DndContext
              sensors={tabDragSensors}
              modifiers={[restrictToHorizontalAxis, restrictToFirstScrollableAncestor]}
              onDragEnd={handleTabDragEnd}
            >
              <SortableContext
                items={props.surfaces.map((surface) => surface.id)}
                strategy={horizontalListSortingStrategy}
              >
                {props.surfaces.map((surface) => (
                  <SortableSurfaceTab
                    key={surface.id}
                    surface={surface}
                    active={surface.id === props.activeSurfaceId}
                    pending={props.pendingSurfaceIds.has(surface.id)}
                    title={surfaceTitle(surface, props.previewSessions, props.terminalLabelsById)}
                    sessions={props.previewSessions}
                    desktopByTabId={props.desktopByTabId}
                    theme={resolvedTheme}
                    pullRequestStatuses={props.pullRequestStatuses}
                    onActivate={() => props.onActivate(surface)}
                    onClose={() => props.onCloseSurface(surface)}
                    onMouseDown={handleTabMouseDown}
                    onAuxClick={(event) => handleTabAuxClick(event, surface)}
                    onContextMenu={(event) => void handleTabContextMenu(event, surface)}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {isLauncherVisible ? (
              surfaceActions.map((action) => <GhostSurfaceTab key={action.label} action={action} />)
            ) : (
              <>
                {/* Icon ghosts keep every surface one click away; below @xs they collapse into the + menu. */}
                <div
                  className="mx-0.5 hidden h-4 w-px shrink-0 bg-border/70 @xs/tab-strip:block"
                  aria-hidden
                />
                <TooltipProvider delay={0}>
                  <div className="hidden items-center gap-1 @xs/tab-strip:flex">
                    {ghostIconActions.map((action) => (
                      <GhostSurfaceIconButton key={action.label} action={action} />
                    ))}
                  </div>
                </TooltipProvider>
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        aria-label="Add panel surface"
                        className="size-6 shrink-0 text-muted-foreground hover:text-foreground @xs/tab-strip:hidden"
                        size="icon-xs"
                        variant="ghost"
                      />
                    }
                  >
                    <Plus className="size-3.5" />
                  </MenuTrigger>
                  <MenuPopup align="start" side="bottom" sideOffset={6} className="min-w-44">
                    {surfaceActions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <SurfaceMenuItem
                          key={action.label}
                          available={action.available}
                          {...(action.disabledReason !== null
                            ? { disabledReason: action.disabledReason }
                            : {})}
                          onClick={action.onClick}
                        >
                          <Icon />
                          {action.label}
                        </SurfaceMenuItem>
                      );
                    })}
                  </MenuPopup>
                </Menu>
              </>
            )}
          </div>
        </ScrollArea>
        {props.layoutControls}
      </div>
      <div className="flex min-h-0 flex-1 flex-col" data-right-panel-surface-content>
        {props.activeSurfaceId === null ? (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <p className="text-muted-foreground/60 text-xs">No surface open</p>
          </div>
        ) : (
          props.children
        )}
      </div>
    </PreviewPanelShell>
  );
}
