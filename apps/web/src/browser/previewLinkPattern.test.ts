import { describe, expect, it } from "vite-plus/test";

import { urlMatchesPreviewLinkPattern } from "./previewLinkPattern";

describe("urlMatchesPreviewLinkPattern", () => {
  it("matches URLs against the pattern", () => {
    expect(
      urlMatchesPreviewLinkPattern(String.raw`^https://github\.com/`, "https://github.com/t3/t3"),
    ).toBe(true);
    expect(
      urlMatchesPreviewLinkPattern(String.raw`^https://github\.com/`, "https://example.com/"),
    ).toBe(false);
  });

  it("matches nothing for an empty or whitespace pattern", () => {
    expect(urlMatchesPreviewLinkPattern("", "https://example.com/")).toBe(false);
    expect(urlMatchesPreviewLinkPattern("   ", "https://example.com/")).toBe(false);
  });

  it("matches nothing for an invalid pattern", () => {
    expect(urlMatchesPreviewLinkPattern("(unclosed", "https://example.com/")).toBe(false);
  });

  it("recompiles when the pattern changes", () => {
    expect(urlMatchesPreviewLinkPattern("github", "https://github.com/")).toBe(true);
    expect(urlMatchesPreviewLinkPattern("gitlab", "https://github.com/")).toBe(false);
  });
});
