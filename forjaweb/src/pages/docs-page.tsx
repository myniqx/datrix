import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, Link } from "react-router-dom";
import { DocsNavbar } from "@/components/layout/docs-navbar";
import { buildDocNav, getDocModule } from "@/docs/use-doc-nav";
import type { TocItem } from "@/lib/remark-toc-export";
import { DocsCodeBlock } from "@/components/docs/code-block";

const MDX_COMPONENTS = { pre: DocsCodeBlock };

const NAV_SECTIONS = buildDocNav();

// --- Sidebar ---

function SidebarLink({
	slug,
	title,
	currentSlug,
	isSection = false,
}: {
	slug: string;
	title: string;
	currentSlug: string;
	isSection?: boolean;
}) {
	const isActive = currentSlug === slug;
	return (
		<Link
			to={`/docs/${slug}`}
			className={`group flex items-center gap-2 rounded-md transition-colors ${
				isSection
					? "text-sm font-medium py-1.5 px-2"
					: "text-sm py-1 px-2"
			} ${
				isActive
					? "text-foreground"
					: "text-foreground/55 hover:text-foreground"
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
				const sectionActive =
					section.slug === currentSlug ||
					section.items.some((i) => i.slug === currentSlug);

				return (
					<div key={section.title || "__root__"} className="mb-5">
						{section.title &&
							(section.slug ? (
								<SidebarLink
									slug={section.slug}
									title={section.title}
									currentSlug={currentSlug}
									isSection
								/>
							) : (
								<p className="text-[11px] font-semibold uppercase tracking-widest text-foreground/30 mb-1.5 px-2">
									{section.title}
								</p>
							))}
						{section.items.length > 0 && (
							<nav
								className={`flex flex-col border-l mt-0.5 ml-3 pl-3 ${
									sectionActive ? "border-border/60" : "border-border/25"
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

	// Only show h2 and h3, skip h1 (page title)
	const visible = items.filter((item) => item.depth === 2 || item.depth === 3);

	if (visible.length === 0) return null;

	return (
		<aside className="hidden xl:block w-52 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto pt-8 pl-6">
			<p className="text-[11px] font-semibold uppercase tracking-widest text-foreground/30 mb-3">
				On this page
			</p>
			<nav className="flex flex-col border-l border-border/25">
				{visible.map((item) => (
					<a
						key={item.id}
						href={`#${item.id}`}
						className={`text-sm py-1 transition-colors border-l -ml-px ${
							item.depth === 3 ? "pl-5" : "pl-3"
						} ${
							activeId === item.id
								? "text-foreground border-primary"
								: "text-foreground/50 border-transparent hover:text-foreground/80 hover:border-border"
						}`}
					>
						{item.text}
					</a>
				))}
			</nav>
		</aside>
	);
}

// --- Routing ---

function useCurrentSlug(): string {
	const { pathname } = useLocation();
	const match = pathname.match(/^\/docs\/(.+)$/);
	if (!match) {
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
	const slug = match[1];
	const directMod = getDocModule(slug);
	if (directMod) return slug;
	const indexMod = getDocModule(`${slug}/index`);
	return indexMod ? `${slug}/index` : slug;
}

// --- Layout ---

export function DocsLayout() {
	const currentSlug = useCurrentSlug();
	const mod = getDocModule(currentSlug);
	const toc = mod?.toc ?? [];

	return (
		<div className="min-h-screen">
			<DocsNavbar />
			<div className="flex w-full px-6 pt-14">
				<DocsSidebar currentSlug={currentSlug} />
				<main className="min-w-0 flex-1 px-8 py-8">
					<Outlet />
				</main>
				<DocsToc items={toc} />
			</div>
		</div>
	);
}

// --- Content ---

export default function DocsContent() {
	const currentSlug = useCurrentSlug();
	const { hash } = useLocation();
	const mod = getDocModule(currentSlug);
	const DocComponent = mod?.default;

	useEffect(() => {
		if (!hash) return;
		const id = hash.slice(1);
		const el = document.getElementById(id);
		if (el) el.scrollIntoView({ behavior: "smooth" });
	}, [hash, currentSlug]);

	return (
		<article className="prose prose-invert max-w-3xl">
			{DocComponent ? (
				<DocComponent components={MDX_COMPONENTS} />
			) : (
				<p className="text-foreground/50">Page not found.</p>
			)}
		</article>
	);
}
