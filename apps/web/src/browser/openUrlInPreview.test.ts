import {
  DEFAULT_CLIENT_SETTINGS,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { openDiscoveredPort } from "~/components/preview/openDiscoveredPort";
import { openTerminalLinkInPreview } from "~/components/preview/openTerminalLinkInPreview";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import { openUrlInPreview, type OpenPreviewMutation } from "./openFileInPreview";

vi.mock("~/previewStateStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/previewStateStore")>()),
  isPreviewSupportedInRuntime: () => true,
}));

const threadRef = {
  environmentId: "local" as ScopedThreadRef["environmentId"],
  threadId: "thread-1" as ScopedThreadRef["threadId"],
};
const url = "https://example.com/";

function snapshot(tabId: string, currentUrl = url): PreviewSessionSnapshot {
  return {
    threadId: threadRef.threadId,
    tabId,
    navStatus: { _tag: "Success", url: currentUrl, title: "Example" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
}

function addTab(tab: PreviewSessionSnapshot, ref = threadRef) {
  applyPreviewServerSnapshot(ref, tab);
  useRightPanelStore.getState().openBrowser(ref, tab.tabId);
}

function panelState() {
  return selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef);
}

const entryPoints = {
  link: (target: string, openPreview: OpenPreviewMutation) =>
    openUrlInPreview({ threadRef, url: target, openPreview }),
  terminal: (target: string, openPreview: OpenPreviewMutation) =>
    openTerminalLinkInPreview({
      threadRef,
      url: target,
      openPreview,
      forceBrowser: false,
      fallbackToBrowser: () => {
        throw new Error("Unexpected system browser fallback");
      },
    }),
  port: (target: string, openPreview: OpenPreviewMutation) =>
    openDiscoveredPort({
      threadRef,
      openPreview,
      port: {
        host: "example.com",
        port: 443,
        url: target,
        processName: null,
        pid: null,
        terminal: null,
      },
    }),
};

beforeEach(() => {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
  __setClientSettingsForTests({ ...DEFAULT_CLIENT_SETTINGS, browserLinkTarget: "app" });
});

describe.each(Object.entries(entryPoints))("%s links", (_name, open) => {
  it.each(["Success", "Loading"] as const)(
    "focuses an existing %s tab and reveals the panel without opening another session",
    async (status) => {
      const existing = snapshot("existing");
      addTab({ ...existing, navStatus: { _tag: status, url, title: "Example" } });
      addTab(snapshot("other", "https://other.example/"));
      useRightPanelStore.getState().close(threadRef);
      const surfaces = panelState().surfaces;
      const openPreview = vi.fn(async () => AsyncResult.success(snapshot("created")));

      // Browsers canonicalize an origin-only URL with a trailing slash.
      await open("https://example.com", openPreview);

      expect(openPreview).not.toHaveBeenCalled();
      expect(panelState()).toMatchObject({ isOpen: true, activeSurfaceId: "browser:existing" });
      expect(panelState().surfaces).toEqual(surfaces);
      expect(readThreadPreviewState(threadRef).activeTabId).toBe("existing");
    },
  );

  it.each(["https://example.com/docs", "https://example.com/?q=1", "https://example.com/#docs"])(
    "opens a new tab for a different URL: %s",
    async (target) => {
      addTab(snapshot("existing"));
      const openPreview = vi.fn(async () => AsyncResult.success(snapshot("created", target)));

      await open(target, openPreview);

      expect(openPreview).toHaveBeenCalledOnce();
      expect(panelState().activeSurfaceId).toBe("browser:created");
      expect(panelState().surfaces).toHaveLength(2);
    },
  );

  it.each(["thread", "environment"] as const)(
    "does not reuse a tab from another %s",
    async (scope) => {
      const otherRef = {
        environmentId: (scope === "environment"
          ? "remote"
          : "local") as ScopedThreadRef["environmentId"],
        threadId: (scope === "thread" ? "thread-2" : "thread-1") as ScopedThreadRef["threadId"],
      };
      addTab({ ...snapshot("elsewhere"), threadId: otherRef.threadId }, otherRef);
      const openPreview = vi.fn(async () => AsyncResult.success(snapshot("created")));

      await open(url, openPreview);

      expect(openPreview).toHaveBeenCalledOnce();
      expect(panelState().activeSurfaceId).toBe("browser:created");
    },
  );

  it("does not reuse a session missing from the surface list", async () => {
    applyPreviewServerSnapshot(threadRef, snapshot("hidden"));
    const openPreview = vi.fn(async () => AsyncResult.success(snapshot("created")));

    await open(url, openPreview);

    expect(openPreview).toHaveBeenCalledOnce();
    expect(panelState().surfaces.map((surface) => surface.id)).toEqual(["browser:created"]);
  });
});
