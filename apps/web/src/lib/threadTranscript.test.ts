import { describe, expect, it } from "vite-plus/test";

import { buildThreadTranscriptBlock } from "./threadTranscript";

const block = buildThreadTranscriptBlock({
  title: "Fix login flow",
  branch: "connorch/fix-login",
  messages: [
    { role: "user", text: "The login button 404s." },
    { role: "assistant", text: "Found it - the route moved. Fixing now." },
    { role: "assistant", text: "   " },
  ],
});

describe("thread transcripts", () => {
  it("serializes title, branch, and non-empty messages", () => {
    expect(block.startsWith("<thread_transcript>\n")).toBe(true);
    expect(block.endsWith("\n</thread_transcript>")).toBe(true);
    expect(block).toContain("Thread: Fix login flow");
    expect(block).toContain("Branch: connorch/fix-login");
    expect(block).toContain("Messages: 2");
    expect(block).toContain("## User\nThe login button 404s.");
    expect(block).toContain("## Assistant\nFound it - the route moved. Fixing now.");
  });

  it("strips send-time context blocks from user messages", () => {
    const sentUserText = [
      "Make the cards pop",
      "",
      "<preview_annotation>",
      "Preview annotation:",
      "Id: annotation_1",
      "Page: Example",
      "</preview_annotation>",
    ].join("\n");
    const result = buildThreadTranscriptBlock({
      title: "Design pass",
      branch: null,
      messages: [{ role: "user", text: sentUserText }],
    });
    expect(result).toContain("## User\nMake the cards pop");
    expect(result).not.toContain("preview_annotation");
    expect(result).not.toContain("Branch:");
  });

  it("neutralizes nested transcript tags so the outer block stays one block", () => {
    const nested = buildThreadTranscriptBlock({
      title: "Outer",
      branch: null,
      messages: [{ role: "assistant", text: `Quoting:\n${block}` }],
    });
    expect(nested.match(/<thread_transcript>/g)).toHaveLength(1);
    expect(nested.match(/<\/thread_transcript>/g)).toHaveLength(1);
    expect(nested).toContain("&lt;thread_transcript&gt;");
  });
});
