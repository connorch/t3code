import { extractTrailingPreviewAnnotation } from "./previewAnnotation";
import { deriveDisplayedUserMessageState } from "./terminalContext";
import { randomUUID } from "./utils";

/**
 * Thread transcripts ride the same inline-text mechanism as preview
 * annotations: "Copy transcript" puts a `<thread_transcript>` block on the
 * clipboard, pasting one into the composer converts it into a draft card,
 * and sending appends the block verbatim to the prompt text. No attachment
 * type or wire schema is involved anywhere.
 */

const THREAD_TRANSCRIPT_OPEN = "<thread_transcript>";
const THREAD_TRANSCRIPT_CLOSE = "</thread_transcript>";

const THREAD_TRANSCRIPT_BLOCK_PATTERN = /<thread_transcript>\n([\s\S]*?)\n<\/thread_transcript>/g;

const TRAILING_THREAD_TRANSCRIPT_BLOCK_PATTERN =
  /\n*<thread_transcript>\n([\s\S]*?)\n<\/thread_transcript>\s*$/;

/** A transcript sitting in the composer as a card, pending send. */
export interface ThreadTranscriptDraft {
  id: string;
  title: string;
  messageCount: number;
  /** The full `<thread_transcript>` block, appended verbatim on send. */
  block: string;
}

/** Card model parsed back out of a sent message for timeline display. */
export interface ParsedThreadTranscript {
  id: string;
  title: string;
  messageCount: number;
}

export interface TranscriptSourceMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

const ROLE_HEADINGS: Record<TranscriptSourceMessage["role"], string> = {
  user: "## User",
  assistant: "## Assistant",
  system: "## System",
};

/**
 * Neutralize transcript tags inside message content so a copied transcript
 * that itself quotes a transcript cannot terminate the outer block early.
 */
function escapeTranscriptTags(text: string): string {
  return text
    .replaceAll(THREAD_TRANSCRIPT_OPEN, "&lt;thread_transcript&gt;")
    .replaceAll(THREAD_TRANSCRIPT_CLOSE, "&lt;/thread_transcript&gt;");
}

/**
 * User messages store their send-time context appendix (terminal contexts,
 * element contexts, preview annotations, transcripts) inline. Strip all of
 * it so the copied transcript carries what the user actually typed.
 */
function cleanUserMessageText(text: string): string {
  let visibleText = deriveDisplayedUserMessageState(text).visibleText;
  while (true) {
    const withoutAnnotation = extractTrailingPreviewAnnotation(visibleText);
    if (withoutAnnotation.annotation === null) break;
    visibleText = withoutAnnotation.promptText;
  }
  while (true) {
    const match = TRAILING_THREAD_TRANSCRIPT_BLOCK_PATTERN.exec(visibleText);
    if (!match) break;
    visibleText = visibleText.slice(0, match.index).replace(/\n+$/, "");
  }
  return visibleText;
}

export function buildThreadTranscriptBlock(source: {
  title: string;
  branch: string | null;
  messages: ReadonlyArray<TranscriptSourceMessage>;
}): string {
  const entries = source.messages.flatMap((message) => {
    const text = message.role === "user" ? cleanUserMessageText(message.text) : message.text.trim();
    if (text.trim().length === 0) return [];
    return [`${ROLE_HEADINGS[message.role]}\n${escapeTranscriptTags(text.trim())}`];
  });
  const header = [
    `Id: ${randomUUID()}`,
    `Thread: ${source.title.trim() || "Untitled thread"}`,
    ...(source.branch ? [`Branch: ${source.branch}`] : []),
    `Messages: ${entries.length}`,
  ];
  return [
    THREAD_TRANSCRIPT_OPEN,
    ...header,
    "",
    entries.join("\n\n"),
    THREAD_TRANSCRIPT_CLOSE,
  ].join("\n");
}

function parseTranscriptBody(body: string, fallbackId: string): ParsedThreadTranscript {
  const lines = body.split("\n");
  const idLine = lines.find((line) => line.startsWith("Id: "));
  const titleLine = lines.find((line) => line.startsWith("Thread: "));
  const countLine = lines.find((line) => line.startsWith("Messages: "));
  const parsedCount = countLine ? Number.parseInt(countLine.slice("Messages: ".length), 10) : NaN;
  return {
    id: idLine?.slice("Id: ".length).trim() || fallbackId,
    title: titleLine?.slice("Thread: ".length).trim() || "Thread transcript",
    messageCount: Number.isFinite(parsedCount) ? parsedCount : 0,
  };
}

export interface ExtractedPastedTranscripts {
  /** The pasted text with every transcript block removed. */
  remainingText: string;
  transcripts: ThreadTranscriptDraft[];
}

/**
 * Pull `<thread_transcript>` blocks out of pasted text so they can become
 * composer cards instead of raw prompt text. Returns the transcripts in
 * document order plus whatever text surrounded them.
 */
export function extractPastedThreadTranscripts(text: string): ExtractedPastedTranscripts {
  if (!text.includes(THREAD_TRANSCRIPT_OPEN)) {
    return { remainingText: text, transcripts: [] };
  }
  const transcripts: ThreadTranscriptDraft[] = [];
  const remainingText = text
    .replace(THREAD_TRANSCRIPT_BLOCK_PATTERN, (block, body: string) => {
      const parsed = parseTranscriptBody(body, randomUUID());
      transcripts.push({
        id: parsed.id,
        title: parsed.title,
        messageCount: parsed.messageCount,
        block,
      });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { remainingText, transcripts };
}

/**
 * Appended innermost - directly after the typed prompt, before terminal and
 * element context blocks - so timeline extraction can unwind the appends in
 * reverse order.
 */
export function appendThreadTranscriptPrompt(
  prompt: string,
  transcript: ThreadTranscriptDraft,
): string {
  const trimmed = prompt.trim();
  return trimmed ? `${trimmed}\n\n${transcript.block}` : transcript.block;
}

export interface ExtractedTrailingThreadTranscript {
  promptText: string;
  transcript: ParsedThreadTranscript | null;
}

/** Timeline-side extraction of a sent message's trailing transcript block. */
export function extractTrailingThreadTranscript(prompt: string): ExtractedTrailingThreadTranscript {
  const match = TRAILING_THREAD_TRANSCRIPT_BLOCK_PATTERN.exec(prompt);
  if (!match) return { promptText: prompt, transcript: null };
  return {
    promptText: prompt.slice(0, match.index).replace(/\n+$/, ""),
    transcript: parseTranscriptBody(match[1] ?? "", `${match.index}`),
  };
}
