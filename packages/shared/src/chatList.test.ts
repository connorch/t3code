import { describe, expect, it } from "vite-plus/test";

import { CHAT_LIST_ANCHOR_OFFSET, resolveChatListAnchoredEndSpace } from "./chatList.js";

interface Row {
  readonly id: string;
  readonly anchorable: boolean;
}

const rows: ReadonlyArray<Row> = [
  { id: "first", anchorable: true },
  { id: "ignored", anchorable: false },
  { id: "latest", anchorable: true },
];

const getAnchorId = (row: Row) => (row.anchorable ? row.id : null);

describe("resolveChatListAnchoredEndSpace", () => {
  it("anchors a later eligible row for follow-up sends", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "latest", getAnchorId)).toEqual({
      anchorIndex: 2,
      anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
    });
  });

  it("ignores ineligible rows and missing anchors", () => {
    expect(resolveChatListAnchoredEndSpace(rows, "ignored", getAnchorId)).toBeUndefined();
    expect(resolveChatListAnchoredEndSpace(rows, "missing", getAnchorId)).toBeUndefined();
    expect(resolveChatListAnchoredEndSpace(rows, null, getAnchorId)).toBeUndefined();
  });
});
