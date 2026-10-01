import type { ScopedThreadRef } from "@t3tools/contracts";
import { useThreadShell } from "~/state/entities";
import { DiscoveryListRow } from "../ui/discovery-list";

import { PreviewFaviconIcon } from "./PreviewFaviconIcon";
import type { PreviewableServer } from "./useDiscoveredLocalServers";

interface Props {
  threadRef: ScopedThreadRef;
  server: PreviewableServer;
  onOpen: () => void;
}

/**
 * A live local server row. The title is the address a click opens, so a
 * remote client sees the environment host rather than localhost. The
 * description names the thread whose terminal started the server.
 */
export function PreviewLocalServerCard({ threadRef, server, onOpen }: Props) {
  const ownerThread = useThreadShell(
    server.terminal
      ? { environmentId: threadRef.environmentId, threadId: server.terminal.threadId }
      : null,
  );
  return (
    <DiscoveryListRow
      onClick={onOpen}
      icon={<PreviewFaviconIcon threadRef={threadRef} url={server.requestedUrl} />}
      title={describeAddress(server)}
      description={ownerThread?.title ?? server.processName ?? "Listening"}
    />
  );
}

function describeAddress(server: PreviewableServer): string {
  try {
    return new URL(server.url).host;
  } catch {
    return `${server.host}:${server.port}`;
  }
}
