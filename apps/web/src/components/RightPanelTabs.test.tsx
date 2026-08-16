import type { DesktopPreviewFavicon, PreviewSessionSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RightPanelTabs } from "./RightPanelTabs";

const noop = () => undefined;

function render(overrides: Partial<Parameters<typeof RightPanelTabs>[0]> = {}) {
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="sheet"
      surfaces={[]}
      activeSurfaceId={null}
      pendingSurfaceIds={new Set()}
      previewSessions={{}}
      desktopByTabId={{}}
      terminalLabelsById={new Map()}
      onActivate={noop}
      onReorderSurface={noop}
      onCloseSurface={noop}
      onCloseOtherSurfaces={noop}
      onCloseSurfacesToRight={noop}
      onCloseAllSurfaces={noop}
      onCopyFilePath={noop}
      onAddBrowser={noop}
      onAddTerminal={noop}
      onAddDiff={noop}
      onAddFiles={noop}
      onAddPullRequest={noop}
      onAddAgents={noop}
      browserAvailable
      terminalAvailable
      diffAvailable
      filesAvailable
      pullRequestAvailable
      agentsAvailable
      liveAgentCount={0}
      {...overrides}
    >
      <div>open-surface-body</div>
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs", () => {
  it("launches surfaces from labeled ghost tabs instead of a centered card grid", () => {
    const html = render();
    expect(html).toContain("Browser");
    expect(html).toContain("Terminal");
    expect(html).toContain("Files");
    expect(html).toContain("Diff");
    expect(html).toContain("Pull request");
    expect(html).toContain("Agents");
    expect(html).toContain("No surface open");
    expect(html).toContain('data-surface-launcher-keys="TFDPBA"');
    expect(html).toContain('aria-keyshortcuts="t"');
    expect(html).not.toContain("Open a surface");
    expect(html).not.toContain("open-surface-body");
  });

  it("collapses remaining launchers to icon ghosts without letter shortcuts once a tab is open", () => {
    const html = render({
      surfaces: [
        {
          id: "terminal:term-1",
          kind: "terminal",
          resourceId: "term-1",
          terminalIds: ["term-1"],
          activeTerminalId: "term-1",
        },
      ],
      activeSurfaceId: "terminal:term-1",
    });
    expect(html).toContain("open-surface-body");
    expect(html).toContain('aria-label="New terminal"');
    expect(html).toContain('aria-label="New browser"');
    expect(html).not.toContain("data-surface-launcher-keys");
    expect(html).not.toContain("aria-keyshortcuts");
    expect(html).not.toContain("No surface open");
  });

  it("drops the Diff icon ghost after the singleton Diff tab is open", () => {
    const html = render({
      surfaces: [{ id: "diff", kind: "diff" }],
      activeSurfaceId: "diff",
    });
    expect(html).toContain('aria-label="New terminal"');
    expect(html).not.toContain('aria-label="Diff"');
  });
});

const previewSurface = {
  id: "browser:tab-1" as const,
  kind: "preview" as const,
  resourceId: "tab-1",
};
const secondSurface = {
  id: "browser:tab-2" as const,
  kind: "preview" as const,
  resourceId: "tab-2",
};
const sessions: Readonly<Record<string, PreviewSessionSnapshot>> = {
  "tab-1": {
    threadId: "thread-1",
    tabId: "tab-1",
    navStatus: { _tag: "Success", url: "http://24x.xf.local/", title: "Local site" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-08-09T00:00:00.000Z",
  },
  "tab-2": {
    threadId: "thread-1",
    tabId: "tab-2",
    navStatus: { _tag: "Success", url: "http://24x.xf.local/admin", title: "Admin" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-08-09T00:00:00.000Z",
  },
};

const favicon = (dataUrl: string, pageUrl: string): DesktopPreviewFavicon => ({
  dataUrl,
  pageUrl,
  capturedAt: 1,
});

function overlay(icon: DesktopPreviewFavicon | null) {
  return {
    hasWebContents: true,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomFactor: 1,
    pictureInPicture: false,
    colorScheme: "system" as const,
    controller: "none" as const,
    favicon: icon,
  };
}

function renderTabs(first: DesktopPreviewFavicon | null, second?: DesktopPreviewFavicon) {
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="inline"
      surfaces={second ? [previewSurface, secondSurface] : [previewSurface]}
      activeSurfaceId={previewSurface.id}
      pendingSurfaceIds={new Set()}
      previewSessions={sessions}
      desktopByTabId={{
        "tab-1": overlay(first),
        ...(second ? { "tab-2": overlay(second) } : {}),
      }}
      terminalLabelsById={new Map()}
      onActivate={() => undefined}
      onReorderSurface={() => undefined}
      onCloseSurface={() => undefined}
      onCloseOtherSurfaces={() => undefined}
      onCloseSurfacesToRight={() => undefined}
      onCloseAllSurfaces={() => undefined}
      onCopyFilePath={() => undefined}
      onAddBrowser={() => undefined}
      onAddTerminal={() => undefined}
      onAddPullRequest={() => undefined}
      onAddDiff={() => undefined}
      onAddFiles={() => undefined}
      onAddAgents={() => undefined}
      liveAgentCount={0}
      browserAvailable
      terminalAvailable={false}
      diffAvailable={false}
      filesAvailable={false}
      pullRequestAvailable={false}
      agentsAvailable={false}
    >
      <div>content</div>
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs preview favicon", () => {
  it("prefers a live capture and never asks Google about a private hostname", () => {
    const captured = renderTabs(favicon("data:image/png;base64,AAAA", "http://24x.xf.local/"));
    expect(captured).toContain("data:image/png;base64,AAAA");
    expect(captured).not.toContain("s2/favicons");
    expect(renderTabs(null)).not.toContain("s2/favicons");
  });

  it("keeps route-specific captures isolated between live tabs on one origin", () => {
    const html = renderTabs(
      favicon("data:image/png;base64,AAAA", "http://24x.xf.local/"),
      favicon("data:image/png;base64,BBBB", "http://24x.xf.local/admin"),
    );
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("data:image/png;base64,BBBB");
  });

  it("hides a capture while the server session still describes another origin", () => {
    const html = renderTabs(favicon("data:image/png;base64,AAAA", "https://example.com/"));
    expect(html).not.toContain("data:image/png;base64,AAAA");
  });
});
