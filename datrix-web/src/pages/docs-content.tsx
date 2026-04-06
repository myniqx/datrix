import type { MetaFunction } from "react-router";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { getDocModule, getDocRaw } from "@/docs/use-doc-nav";
import { DocsCodeBlock } from "@/components/docs/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { buildTypesMarkdown } from "@/components/docs/build-types-markdown";
import { useCurrentSlug } from "./docs-layout";

const SITE_URL = "https://datrix.dev";

export const meta: MetaFunction = ({ params }) => {
	const { section, page } = params;
	const slug = section && page ? `${section}/${page}` : section;
	const mod = slug
		? (getDocModule(slug) ?? getDocModule(`${slug}/index`))
		: undefined;
	const title = mod ? `${mod.frontmatter.title} — Datrix Docs` : "Datrix Docs";
	const description = mod?.frontmatter.description ?? "Datrix documentation.";
	const path = slug
		? `/docs/${slug.endsWith("/index") ? slug.slice(0, -6) : slug}`
		: "/docs";
	const url = `${SITE_URL}${path}`;

	return [
		{ title },
		{ name: "description", content: description },
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ tagName: "link", rel: "canonical", href: url },
	];
};

const MDX_COMPONENTS = { pre: DocsCodeBlock };

function stripMdxJsx(raw: string): string {
	const noImports = raw.replace(/^import\s+.*$/gm, "");
	const noSelfClosing = noImports.replace(/<[A-Z][A-Za-z]*[^>]*\/>/g, "");
	const noBlock = noSelfClosing.replace(
		/<[A-Z][A-Za-z]*[^>]*>[\s\S]*?<\/[A-Z][A-Za-z]*>/g,
		"",
	);
	return noBlock.replace(/\n{3,}/g, "\n\n").trim();
}

function CopyForLlmButton({
	slug,
}: {
	slug: string;
}): React.ReactElement | null {
	const isTypes = slug === "core/types";
	const raw = isTypes ? buildTypesMarkdown() : getDocRaw(slug);
	if (!raw) return null;
	const text = isTypes ? raw : stripMdxJsx(raw);
	return <CopyButton text={text} label="copy for LLM" />;
}

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
		<div>
			<div className="flex justify-end mb-4">
				<CopyForLlmButton slug={currentSlug} />
			</div>
			<article className="prose prose-invert max-w-3xl">
				{DocComponent ? (
					<DocComponent components={MDX_COMPONENTS} />
				) : (
					<p className="text-foreground/50">Page not found.</p>
				)}
			</article>
		</div>
	);
}
