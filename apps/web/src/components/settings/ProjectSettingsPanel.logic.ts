export function projectGroupTitleNeedsUpdate(
  memberTitles: ReadonlyArray<string>,
  nextTitle: string,
  wasEdited: boolean,
): boolean {
  return wasEdited && memberTitles.some((title) => title !== nextTitle);
}

type ProjectLinks = Readonly<Record<string, string>>;

/**
 * Links two project groups by giving every member of both the same link id.
 * Reuses an existing id from either side so merging into an already linked
 * group extends it instead of splitting it.
 */
export function linkProjectGroups(input: {
  links: ProjectLinks;
  memberKeys: ReadonlyArray<string>;
  targetMemberKeys: ReadonlyArray<string>;
  newLinkId: () => string;
}): Record<string, string> {
  const existingLinkId =
    input.memberKeys.map((key) => input.links[key]).find((id) => id !== undefined) ??
    input.targetMemberKeys.map((key) => input.links[key]).find((id) => id !== undefined);
  const linkId = existingLinkId ?? input.newLinkId();
  const next: Record<string, string> = { ...input.links };
  // Members of a link that is being merged into this one move with it.
  const absorbedIds = new Set<string>();
  for (const key of [...input.memberKeys, ...input.targetMemberKeys]) {
    const previous = next[key];
    if (previous !== undefined && previous !== linkId) absorbedIds.add(previous);
    next[key] = linkId;
  }
  for (const [key, id] of Object.entries(next)) {
    if (absorbedIds.has(id)) next[key] = linkId;
  }
  return next;
}

/**
 * Removes one project from its link. A link left with a single member is
 * dropped entirely so a lone project returns to normal grouping. Returns the
 * same object when nothing changed so callers can skip a settings write.
 */
export function unlinkProject(links: ProjectLinks, memberKey: string): ProjectLinks {
  const linkId = links[memberKey];
  if (linkId === undefined) return links;
  const next: Record<string, string> = {};
  let remaining = 0;
  for (const [key, id] of Object.entries(links)) {
    if (key === memberKey) continue;
    next[key] = id;
    if (id === linkId) remaining += 1;
  }
  if (remaining >= 2) return next;
  return Object.fromEntries(Object.entries(next).filter(([, id]) => id !== linkId));
}
