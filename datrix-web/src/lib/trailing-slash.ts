/**
 * Cloudflare Pages serves prerendered pages as `<path>/index.html` and
 * 308-redirects `/docs/x` → `/docs/x/`. Internal links and canonical URLs
 * must use the trailing-slash form so crawlers never hit a redirect.
 *
 * Only touches site-internal paths (starting with "/"); leaves hash/query
 * suffixes intact and skips paths that look like files (have an extension).
 */
export function withTrailingSlash(href: string): string {
	if (!href.startsWith("/") || href.startsWith("//")) return href;

	const match = href.match(/^([^?#]*)(.*)$/);
	const path = match?.[1] ?? href;
	const suffix = match?.[2] ?? "";

	if (path.endsWith("/")) return href;
	const last = path.slice(path.lastIndexOf("/") + 1);
	if (last.includes(".")) return href;

	return `${path}/${suffix}`;
}
