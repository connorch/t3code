/**
 * Matches URLs against the Beta "open matching links in the integrated
 * browser" setting (`openLinksInPreviewPattern`). The pattern is a
 * user-supplied RegExp source; an empty or invalid pattern matches nothing.
 * The compiled RegExp is cached per pattern since every link click consults
 * this.
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
