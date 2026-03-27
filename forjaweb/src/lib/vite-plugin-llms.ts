import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const SITE_URL = "https://tryforja.com";
const DOCS_DIR = path.resolve(__dirname, "../docs");

function parseFrontmatter(content: string): {
	title: string;
	description?: string;
	order: number;
	body: string;
} {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) return { title: "Untitled", order: 99, body: content };

	const meta = match[1]!;
	const body = match[2]!;

	const titleMatch = meta.match(/^title:\s*(.+)$/m);
	const descMatch = meta.match(/^description:\s*(.+)$/m);
	const orderMatch = meta.match(/^order:\s*(\d+)$/m);

	return {
		title: titleMatch?.[1]?.trim() ?? "Untitled",
		description: descMatch?.[1]?.trim(),
		order: orderMatch ? parseInt(orderMatch[1]!) : (99 as number),
		body,
	};
}

function stripMdxJsx(body: string): string {
	// Remove import lines
	const noImports = body.replace(/^import\s+.*$/gm, "");
	// Remove JSX component tags (self-closing and block)
	const noJsx = noImports
		.replace(/<[A-Z][A-Za-z]*[^>]*\/>/g, "")
		.replace(/<[A-Z][A-Za-z]*[^>]*>[\s\S]*?<\/[A-Z][A-Za-z]*>/g, "");
	// Collapse multiple blank lines
	return noJsx.replace(/\n{3,}/g, "\n\n").trim();
}

function pathToSlug(filePath: string): string {
	const rel = path.relative(DOCS_DIR, filePath);
	return rel.replace(/\.mdx$/, "").replace(/\\/g, "/");
}

function collectDocs(): Array<{
	slug: string;
	title: string;
	description?: string;
	order: number;
	folder: string | null;
	markdown: string;
}> {
	const results: ReturnType<typeof collectDocs> = [];

	function walk(dir: string): void {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				walk(path.join(dir, entry.name));
			} else if (entry.name.endsWith(".mdx") && !dir.includes("_partials")) {
				const filePath = path.join(dir, entry.name);
				const content = fs.readFileSync(filePath, "utf-8");
				const { title, description, order, body } = parseFrontmatter(content);
				const slug = pathToSlug(filePath);
				const parts = slug.split("/");
				const folder = parts.length > 1 ? parts[0]! : null;

				results.push({
					slug,
					title,
					description,
					order,
					folder,
					markdown: stripMdxJsx(body),
				});
			}
		}
	}

	walk(DOCS_DIR);
	return results;
}

function buildLlmsTxt(
	docs: ReturnType<typeof collectDocs>,
	siteUrl: string,
): string {
	// Group by folder
	const folderMap = new Map<string, typeof docs>();

	for (const doc of docs) {
		const key = doc.folder ?? "__root__";
		const existing = folderMap.get(key) ?? [];
		existing.push(doc);
		folderMap.set(key, existing);
	}

	const lines: string[] = [
		"# Forja",
		"",
		"> TypeScript-first database management framework. Integrate REST API query capabilities into your existing project.",
		"",
		`> Full docs: ${siteUrl}/docs`,
		"",
	];

	// Sort folders: root first, then alphabetical
	const sortedFolders = Array.from(folderMap.entries()).sort(([a], [b]) => {
		if (a === "__root__") return -1;
		if (b === "__root__") return 1;
		return a.localeCompare(b);
	});

	for (const [folder, folderDocs] of sortedFolders) {
		const sorted = folderDocs.sort((a, b) => a.order - b.order);

		if (folder !== "__root__") {
			const folderTitle =
				folder.charAt(0).toUpperCase() + folder.slice(1).replace(/-/g, " ");
			lines.push(`## ${folderTitle}`);
			lines.push("");
		}

		for (const doc of sorted) {
			const urlSlug = doc.slug.endsWith("/index")
				? doc.slug.slice(0, -6)
				: doc.slug;
			const url = `${siteUrl}/docs/${urlSlug}`;
			const desc = doc.description ? `: ${doc.description}` : "";
			lines.push(`- [${doc.title}](${url})${desc}`);
		}

		lines.push("");
	}

	return lines.join("\n").trimEnd() + "\n";
}

function buildLlmsFullMd(docs: ReturnType<typeof collectDocs>): string {
	const sorted = [...docs].sort((a, b) => {
		const folderCmp = (a.folder ?? "").localeCompare(b.folder ?? "");
		if (folderCmp !== 0) return folderCmp;
		return a.order - b.order;
	});

	const sections: string[] = [
		"# Forja — Full Documentation",
		"",
		"> TypeScript-first database management framework.",
		"",
	];

	for (const doc of sorted) {
		sections.push(`---`);
		sections.push("");
		sections.push(`## ${doc.title}`);
		if (doc.description) sections.push(`> ${doc.description}`);
		sections.push("");
		sections.push(doc.markdown);
		sections.push("");
	}

	return sections.join("\n").trimEnd() + "\n";
}

const VIRTUAL_ID = "virtual:doc-raws";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

export function llmsPlugin(options?: {
	markdownOverrides?: Record<string, string>;
}): Plugin {
	const overrides = options?.markdownOverrides ?? {};

	return {
		name: "vite-plugin-llms",
		resolveId(id) {
			if (id === VIRTUAL_ID) return RESOLVED_ID;
		},
		load(id) {
			if (id !== RESOLVED_ID) return;
			const docs = collectDocs();
			const merged = docs.map((d) => ({
				...d,
				markdown: overrides[d.slug] ?? d.markdown,
			}));
			const entries = merged
				.map(
					(d) => `  ${JSON.stringify(d.slug)}: ${JSON.stringify(d.markdown)}`,
				)
				.join(",\n");
			return `export const DOC_RAWS = {\n${entries}\n};\n`;
		},
		closeBundle() {
			const docs = collectDocs().map((d) => ({
				...d,
				markdown: overrides[d.slug] ?? d.markdown,
			}));
			const outDir = path.resolve(__dirname, "../../dist");

			fs.mkdirSync(outDir, { recursive: true });

			const llmsTxt = buildLlmsTxt(docs, SITE_URL);
			fs.writeFileSync(path.join(outDir, "llms.txt"), llmsTxt, "utf-8");

			const llmsFull = buildLlmsFullMd(docs);
			fs.writeFileSync(path.join(outDir, "llms-full.md"), llmsFull, "utf-8");

			console.log(
				`[llms] Generated llms.txt (${docs.length} pages) and llms-full.md`,
			);
		},
	};
}
