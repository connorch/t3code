import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { upgradeLegacyContextMessage } from "@t3tools/shared/composerContextLegacy";
import { replaceComposerContextReferences } from "@t3tools/shared/composerContextReferences";

/**
 * "Copy transcript" puts a `<thread_transcript>` block on the clipboard so a
 * thread's conversation can be handed to tools outside T3 Code. Inside the
 * app, reference another thread with an `@` chip instead.
 */

const THREAD_TRANSCRIPT_OPEN = "<thread_transcript>";
const THREAD_TRANSCRIPT_CLOSE = "</thread_transcript>";

const TRAILING_THREAD_TRANSCRIPT_BLOCK_PATTERN =
  /\n*<thread_transcript>\n([\s\S]*?)\n<\/thread_transcript>\s*$/;

export interface TranscriptSourceMessage {
  role: "user" | "assistant" | "system" | "reasoning";
  text: string;
}

/**
 * The settled user and assistant messages of a thread's visible turn items,
 * in order. Tool activity, reasoning, and still-streaming text are left out.
 */
export function transcriptMessagesFromTurnItems(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): TranscriptSourceMessage[] {
  return items.flatMap(({ item }): TranscriptSourceMessage[] => {
    if (item.type === "user_message") {
      return item.text.trim().length > 0 ? [{ role: "user", text: item.text }] : [];
    }
    if (item.type === "assistant_message" && !item.streaming && item.text.trim().length > 0) {
      return [{ role: "assistant", text: item.text }];
    }
    return [];
  });
}

// Reasoning messages are thinking traces, not conversation; they have no
// heading and are dropped from the transcript.
const ROLE_HEADINGS: Partial<Record<TranscriptSourceMessage["role"], string>> = {
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
 * Normalize legacy appendices, then remove context references and nested
 * transcripts so the copy carries the user's prose.
 */
function cleanUserMessageText(text: string): string {
  let visibleText = replaceComposerContextReferences(
    upgradeLegacyContextMessage(text).text,
    () => "",
  ).trim();
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
    const heading = ROLE_HEADINGS[message.role];
    if (heading === undefined) return [];
    const text = message.role === "user" ? cleanUserMessageText(message.text) : message.text.trim();
    if (text.trim().length === 0) return [];
    return [`${heading}\n${escapeTranscriptTags(text.trim())}`];
  });
  const header = [
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
