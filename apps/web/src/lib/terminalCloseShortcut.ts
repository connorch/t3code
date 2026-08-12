import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";

import {
  isTerminalCloseShortcut,
  matchesAnyCommandShortcut,
  type ShortcutEventLike,
} from "../keybindings";

export interface TerminalCloseShortcutEvent extends ShortcutEventLike {
  readonly repeat?: boolean;
  readonly preventDefault: () => void;
}

/**
 * Commands that ship on mod+w, the OS "close window" key. A held press
 * outlives the surface that handled it (the terminal is gone, the tab is
 * closed), so repeats must stay swallowed regardless of what is focused now -
 * otherwise the tail of a deliberate close tears down the window.
 */
const WINDOW_CLOSE_CONFLICTING_COMMANDS = [
  "terminal.close",
  "rightPanel.closeTab",
  "thread.archive",
] as const satisfies readonly KeybindingCommand[];

function terminalCloseShortcutOptions(platform?: string) {
  return {
    ...(platform === undefined ? {} : { platform }),
    context: { terminalFocus: true, terminalOpen: true },
  };
}

export function preventTerminalCloseShortcut(
  event: TerminalCloseShortcutEvent,
  keybindings: ResolvedKeybindingsConfig,
  platform?: string,
): boolean {
  if (!isTerminalCloseShortcut(event, keybindings, terminalCloseShortcutOptions(platform))) {
    return false;
  }
  event.preventDefault();
  return true;
}

export function preventRepeatedCloseShortcut(
  event: TerminalCloseShortcutEvent,
  keybindings: ResolvedKeybindingsConfig,
  platform?: string,
): boolean {
  if (!event.repeat) return false;
  const options = platform === undefined ? undefined : { platform };
  if (!matchesAnyCommandShortcut(event, keybindings, WINDOW_CLOSE_CONFLICTING_COMMANDS, options)) {
    return false;
  }
  event.preventDefault();
  return true;
}
