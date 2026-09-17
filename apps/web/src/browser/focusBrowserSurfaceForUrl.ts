import type { ScopedThreadRef } from "@t3tools/contracts";

import { readThreadPreviewState, setActivePreviewTab } from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

/** Reuses a browser surface at its current URL without navigating or reloading it. */
export function focusBrowserSurfaceForUrl(threadRef: ScopedThreadRef, url: string): boolean {
  const target = URL.parse(url);
  if (!target) return false;

  const panel = useRightPanelStore.getState();
  const { surfaces } = selectThreadRightPanelState(panel.byThreadKey, threadRef);
  const { sessions } = readThreadPreviewState(threadRef);
  for (const surface of surfaces) {
    if (surface.kind !== "preview" || surface.resourceId === null) continue;
    const status = sessions[surface.resourceId]?.navStatus;
    if (!status || status._tag === "Idle") continue;
    if (URL.parse(status.url)?.href !== target.href) continue;

    panel.activateSurface(threadRef, surface.id);
    setActivePreviewTab(threadRef, surface.resourceId);
    return true;
  }
  return false;
}
