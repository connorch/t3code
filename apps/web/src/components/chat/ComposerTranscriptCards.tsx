import { MessagesSquare, X } from "lucide-react";

import type { ThreadTranscriptDraft } from "~/lib/threadTranscript";
import { cn } from "~/lib/utils";

interface ComposerTranscriptCardsProps {
  transcripts: ReadonlyArray<ThreadTranscriptDraft>;
  onRemove: (transcriptId: string) => void;
  className?: string;
}

/** Pasted thread transcripts pending send, shown as removable cards. */
export function ComposerTranscriptCards({
  transcripts,
  onRemove,
  className,
}: ComposerTranscriptCardsProps) {
  if (transcripts.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {transcripts.map((transcript) => (
        <section
          key={transcript.id}
          className="relative flex min-w-0 max-w-full items-center overflow-hidden rounded-lg border border-border/80 bg-background/72"
        >
          <span className="grid size-10 shrink-0 place-items-center border-r border-border/70 text-message-action">
            <MessagesSquare className="size-3.5" />
          </span>
          <div className="min-w-0 px-2.5 py-2 pr-8">
            <p className="max-w-80 truncate text-foreground text-xs font-medium">
              {transcript.title}
            </p>
            <p className="mt-1 text-secondary-label text-[10px]">
              Transcript · {transcript.messageCount}{" "}
              {transcript.messageCount === 1 ? "message" : "messages"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Remove transcript"
            className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded text-icon-muted transition hover:bg-muted hover:text-foreground"
            onClick={() => onRemove(transcript.id)}
          >
            <X className="size-3" />
          </button>
        </section>
      ))}
    </div>
  );
}
