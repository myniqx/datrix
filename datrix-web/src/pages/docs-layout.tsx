import { useEffect, useRef, useState } from "react";
import { Outlet, Link, useParams } from "react-router";
import { siGithub } from "simple-icons";
import { DocsNavbar } from "@/components/layout/docs-navbar";
import { DocsFooter } from "@/components/layout/docs-footer";
import { buildDocNav, getDocModule } from "@/docs/use-doc-nav";
import { DATRIX_GITHUB_REPO } from "@/data/constants";
import type { TocItem } from "@/lib/remark-toc-export";
import { SidebarList, SidebarListItem } from "@/components/docs/sidebar-list";

const NAV_SECTIONS = buildDocNav();

// --- Slug resolution ---

function resolveSlug(param: string | undefined): string {
	if (!param) {
		for (const section of NAV_SECTIONS) {
			const candidate = section.slug;
			if (candidate) {
				if (getDocModule(candidate)) return candidate;
				if (getDocModule(`${candidate}/index`)) return `${candidate}/index`;
			}
			const firstItem = section.items[0]?.slug;
			if (firstItem && getDocModule(firstItem)) return firstItem;
		}
		return "getting-started/index";
	}
	const directMod = getDocModule(param);
	if (directMod) return param;
	const indexMod = getDocModule(`${param}/index`);
	return indexMod ? `${param}/index` : param;
}

// Flat, reading-order list of every navigable doc page (section index + items),
// resolved to real content slugs (e.g. "adapters/index") via resolveSlug so
// prev/next always points at a slug getDocModule can actually load.
const FLAT_PAGES: { slug: string; title: string }[] = NAV_SECTIONS.flatMap(
	(section) => {
		const pages: { slug: string; title: string }[] = [];
		if (section.slug !== null) {
			const resolved = resolveSlug(section.slug);
			if (getDocModule(resolved)) {
				pages.push({ slug: resolved, title: section.title });
			}
		}
		for (const item of section.items) {
			pages.push({ slug: item.slug, title: item.title });
		}
		return pages;
	},
);

export function useCurrentSlug(): string {
	const { section, page } = useParams();
	const param = section && page ? `${section}/${page}` : section;
	return resolveSlug(param);
}

// --- Sidebar ---

function SidebarLink({
	slug,
	title,
	currentSlug,
	isSection = false,
	hasActiveChild = false,
}: {
	slug: string;
	title: string;
	currentSlug: string;
	isSection?: boolean;
	hasActiveChild?: boolean;
}) {
	const isActive = currentSlug === slug;
	const isHighlighted = isActive || (isSection && hasActiveChild);
	return (
		<Link
			to={`/docs/${slug}`}
			className={`group flex items-center gap-2 rounded-md font-heading transition-colors ${isSection ? "text-sm font-medium py-1.5 px-2" : "text-sm py-1 px-2"
				} ${isHighlighted
					? "text-foreground"
					: "text-foreground/75 hover:text-foreground"
				}`}
		>
			{isActive && !isSection && (
				<span className="w-1 h-1 rounded-full bg-primary shrink-0" />
			)}
			{(!isActive || isSection) && !isSection && (
				<span className="w-1 h-1 rounded-full shrink-0 opacity-0" />
			)}
			{title}
		</Link>
	);
}

function DocsSidebar({ currentSlug }: { currentSlug: string }) {
	return (
		<aside className="hidden md:block w-56 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto pt-8 pr-6">
			{NAV_SECTIONS.map((section) => {
				const isIndexActive =
					section.slug !== null && currentSlug === `${section.slug}/index`;
				const hasActiveChild =
					isIndexActive || section.items.some((i) => i.slug === currentSlug);
				const sectionActive = section.slug === currentSlug || hasActiveChild;

				return (
					<div key={section.title || "__root__"} className="mb-5">
						{section.title &&
							(section.slug ? (
								<SidebarLink
									slug={section.slug}
									title={section.title}
									currentSlug={currentSlug}
									isSection
									hasActiveChild={hasActiveChild}
								/>
							) : (
								<p className="text-[11px] font-semibold uppercase tracking-widest text-foreground/30 mb-1.5 px-2">
									{section.title}
								</p>
							))}
						{section.items.length > 0 && (
							<nav
								className={`flex flex-col border-l mt-0.5 ml-2 pl-2 ${sectionActive ? "border-border/60" : "border-border/25"
									}`}
							>
								{section.items.map((item) => (
									<SidebarLink
										key={item.slug}
										slug={item.slug}
										title={item.title}
										currentSlug={currentSlug}
									/>
								))}
							</nav>
						)}
					</div>
				);
			})}
		</aside>
	);
}

