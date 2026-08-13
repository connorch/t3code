import type { RightPanelKind } from "~/rightPanelStore";

/** Overlays that must win over the launcher's letter shortcuts. */
export const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  '[data-slot="dialog-popup"]',
  '[data-slot="alert-dialog-popup"]',
  '[data-slot="command-dialog-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="popover-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

export type LaunchableSurfaceKind = Extract<
  RightPanelKind,
  "preview" | "terminal" | "files" | "diff" | "pull-request" | "agents"
>;

export interface LaunchableSurface {
  surfaceKind: LaunchableSurfaceKind;
  /** Multi-instance surfaces keep their icon ghost while instances are open; singletons drop it. */
  multiInstance: boolean;
}

/** Icon ghosts stay one click away; singletons disappear once that surface is already a tab. */
export function iconGhostsForOpenSurfaces<T extends LaunchableSurface>(
  actions: readonly T[],
  openKinds: readonly RightPanelKind[],
): T[] {
  return actions.filter(
    (action) => action.multiInstance || !openKinds.includes(action.surfaceKind),
  );
}

export function emptyGhostTooltip(action: {
  available: boolean;
  description: string;
  disabledReason: string | null;
  shortcut: string;
}): { label: string; shortcut: string | null } {
  if (!action.available) return { label: action.disabledReason ?? "", shortcut: null };
  return { label: action.description, shortcut: action.shortcut };
}

/**
 * Letter shortcuts work while the empty launcher is visible, not only while it
 * is focused. Typing contexts, modifier chords, and already-handled events
 * are left alone.
 */
export function shouldClaimSurfaceLauncherKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (typeof document !== "undefined" && document.querySelector(LAUNCHER_SHORTCUT_BLOCKING_LAYERS))
    return false;
  const target = event.target;
  if (typeof HTMLElement !== "undefined" && target instanceof HTMLElement) {
    if (target.closest("input, textarea, select")) return false;
    const editable = target.isContentEditable ? target : target.closest("[contenteditable]");
    if (editable && (editable.textContent ?? "").trim().length > 0) return false;
  }
  return true;
}
