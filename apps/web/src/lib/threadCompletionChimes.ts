/**
 * The selectable completion chimes and the one-shot player behind them.
 *
 * Settings renders the catalog (and previews a chime the moment it is picked);
 * `ThreadCompletionChime` plays one when a turn finishes. Both go through
 * `playThreadCompletionChime`, so a preview sounds exactly like the real thing.
 */
import type { ThreadCompletionChime } from "@t3tools/contracts/settings";

import bubbleChimeUrl from "../assets/sounds/bubble.mp3";
import popChimeUrl from "../assets/sounds/pop.mp3";

export type AudibleThreadCompletionChime = Exclude<ThreadCompletionChime, "none">;

export interface ThreadCompletionChimeOption {
  readonly id: ThreadCompletionChime;
  readonly label: string;
}

const CHIME_URLS = {
  bubble: bubbleChimeUrl,
  pop: popChimeUrl,
} as const satisfies Record<AudibleThreadCompletionChime, string>;

/** Dropdown order in Settings → General. "None" leads because it is the default. */
export const THREAD_COMPLETION_CHIME_OPTIONS = [
  { id: "none", label: "None" },
  { id: "bubble", label: "Bubble" },
  { id: "pop", label: "Pop" },
] as const satisfies ReadonlyArray<ThreadCompletionChimeOption>;

const CHIME_LABELS = Object.fromEntries(
  THREAD_COMPLETION_CHIME_OPTIONS.map((option) => [option.id, option.label]),
) as Record<ThreadCompletionChime, string>;

export function threadCompletionChimeLabel(chime: ThreadCompletionChime): string {
  return CHIME_LABELS[chime];
}

// One element per chime, reused across plays. Rebuilding an `Audio` per turn
// would leak decoders on a machine that finishes turns all day.
const audioByChime = new Map<AudibleThreadCompletionChime, HTMLAudioElement>();

function chimeAudio(chime: AudibleThreadCompletionChime): HTMLAudioElement {
  const existing = audioByChime.get(chime);
  if (existing) return existing;
  const audio = new Audio(CHIME_URLS[chime]);
  audio.preload = "auto";
  audioByChime.set(chime, audio);
  return audio;
}

/**
 * Plays a chime, or does nothing for "none". Browsers reject playback until the
 * page has seen a user gesture, so failures are swallowed: a missed chime must
 * never surface as an error in a thread the user is watching.
 */
export function playThreadCompletionChime(chime: ThreadCompletionChime): void {
  if (chime === "none" || typeof Audio === "undefined") return;
  const audio = chimeAudio(chime);
  audio.currentTime = 0;
  void audio.play().catch(() => {});
}
