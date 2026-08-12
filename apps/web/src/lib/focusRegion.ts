/**
 * Which half of the workspace the user is working in: the chat column or the
 * right panel. Shortcuts that mean "close the thing I'm looking at" (mod+w)
 * need this to pick a target.
 *
 * `document.activeElement` answers it most of the time, but plenty of the
 * workspace is not focusable - clicking a message, a diff hunk, or empty
 * panel padding leaves focus on `<body>`. A pointer-down listener remembers
 * the last region the user clicked into so those clicks still count, while a
 * genuinely focused element elsewhere (sidebar row, dialog field) still wins.
 */
export type FocusRegion = "chat" | "right-panel";

const RIGHT_PANEL_SELECTOR = "[data-right-panel-tabbar], [data-right-panel-surface-content]";
const CHAT_SELECTOR = "[data-chat-column]";

let lastPointerRegion: FocusRegion | null = null;

function regionForElement(target: unknown): FocusRegion | null {
  if (!(target instanceof Element) || !target.isConnected) return null;
  if (target.closest(RIGHT_PANEL_SELECTOR)) return "right-panel";
  if (target.closest(CHAT_SELECTOR)) return "chat";
  return null;
}

/**
 * Install the pointer tracker. Safe to call from several components; each
 * caller must invoke the returned disposer.
 */
export function trackFocusRegion(): () => void {
  const onPointerDown = (event: PointerEvent) => {
    // A click outside both regions clears the memory rather than leaving a
    // stale one behind - the user moved on to the sidebar or a dialog.
    lastPointerRegion = regionForElement(event.target);
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
  };
}

/**
 * Arbitrates between live focus and the remembered click. Exported for tests;
 * `getFocusRegion` is what callers want.
 */
export function pickFocusRegion(input: {
  focusedRegion: FocusRegion | null;
  /** Focus rests on the document itself, so nothing owns the keystroke yet. */
  documentIdle: boolean;
  clickedRegion: FocusRegion | null;
}): FocusRegion | null {
  if (input.focusedRegion !== null) return input.focusedRegion;
  if (!input.documentIdle) return null;
  return input.clickedRegion;
}

/**
 * Null when the user is somewhere that owns neither region - the sidebar, a
 * dialog, or a route without a chat. Callers should leave the key alone then.
 */
export function getFocusRegion(): FocusRegion | null {
  const active = document.activeElement;
  return pickFocusRegion({
    focusedRegion: regionForElement(active),
    documentIdle:
      active === null || active === document.body || active === document.documentElement,
    clickedRegion: lastPointerRegion,
  });
}
