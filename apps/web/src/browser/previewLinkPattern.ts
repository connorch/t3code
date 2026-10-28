/**
 * Matches URLs against the user's `openLinksInPreviewPattern` RegExp source; an empty or invalid
 * pattern matches nothing. Cached per pattern because every link click consults it.
 */
let compiled: { readonly pattern: string; readonly regex: RegExp | null } | null = null;

export function urlMatchesPreviewLinkPattern(pattern: string, url: string): boolean {
  const source = pattern.trim();
  if (source.length === 0) return false;
  if (compiled?.pattern !== source) {
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(source);
    } catch {
      regex = null;
    }
    compiled = { pattern: source, regex };
  }
  return compiled.regex?.test(url) ?? false;
}
