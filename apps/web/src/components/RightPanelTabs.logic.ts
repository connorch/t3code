/**
 * Overlays that must win over the launcher's letter shortcuts. Closed keepMounted popups stop
 * blocking once their exit transition ends.
 */
export const LAUNCHER_SHORTCUT_BLOCKING_LAYERS = [
  "dialog-popup",
  "alert-dialog-popup",
  "command-dialog-popup",
  "menu-popup",
  "select-popup",
  "popover-popup",
  "combobox-popup",
  "autocomplete-popup",
]
  .map((slot) => `[data-slot="${slot}"]:is([data-open],[data-ending-style])`)
  .join(",");

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
 * A focused editable is a typing context even while empty, or launcher letters would steal
 * prompts from a resting composer. Skip contenteditable=false islands to find their editable
 * host, matching the composer typing guard.
 */
export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
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
  // composedPath sees into shadow roots, where `target` is retargeted to the host.
  const target = event.composedPath?.()[0] ?? event.target;
  if (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    surfaceShortcutTargetsTypingContext(target)
  )
    return false;
  return true;
}
