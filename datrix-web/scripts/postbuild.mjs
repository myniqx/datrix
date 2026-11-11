// Runs after `react-router build`. Produces the files Cloudflare Pages needs
// for correct crawling:
//   - 404.html  → real 404 status for unknown URLs (no soft-404 fallback)
//   - sitemap.xml → every prerendered page, trailing-slash form
import fs from "node:fs";
import path from "node:path";

const SITE_URL = "https://datrix.dev";
const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "build/client");
const DOCS_DIR = path.join(ROOT, "src/docs");

function getDocSlugs(dir, base = "") {
	const slugs = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith("_")) continue;
		if (entry.isDirectory()) {
			slugs.push(...getDocSlugs(path.join(dir, entry.name), `${base}${entry.name}/`));
		} else if (entry.name.endsWith(".mdx")) {
			slugs.push(`${base}${entry.name.replace(/\.mdx$/, "")}`);
		}
	}
	return slugs;
}

function write404() {
	const prerendered = path.join(OUT_DIR, "404/index.html");
	if (!fs.existsSync(prerendered)) {
		throw new Error(`[postbuild] missing ${prerendered}; is "/404" prerendered?`);
	}
	fs.copyFileSync(prerendered, path.join(OUT_DIR, "404.html"));
	fs.rmSync(path.join(OUT_DIR, "404"), { recursive: true });
	console.log("[postbuild] wrote 404.html");
}

function writeSitemap() {
	const paths = [
		"/",
		"/docs/",
		...getDocSlugs(DOCS_DIR)
			.map((s) => (s.endsWith("/index") ? s.slice(0, -6) : s))
			.map((s) => `/docs/${s}/`),
	];
	const urls = [...new Set(paths)]
		.map((p) => `  <url><loc>${SITE_URL}${p}</loc></url>`)
		.join("\n");
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
	fs.writeFileSync(path.join(OUT_DIR, "sitemap.xml"), xml, "utf-8");
	console.log(`[postbuild] wrote sitemap.xml (${paths.length} urls)`);
}

write404();
writeSitemap();
