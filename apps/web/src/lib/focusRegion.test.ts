import { describe, expect, it } from "vite-plus/test";

import { pickFocusRegion } from "./focusRegion";

describe("pickFocusRegion", () => {
  it("follows live focus", () => {
    expect(
      pickFocusRegion({
        focusedRegion: "right-panel",
        documentIdle: false,
        clickedRegion: "chat",
      }),
    ).toBe("right-panel");
  });

  it("falls back to the last clicked region for unfocusable workspace areas", () => {
    expect(
      pickFocusRegion({ focusedRegion: null, documentIdle: true, clickedRegion: "chat" }),
    ).toBe("chat");
  });

  it("claims nothing while focus sits outside both regions", () => {
    // A sidebar row or dialog field owns the keystroke, even if the user
    // clicked into the chat a moment earlier.
    expect(
      pickFocusRegion({ focusedRegion: null, documentIdle: false, clickedRegion: "chat" }),
    ).toBeNull();
  });

  it("claims nothing before the user has touched either region", () => {
    expect(
      pickFocusRegion({ focusedRegion: null, documentIdle: true, clickedRegion: null }),
    ).toBeNull();
  });
});
