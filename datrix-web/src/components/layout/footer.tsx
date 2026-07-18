import { StarIcon } from "lucide-react";
import { siGithub } from "simple-icons";
import { Link } from "react-router";
import { Container } from "./container";
import { DatrixLogo } from "./logo";
import {
	DATRIX_VERSION,
	DATRIX_GITHUB_URL,
	DATRIX_PACKAGES,
	MYNIQX_URL,
} from "@/data/constants";

const DOCS_LINKS = [
	{ label: "Getting Started", href: "/docs/getting-started" },
	{ label: "Core", href: "/docs/core" },
	{ label: "Adapters", href: "/docs/adapters" },
	{ label: "API Plugin", href: "/docs/api" },
	{ label: "Plugins", href: "/docs/plugins" },
	{ label: "CLI", href: "/docs/cli" },
] as const;

const RESOURCE_LINKS = [
	{ label: "Showcase", href: "/#showcase" },
	{ label: "Features", href: "/#features" },
	{
		label: "GitHub",
		href: DATRIX_GITHUB_URL,
		external: true,
	},
	{
		label: "Issues",
		href: `${DATRIX_GITHUB_URL}/issues`,
		external: true,
	},
] as const;

interface FooterProps {
	starCount: number | null;
}

function FooterColumn({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3">
			<h3 className="text-xs font-semibold uppercase tracking-widest text-foreground/40">
				{title}
			</h3>
			<nav className="flex flex-col gap-2 text-sm text-foreground/70">
				{children}
			</nav>
		</div>
	);
}

export function Footer({ starCount }: FooterProps) {
	const starLabel =
		starCount === null
			? null
			: starCount >= 1000
				? `${(starCount / 1000).toFixed(1)}k`
				: String(starCount);

	return (
		<footer className="border-t border-border/40 bg-background/80">
			<Container className="py-16">
				<div className="grid grid-cols-2 gap-10 sm:grid-cols-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
					{/* Brand */}
					<div className="col-span-2 flex flex-col gap-3 sm:col-span-4 lg:col-span-1">
						<div className="flex items-center gap-2.5">
							<div className="text-primary">
								<DatrixLogo size={22} />
							</div>
							<span className="text-sm font-semibold text-foreground">
								datrix
							</span>
						</div>
						<p className="max-w-xs text-sm text-foreground/60 leading-relaxed">
							TypeScript-first database framework — schema, query builder,
							migrations, and a REST API layer in one plugin-driven package.
						</p>
					</div>

					{/* Docs */}
					<FooterColumn title="Docs">
						{DOCS_LINKS.map((link) => (
							<Link
								key={link.href}
								to={link.href}
								className="transition-colors hover:text-foreground"
							>
								{link.label}
							</Link>
						))}
					</FooterColumn>

					{/* Packages */}
					<FooterColumn title="Packages">
						{DATRIX_PACKAGES.map((pkg) => (
							<a
								key={pkg.name}
								href={pkg.npm}
								target="_blank"
								rel="noopener noreferrer"
								className="font-mono text-xs transition-colors hover:text-foreground"
							>
								{pkg.name}
							</a>
						))}
					</FooterColumn>

					{/* Resources */}
					<FooterColumn title="Resources">
						{RESOURCE_LINKS.map((link) =>
							"external" in link && link.external ? (
								<a
									key={link.href}
									href={link.href}
									target="_blank"
									rel="noopener noreferrer"
									className="transition-colors hover:text-foreground"
								>
									{link.label}
								</a>
							) : (
								<a
									key={link.href}
									href={link.href}
									className="transition-colors hover:text-foreground"
								>
									{link.label}
								</a>
							),
						)}
					</FooterColumn>
				</div>

				{/* Bottom bar */}
				<div className="mt-12 flex flex-col gap-4 border-t border-border/40 pt-6 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-xs text-foreground/50">
						© {new Date().getFullYear()} datrix — MIT License{" "}
						<span className="text-foreground/30">·</span>{" "}
						Built by{" "}
						<a
							href={MYNIQX_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="transition-colors hover:text-foreground"
						>
							myniqx.dev
						</a>
					</div>
					<div className="flex items-center gap-4 text-xs text-foreground/50">
						<a
							href={DATRIX_GITHUB_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-1.5 transition-colors hover:text-foreground"
						>
							<svg
								role="img"
								viewBox="0 0 24 24"
								className="size-3.5 fill-current"
							>
								<path d={siGithub.path} />
							</svg>
							GitHub
							{starLabel !== null && (
								<span className="flex items-center gap-1">
									<StarIcon className="size-3" />
									{starLabel}
								</span>
							)}
						</a>
						<span className="text-foreground/30">·</span>
						<span>{DATRIX_VERSION}</span>
					</div>
				</div>
			</Container>
		</footer>
	);
}
