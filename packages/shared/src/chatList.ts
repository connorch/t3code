export const CHAT_LIST_ANCHOR_OFFSET = 16;

export interface ChatListAnchoredEndSpace {
  readonly anchorIndex: number;
  readonly anchorOffset: number;
}

export interface ChatListAnchorOptions {
  readonly anchorOffset?: number;
}

/**
 * Locates the row a chat list should hold near the top of the viewport while
 * its turn streams in below. Callers decide which sent message (if any) gets
 * anchored; this only maps that id to the LegendList `anchoredEndSpace` config.
 */
export function resolveChatListAnchoredEndSpace<Item, AnchorId>(
  items: ReadonlyArray<Item>,
  anchorId: AnchorId | null,
  getAnchorId: (item: Item) => AnchorId | null,
  options: ChatListAnchorOptions = {},
): ChatListAnchoredEndSpace | undefined {
  if (anchorId === null) {
    return undefined;
  }

  const anchorIndex = items.findIndex((item) => getAnchorId(item) === anchorId);
  return anchorIndex === -1
    ? undefined
    : { anchorIndex, anchorOffset: options.anchorOffset ?? CHAT_LIST_ANCHOR_OFFSET };
}
