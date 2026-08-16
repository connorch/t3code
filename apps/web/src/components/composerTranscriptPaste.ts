import {
  $createLineBreakNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  PASTE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import {
  extractPastedThreadTranscripts,
  type ThreadTranscriptDraft,
} from "../lib/threadTranscript";

/**
 * Intercepts text pastes containing `<thread_transcript>` blocks so they
 * become composer cards instead of raw prompt text. Registered above the
 * inline-token paste handler (CRITICAL vs HIGH): a transcript's body can
 * contain mention-shaped tokens that must not be re-tokenized.
 *
 * Runs as a PASTE_COMMAND listener, not a React onPaste prop - Lexical's
 * native paste handling fires first, so a React-level preventDefault would
 * be too late to stop the raw text from landing in the editor.
 */
export function registerComposerTranscriptPaste(
  editor: LexicalEditor,
  onTranscriptsPasted: (transcripts: ThreadTranscriptDraft[]) => void,
): () => void {
  return editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!(event instanceof ClipboardEvent) || event.clipboardData === null) {
        return false;
      }
      if (event.clipboardData.files.length > 0) {
        return false;
      }
      const text = event.clipboardData.getData("text/plain");
      if (text.length === 0) {
        return false;
      }
      const { remainingText, transcripts } = extractPastedThreadTranscripts(text);
      if (transcripts.length === 0) {
        return false;
      }
      onTranscriptsPasted(transcripts);
      const selection = $getSelection();
      if ($isRangeSelection(selection) && remainingText.length > 0) {
        const nodes: LexicalNode[] = [];
        const lines = remainingText.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (line.length > 0) {
            nodes.push($createTextNode(line));
          }
          if (index < lines.length - 1) {
            nodes.push($createLineBreakNode());
          }
        }
        selection.insertNodes(nodes);
      }
      event.preventDefault();
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );
}
