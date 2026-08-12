import * as Schema from "effect/Schema";
import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from "react";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "./useLocalStorage";

const HeightSchema = Schema.Finite;

export interface UseResizableHeightOptions {
  /** localStorage key the persisted height is stored under. */
  readonly storageKey: string;
  readonly minHeight: number;
  readonly maxHeight: number;
  /**
   * Rendered height of the panel when the drag starts. Dragging applies its
   * delta to this measurement, so the panel tracks the cursor even when the
   * stored height is null (auto) or clamped by the stylesheet.
   */
  readonly measureRenderedHeight: () => number | null;
}

export interface ResizableHeightHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onDoubleClick: () => void;
}

/**
 * Height state for a bottom-anchored panel resized via a drag handle on its
 * TOP edge (drag up to grow). `height` is null until the user drags, meaning
 * "size to content"; double-clicking the handle returns to that auto state.
 * Height is read from localStorage on mount and persisted on drag-end (not
 * on every rAF tick — would otherwise be ~60 writes/sec).
 */
export function useResizableHeight(options: UseResizableHeightOptions): {
  readonly height: number | null;
  readonly handlers: ResizableHeightHandlers;
} {
  const { storageKey, minHeight, maxHeight, measureRenderedHeight } = options;

  const clamp = useCallback(
    (value: number): number => {
      if (!Number.isFinite(value)) return minHeight;
      return Math.round(Math.max(minHeight, Math.min(maxHeight, value)));
    },
    [maxHeight, minHeight],
  );

  // No cross-tab subscription: panel height is per-window state.
  const [height, setHeight] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const stored = getLocalStorageItem(storageKey, HeightSchema);
      return stored === null ? null : clamp(stored);
    } catch (error) {
      console.error("Could not read persisted panel height.", error);
      return null;
    }
  });

  const dragStateRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    pending: number;
    rafId: number | null;
    target: HTMLElement;
  } | null>(null);

  const releasePointer = useCallback((pointerId: number) => {
    const state = dragStateRef.current;
    if (!state) return;
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }
    try {
      if (state.target.hasPointerCapture(pointerId)) {
        state.target.releasePointerCapture(pointerId);
      }
    } catch {
      // pointer may already be released; harmless.
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    dragStateRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        return;
      }
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      const startHeight = clamp(measureRenderedHeight() ?? height ?? minHeight);
      dragStateRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight,
        pending: startHeight,
        rafId: null,
        target,
      };
    },
    [clamp, height, measureRenderedHeight, minHeight],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      event.preventDefault();
      // The handle is on the top edge, so moving the pointer up grows the panel.
      state.pending = clamp(state.startHeight + (state.startY - event.clientY));
      if (state.rafId !== null) return;
      state.rafId = requestAnimationFrame(() => {
        const active = dragStateRef.current;
        if (!active) return;
        active.rafId = null;
        setHeight(active.pending);
      });
    },
    [clamp],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const finalHeight = clamp(state.pending);
      releasePointer(event.pointerId);
      // Commit once at drag-end to avoid 60Hz localStorage writes.
      try {
        setLocalStorageItem(storageKey, finalHeight, HeightSchema);
      } catch (error) {
        console.error("Could not persist panel height.", error);
      }
      setHeight(finalHeight);
    },
    [clamp, releasePointer, storageKey],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      // Don't persist a cancelled drag; revert to the start height.
      releasePointer(event.pointerId);
      setHeight(state.startHeight);
    },
    [releasePointer],
  );

  const onDoubleClick = useCallback(() => {
    try {
      removeLocalStorageItem(storageKey);
    } catch (error) {
      console.error("Could not clear persisted panel height.", error);
    }
    setHeight(null);
  }, [storageKey]);

  return {
    height,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick },
  };
}
