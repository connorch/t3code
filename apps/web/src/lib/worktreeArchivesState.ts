import type { EnvironmentId } from "@t3tools/contracts";

import { vcsEnvironment } from "../state/vcs";
import { appAtomRegistry } from "../rpc/atomRegistry";

export function worktreeArchivesAtom(environmentId: EnvironmentId) {
  return vcsEnvironment.worktreeArchives({ environmentId, input: {} });
}

export function refreshWorktreeArchivesForEnvironment(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(worktreeArchivesAtom(environmentId));
}