// --- Page footer (edit link + prev/next) ---

function PageNavFooter({ currentSlug }: { currentSlug: string }) {
	const index = FLAT_PAGES.findIndex((p) => p.slug === currentSlug);
	const prev = index > 0 ? FLAT_PAGES[index - 1] : null;
	const next =
		index >= 0 && index < FLAT_PAGES.length - 1 ? FLAT_PAGES[index + 1] : null;
	const editUrl = `https://github.com/${DATRIX_GITHUB_REPO}/edit/main/datrix-web/src/docs/${currentSlug}.mdx`;

	return (
		<div className="mt-16 border-t border-border/40 pt-6">
			<a
				href={editUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1.5 text-sm text-foreground/50 transition-colors hover:text-foreground"
			>
				<svg role="img" viewBox="0 0 24 24" className="size-3.5 fill-current">
					<path d={siGithub.path} />
				</svg>
				Edit this page on GitHub
			</a>

			{(prev || next) && (
				<nav className="mt-6 flex items-stretch justify-between gap-4">
					{prev ? (
						<Link
							to={`/docs/${prev.slug}`}
							className="group flex flex-1 flex-col gap-1 rounded-lg border border-border/50 px-4 py-3 transition-colors hover:border-border hover:bg-muted/40"
						>
							<span className="text-xs text-foreground/40">← Previous</span>
							<span className="text-sm font-medium text-foreground/80 group-hover:text-foreground">
								{prev.title}
							</span>
						</Link>
					) : (
						<div className="flex-1" />
					)}
					{next ? (
						<Link
							to={`/docs/${next.slug}`}
							className="group flex flex-1 flex-col items-end gap-1 rounded-lg border border-border/50 px-4 py-3 text-right transition-colors hover:border-border hover:bg-muted/40"
						>
							<span className="text-xs text-foreground/40">Next →</span>
							<span className="text-sm font-medium text-foreground/80 group-hover:text-foreground">
								{next.title}
							</span>
						</Link>
					) : (
						<div className="flex-1" />
					)}
				</nav>
			)}
		</div>
	);
}

// --- TOC ---

function DocsToc({ items }: { items: TocItem[] }) {
	const [activeId, setActiveId] = useState<string>("");
	const observerRef = useRef<IntersectionObserver | null>(null);

	useEffect(() => {
		if (observerRef.current) observerRef.current.disconnect();

		const headings = document.querySelectorAll<HTMLElement>(
			"article h1, article h2, article h3",
		);

		observerRef.current = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveId(entry.target.id);
						break;
					}
				}
			},
			{ rootMargin: "0px 0px -70% 0px", threshold: 0 },
		);

		headings.forEach((el) => observerRef.current!.observe(el));

		return () => observerRef.current?.disconnect();
	}, [items]);

	const visible = items.filter((item) => item.depth === 2 || item.depth === 3);

	return (
		<aside className="hidden xl:block w-52 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto pt-8 pl-6">
			{visible.length > 0 && (
				<SidebarList label="On this page">
					{visible.map((item) => (
						<SidebarListItem
							key={item.id}
							href={`#${item.id}`}
							active={activeId === item.id}
							indent={item.depth === 3}
						>
							{item.text}
						</SidebarListItem>
					))}
				</SidebarList>
			)}
			<div id="docs-toc-aside" className={visible.length > 0 ? "mt-6" : undefined} />
		</aside>
	);
}

// --- Layout ---

export default function DocsLayout() {
	const currentSlug = useCurrentSlug();
	const mod = getDocModule(currentSlug);
	const toc = mod?.toc ?? [];

	return (
		<div className="flex min-h-screen flex-col">
			<DocsNavbar />
			<div className="flex flex-1 justify-center px-6 pt-14">
				<div className="flex w-full max-w-300">
					<DocsSidebar currentSlug={currentSlug} />
					<main className="min-w-0 flex-1 px-8 py-8">
						<Outlet />
						<PageNavFooter currentSlug={currentSlug} />
					</main>
					<DocsToc items={toc} />
				</div>
			</div>
			<DocsFooter />
		</div>
	);
}
