export interface ThreadWorkGroupScrollPosition {
  readonly rowId: string;
  readonly offsetWithinRow: number;
  readonly scrollOffset: number;
}

export function resolveThreadWorkGroupInitialScroll(
  rows: ReadonlyArray<{ readonly id: string }>,
  position: ThreadWorkGroupScrollPosition | undefined,
) {
  const index = position ? rows.findIndex((row) => row.id === position.rowId) : -1;
  return index >= 0 && position ? { index, viewOffset: -position.offsetWithinRow } : undefined;
}

/**
 * Which sent message the feed should hold near the top while its turn streams.
 * Every direct send re-anchors to itself so the reply reads downward from it.
 * A message that queues behind others, or waits offline for delivery, is not
 * the live turn, so it leaves the current framing alone.
 */
export function resolveThreadFeedSubmissionAnchor<AnchorId>(input: {
  readonly currentAnchorMessageId: AnchorId | null;
  readonly submittedMessageId: AnchorId;
  readonly queuedMessageCount: number;
  readonly deliveryDeferred: boolean;
}): AnchorId | null {
  return input.deliveryDeferred || input.queuedMessageCount > 0
    ? input.currentAnchorMessageId
    : input.submittedMessageId;
}
