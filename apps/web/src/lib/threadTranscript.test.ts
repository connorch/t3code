import { describe, expect, it } from "vite-plus/test";

import {
  appendThreadTranscriptPrompt,
  buildThreadTranscriptBlock,
  extractPastedThreadTranscripts,
  extractTrailingThreadTranscript,
} from "./threadTranscript";

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

  it("neutralizes nested transcript tags so the outer block survives a round trip", () => {
    const nested = buildThreadTranscriptBlock({
      title: "Outer",
      branch: null,
      messages: [{ role: "assistant", text: `Quoting:\n${block}` }],
    });
    const extracted = extractPastedThreadTranscripts(nested);
    expect(extracted.transcripts).toHaveLength(1);
    expect(extracted.transcripts[0]?.title).toBe("Outer");
    expect(extracted.remainingText).toBe("");
  });

  it("extracts pasted blocks and preserves surrounding text", () => {
    const pasted = `Continue where this left off:\n\n${block}\n\nThanks!`;
    const extracted = extractPastedThreadTranscripts(pasted);
    expect(extracted.transcripts).toHaveLength(1);
    expect(extracted.transcripts[0]?.title).toBe("Fix login flow");
    expect(extracted.transcripts[0]?.messageCount).toBe(2);
    expect(extracted.transcripts[0]?.block).toBe(block);
    expect(extracted.remainingText).toBe("Continue where this left off:\n\nThanks!");
  });

  it("passes plain text through untouched", () => {
    const extracted = extractPastedThreadTranscripts("just some pasted text");
    expect(extracted.transcripts).toHaveLength(0);
    expect(extracted.remainingText).toBe("just some pasted text");
  });

  it("appends to the prompt and extracts back out for display", () => {
    const drafts = extractPastedThreadTranscripts(block).transcripts;
    const sent = appendThreadTranscriptPrompt("Pick this up", drafts[0]!);
    expect(sent.startsWith("Pick this up\n\n<thread_transcript>")).toBe(true);
    const extracted = extractTrailingThreadTranscript(sent);
    expect(extracted.promptText).toBe("Pick this up");
    expect(extracted.transcript?.title).toBe("Fix login flow");
    expect(extracted.transcript?.messageCount).toBe(2);
  });
});
