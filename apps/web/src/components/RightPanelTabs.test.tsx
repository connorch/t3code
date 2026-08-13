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
      terminalLabelsById={new Map()}
      onActivate={noop}
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
