import { describe, expect, it } from "vite-plus/test";

import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";

import {
  preventRepeatedCloseShortcut,
  preventTerminalCloseShortcut,
  type TerminalCloseShortcutEvent,
} from "./terminalCloseShortcut";

const modW = {
  key: "w",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: true,
} as const;

const keybindings = [
  {
    command: "terminal.close",
    shortcut: modW,
    whenAst: { type: "identifier", name: "terminalFocus" },
  },
] satisfies ResolvedKeybindingsConfig;

const archiveOnlyKeybindings = [
  {
    command: "thread.archive",
    shortcut: modW,
    whenAst: { type: "identifier", name: "chatFocus" },
  },
] satisfies ResolvedKeybindingsConfig;

type KeyboardEventOverrides = Partial<
  Pick<
    TerminalCloseShortcutEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat"
  >
>;

function keyboardEvent(
  overrides: KeyboardEventOverrides = {},
): TerminalCloseShortcutEvent & { readonly defaultPrevented: boolean } {
  let defaultPrevented = false;
  return {
    key: "w",
    code: "KeyW",
    metaKey: false,
    ctrlKey: true,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...overrides,
    preventDefault: () => {
      defaultPrevented = true;
    },
    get defaultPrevented() {
      return defaultPrevented;
    },
  };
}

describe("terminal close shortcut guards", () => {
  it("prevents the browser default for a deliberate terminal close", () => {
    const event = keyboardEvent();

    expect(preventTerminalCloseShortcut(event, keybindings, "Linux x86_64")).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps held close repeats from closing the browser after the last terminal unmounts", () => {
    const firstPress = keyboardEvent();
    expect(preventTerminalCloseShortcut(firstPress, keybindings, "Linux x86_64")).toBe(true);

    let browserCloseCount = 0;
    for (const repeat of [true, true, true]) {
      const event = keyboardEvent({ repeat });
      preventRepeatedCloseShortcut(event, keybindings, "Linux x86_64");
      if (!event.defaultPrevented) browserCloseCount += 1;
    }

    expect(browserCloseCount).toBe(0);
    expect(preventRepeatedCloseShortcut(keyboardEvent(), keybindings, "Linux x86_64")).toBe(false);
  });

  it("swallows repeats for any command bound to the window-close key", () => {
    const repeat = keyboardEvent({ repeat: true });

    expect(preventRepeatedCloseShortcut(repeat, archiveOnlyKeybindings, "Linux x86_64")).toBe(true);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it("leaves a non-repeated window close and unrelated repeats alone", () => {
    const deliberateWindowClose = keyboardEvent({ repeat: false });
    const unrelatedRepeat = keyboardEvent({ key: "q", code: "KeyQ", repeat: true });

    expect(preventRepeatedCloseShortcut(deliberateWindowClose, keybindings, "Linux x86_64")).toBe(
      false,
    );
    expect(deliberateWindowClose.defaultPrevented).toBe(false);
    expect(preventRepeatedCloseShortcut(unrelatedRepeat, keybindings, "Linux x86_64")).toBe(false);
    expect(unrelatedRepeat.defaultPrevented).toBe(false);
  });
});
