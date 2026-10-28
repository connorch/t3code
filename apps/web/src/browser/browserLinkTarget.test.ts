import type { BrowserLinkTarget } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { resolveLinkTarget } from "./browserLinkTarget";

const settings = vi.hoisted(() => ({
  browserLinkTarget: "system" as BrowserLinkTarget,
  openLinksInPreviewPattern: "",
}));

vi.mock("~/hooks/useSettings", () => ({
  ensureClientSettingsHydrated: vi.fn(async () => undefined),
  getClientSettings: () => settings,
}));

const click = { metaKey: false, ctrlKey: false };

describe("resolveLinkTarget", () => {
  it("lets matching patterns override the default while retaining modifier and runtime guards", () => {
    const input = {
      url: "https://example.com/docs",
      event: click,
      preference: "system" as const,
      canOpenInApp: true,
      previewPattern: "example\\.com",
    };
    expect(resolveLinkTarget(input)).toBe("app");
    expect(resolveLinkTarget({ ...input, url: "https://other.com" })).toBe("system");
    expect(resolveLinkTarget({ ...input, event: { metaKey: true, ctrlKey: false } })).toBe(
      "system",
    );
    expect(resolveLinkTarget({ ...input, canOpenInApp: false })).toBe("system");
    expect(resolveLinkTarget({ ...input, previewPattern: "[" })).toBe("system");
  });
  it("leaves non-web schemes to the shell", () => {
    for (const url of ["mailto:someone@example.com", "vscode://file/x", "not a url"]) {
      expect(resolveLinkTarget({ url, event: click, preference: "app", canOpenInApp: true })).toBe(
        "system",
      );
    }
  });
});
