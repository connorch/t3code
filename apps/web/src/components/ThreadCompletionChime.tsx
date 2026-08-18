import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect, useRef } from "react";

import { useClientSettings } from "../hooks/useSettings";
import type { AudibleThreadCompletionChime } from "../lib/threadCompletionChimes";
import { playThreadCompletionChime } from "../lib/threadCompletionChimes";
import { useThreadShells } from "../state/entities";
import {
  parseCompletedAtMs,
  scanThreadCompletions,
  type ThreadCompletionSnapshot,
} from "./ThreadCompletionChime.logic";

/**
 * Plays the user's chosen chime whenever any thread finishes a turn.
 *
 * Mounted once at the root. The setting is device-local, so a machine that is
 * paired to several environments chimes for all of them, and a phone or second
 * tab stays silent unless it opts in separately.
 */
export function ThreadCompletionChime() {
  const chime = useClientSettings((settings) => settings.threadCompletionChime);

  // Watching every shell means re-rendering on every shell update, so the
  // watcher only mounts once a chime is chosen. Default-off users pay nothing.
  return chime === "none" ? null : <ThreadCompletionChimeWatcher chime={chime} />;
}

function ThreadCompletionChimeWatcher({ chime }: { chime: AudibleThreadCompletionChime }) {
  const threads = useThreadShells();
  const snapshotRef = useRef<ThreadCompletionSnapshot | null>(null);

  useEffect(() => {
    const { snapshot, completed } = scanThreadCompletions(
      snapshotRef.current,
      threads.map((thread) => ({
        key: scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }),
        completedAtMs: parseCompletedAtMs(thread.latestTurn?.completedAt),
      })),
    );
    snapshotRef.current = snapshot;

    // One chime per scan: five threads finishing together is one event to the
    // ear, not five overlapping pops.
    if (completed) {
      playThreadCompletionChime(chime);
    }
  }, [chime, threads]);

  return null;
}
