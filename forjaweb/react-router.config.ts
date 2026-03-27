import type { Config } from "@react-router/dev/config";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function getDocSlugs(dir: string, base = ""): string[] {
	const slugs: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			slugs.push(
				...getDocSlugs(join(dir, entry.name), `${base}${entry.name}/`),
			);
		} else if (entry.name.endsWith(".mdx") && !entry.name.startsWith("_")) {
			slugs.push(`${base}${entry.name.replace(/\.mdx$/, "")}`);
		}
	}
	return slugs;
}

// Normalize index slugs to their folder URL (core/index → core)
function slugToPath(slug: string): string {
	return slug.endsWith("/index") ? slug.slice(0, -6) : slug;
}

const DOC_SLUGS = getDocSlugs(join(import.meta.dirname, "src/docs"));

export default {
	ssr: false,
	appDirectory: "src",
	prerender: ["/", "/docs", ...DOC_SLUGS.map((s) => `/docs/${slugToPath(s)}`)],
} satisfies Config;
