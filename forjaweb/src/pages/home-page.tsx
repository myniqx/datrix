import type { MetaFunction } from "react-router";
import { useEffect, useState } from "react";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Section } from "@/components/layout/section";
import { Container } from "@/components/layout/container";
import { Hero } from "@/components/sections/hero";
import { Playground } from "@/components/sections/playground";
import { Features } from "@/components/sections/features";
import { Frameworks } from "@/components/sections/frameworks";
import { FORJA_GITHUB_REPO } from "@/data/constants";

export const meta: MetaFunction = () => [
	{ title: "Forja — Schema-driven database layer for TypeScript" },
	{
		name: "description",
		content:
			"Schema-driven database layer for TypeScript. Define your schema once, query with full type safety, swap databases freely.",
	},
	{
		property: "og:title",
		content: "Forja — Schema-driven database layer for TypeScript",
	},
	{
		property: "og:description",
		content:
			"Schema-driven database layer for TypeScript. Define your schema once, query with full type safety, swap databases freely.",
	},
	{ property: "og:url", content: "https://tryforja.com/" },
	{ tagName: "link", rel: "canonical", href: "https://tryforja.com/" },
];

export default function HomePage() {
	const [starCount, setStarCount] = useState<number | null>(null);

	useEffect(() => {
		fetch(`https://api.github.com/repos/${FORJA_GITHUB_REPO}`)
			.then((res) =>
				res.ok ? (res.json() as Promise<{ stargazers_count: number }>) : null,
			)
			.then((data) => {
				if (data) setStarCount(data.stargazers_count);
			})
			.catch(() => {});
	}, []);

	return (
		<main>
			<Navbar starCount={starCount} />
			<Section id="hero" className="p-0">
				<Hero />
			</Section>
			<Section id="showcase" className="min-h-0 py-24">
				<Container>
					<div className="mb-12 flex flex-col gap-4">
						<h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
							See it in action
						</h2>
						<p className="text-base text-foreground/80">
							Real queries, real output. Browse CRUD operations and explore how
							Forja handles relations, filters, and nested queries.
						</p>
					</div>
					<Playground />
				</Container>
			</Section>
			<Section id="features" className="min-h-0">
				<Features />
			</Section>
			<Section id="frameworks" className="min-h-0 py-0">
				<Frameworks />
			</Section>
			<Footer starCount={starCount} />
		</main>
	);
}
