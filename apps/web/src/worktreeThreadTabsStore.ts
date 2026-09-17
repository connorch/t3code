import { arrayMove } from "@dnd-kit/sortable";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface WorktreeThreadTabsState {
  orderByCheckout: Record<string, string[]>;
  move: (checkoutKey: string, visibleIds: string[], activeId: string, overId: string) => void;
}

export const useWorktreeThreadTabsStore = create<WorktreeThreadTabsState>()(
  persist(
    (set) => ({
      orderByCheckout: {},
      move: (checkoutKey, visibleIds, activeId, overId) => {
        const from = visibleIds.indexOf(activeId);
        const to = visibleIds.indexOf(overId);
        if (from < 0 || to < 0 || from === to) return;
        set((state) => ({
          orderByCheckout: {
            ...state.orderByCheckout,
            [checkoutKey]: arrayMove(visibleIds, from, to),
          },
        }));
      },
    }),
    {
      name: "t3code:worktree-thread-tabs:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ orderByCheckout: state.orderByCheckout }),
    },
  ),
);
