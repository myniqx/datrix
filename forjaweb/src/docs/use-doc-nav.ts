import type { ComponentType } from "react";
import type { TocItem } from "@/lib/remark-toc-export";

export interface DocFrontmatter {
	title: string;
	description?: string;
	order?: number;
}

export interface DocModule {
	frontmatter: DocFrontmatter;
	toc: TocItem[];
	default: ComponentType<{ components?: Record<string, ComponentType> }>;
}

export interface DocNavItem {
	title: string;
	slug: string;
}

export interface DocNavSection {
	title: string;
	slug: string | null; // null = no index page for this section
	order: number;
	items: DocNavItem[];
}

// Resolved at build time by Vite
const modules = import.meta.glob<DocModule>("/src/docs/**/*.mdx", {
	eager: true,
});

function isPartial(path: string): boolean {
	return path.includes("/_partials/");
}

function pathToSlug(path: string): string {
	// /src/docs/adapters/postgres.mdx → adapters/postgres
	// /src/docs/getting-started.mdx  → getting-started
	return path.replace("/src/docs/", "").replace(/\.mdx$/, "");
}

function getSegments(path: string): { folder: string | null; file: string } {
	const slug = pathToSlug(path);
	const parts = slug.split("/");
	if (parts.length === 1) return { folder: null, file: parts[0] };
	return { folder: parts[0], file: parts[1] };
}

export function buildDocNav(): DocNavSection[] {
	// section key → section data
	const sectionMap = new Map<string, DocNavSection>();

	// Root-level files get their own implicit section (no folder)
	const ROOT_SECTION_KEY = "__root__";

	for (const [path, mod] of Object.entries(modules)) {
		if (isPartial(path)) continue;

		const { frontmatter } = mod;
		const slug = pathToSlug(path);
		const { folder, file } = getSegments(path);

		if (folder === null) {
			// Root-level file → goes into root section as its own entry
			const existing = sectionMap.get(ROOT_SECTION_KEY);
			const item: DocNavItem = { title: frontmatter.title, slug };
			if (existing) {
				existing.items.push(item);
			} else {
				sectionMap.set(ROOT_SECTION_KEY, {
					title: "",
					slug: null,
					order: 0,
					items: [item],
				});
			}
		} else if (file === "index") {
			// Folder index → becomes the section header (tıklanabilir)
			// Use folder name as slug so URL is /docs/adapters not /docs/adapters/index
			const existing = sectionMap.get(folder);
			if (existing) {
				existing.title = frontmatter.title;
				existing.slug = folder;
				existing.order = frontmatter.order ?? 99;
			} else {
				sectionMap.set(folder, {
					title: frontmatter.title,
					slug: folder,
					order: frontmatter.order ?? 99,
					items: [],
				});
			}
		} else {
			// Folder child → goes under that folder's section
			const existing = sectionMap.get(folder);
			const item: DocNavItem = { title: frontmatter.title, slug };
			if (existing) {
				existing.items.push(item);
			} else {
				// index.mdx henüz işlenmemiş olabilir, placeholder oluştur
				sectionMap.set(folder, {
					title: folder,
					slug: null,
					order: 99,
					items: [item],
				});
			}
		}
	}

	// Sort items within each section by order
	for (const section of sectionMap.values()) {
		section.items.sort((a, b) => {
			const aOrder =
				modules[`/src/docs/${a.slug}.mdx`]?.frontmatter.order ?? 99;
			const bOrder =
				modules[`/src/docs/${b.slug}.mdx`]?.frontmatter.order ?? 99;
			return aOrder - bOrder;
		});
	}

	// Root section first, then folders sorted by order
	const rootSection = sectionMap.get(ROOT_SECTION_KEY);
	const folderSections = Array.from(sectionMap.entries())
		.filter(([key]) => key !== ROOT_SECTION_KEY)
		.map(([, section]) => section)
		.sort((a, b) => a.order - b.order);

	return rootSection ? [rootSection, ...folderSections] : folderSections;
}

export function getDocModule(slug: string): DocModule | undefined {
	return modules[`/src/docs/${slug}.mdx`];
}
