import { Container } from "@/components/layout/container";
import { Card, CardContent } from "@/components/ui/card";
import {
	DatabaseIcon,
	TerminalIcon,
	PuzzleIcon,
	ShieldIcon,
	GitMergeIcon,
	CodeIcon,
	WrenchIcon,
} from "lucide-react";

// ─── Adapter card ─────────────────────────────────────────────────────────────

const ADAPTERS = [
	{
		name: "PostgreSQL",
		description: "Full query translation, relations, migrations.",
	},
	{ name: "MySQL", description: "MySQL & MariaDB support." },
	{ name: "MongoDB", description: "Full CRUD, population, migration support." },
	{ name: "JSON", description: "File-based adapter for local dev & testing." },
] as const;

function AdapterCard() {
	return (
		<Card>
			<CardContent className="flex h-full flex-col gap-5 pt-6 pb-6">
				<div className="flex items-start gap-4">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<DatabaseIcon className="size-5" />
					</div>
					<div className="flex flex-col gap-1">
						<h3 className="text-base font-semibold text-foreground">
							Adapter System
						</h3>
						<p className="text-sm text-foreground/80 leading-relaxed">
							Swap databases without touching your business logic. Each adapter
							handles query translation, migrations, and relation population
							independently.
						</p>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{ADAPTERS.map((adapter) => (
						<div
							key={adapter.name}
							className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-3"
						>
							<div className="flex items-center gap-1.5">
								<DatabaseIcon className="size-3 text-primary shrink-0" />
								<span className="text-xs font-mono font-semibold text-foreground/90">
									{adapter.name}
								</span>
							</div>
							<p className="text-[11px] text-foreground/80 leading-relaxed">
								{adapter.description}
							</p>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

// ─── CLI card ─────────────────────────────────────────────────────────────────

const CLI_COMMANDS = [
	{ cmd: "forja migrate", desc: "run pending migrations" },
	{ cmd: "forja generate types", desc: "generate TS types" },
	{ cmd: "forja generate schema User", desc: "scaffold schema" },
	{ cmd: "forja dev", desc: "watch & auto-migrate" },
] as const;

function CliCard() {
	return (
		<Card>
			<CardContent className="flex h-full flex-col gap-5 pt-6 pb-6">
				<div className="flex items-start gap-4">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<TerminalIcon className="size-5" />
					</div>
					<div className="flex flex-col gap-1">
						<h3 className="text-base font-semibold text-foreground">
							CLI Tooling
						</h3>
						<p className="text-sm text-foreground/80 leading-relaxed">
							Everything from the terminal — migrations, type generation, and
							resource scaffolding.
						</p>
					</div>
				</div>
				<div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-4 py-3 font-mono text-xs">
					{CLI_COMMANDS.map((item) => (
						<div key={item.cmd} className="flex items-center gap-3">
							<span className="text-primary">$</span>
							<span className="text-foreground/90">{item.cmd}</span>
							<span className="ml-auto text-foreground/80"># {item.desc}</span>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

// ─── API Plugin card ──────────────────────────────────────────────────────────

const API_FEATURES = [
	{
		name: "REST Endpoints",
		description: "Auto-generated CRUD routes for every schema.",
	},
	{
		name: "Auth (optional)",
		description: "JWT & session, register/login/logout/me built-in.",
	},
	{
		name: "Permissions",
		description: "Role-based access control per route and schema.",
	},
	{
		name: "Query Parsing",
		description: "Filter, populate, sort, paginate via URL params.",
	},
] as const;

function ApiPluginCard() {
	return (
		<Card>
			<CardContent className="flex h-full flex-col gap-5 pt-6 pb-6">
				<div className="flex items-start gap-4">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<PuzzleIcon className="size-5" />
					</div>
					<div className="flex flex-col gap-1">
						<h3 className="text-base font-semibold text-foreground">
							API Plugin
						</h3>
						<p className="text-sm text-foreground/80 leading-relaxed">
							Drop in the API plugin to get a full REST layer — authentication,
							permissions, and query parsing included.
						</p>
					</div>
				</div>
				<div className="grid grid-cols-2 gap-2">
					{API_FEATURES.map((feature) => (
						<div
							key={feature.name}
							className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-3"
						>
							<div className="flex items-center gap-1.5">
								<ShieldIcon className="size-3 text-primary shrink-0" />
								<span className="text-xs font-semibold text-foreground/90">
									{feature.name}
								</span>
							</div>
							<p className="text-[11px] text-foreground/80 leading-relaxed">
								{feature.description}
							</p>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

// ─── Small card ───────────────────────────────────────────────────────────────

interface SmallCardProps {
	icon: React.ComponentType<{ className?: string }>;
	title: string;
	description: string;
}

function SmallCard({ icon: Icon, title, description }: SmallCardProps) {
	return (
		<Card>
			<CardContent className="flex h-full flex-col gap-3 pt-6 pb-6">
				<div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<Icon className="size-5" />
				</div>
				<h3 className="text-base font-semibold text-foreground">{title}</h3>
				<p className="text-sm text-foreground/80 leading-relaxed">
					{description}
				</p>
			</CardContent>
		</Card>
	);
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function Features() {
	return (
		<Container className="py-24">
			{/* Header */}
			<div className="mb-16 flex flex-col gap-4">
				<h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
					Everything you need, nothing you don&apos;t
				</h2>
				<p className="text-base text-foreground/80">
					Forja is a minimal, type-safe database framework designed to integrate
					into your existing stack — not replace it.
				</p>
			</div>

			{/* Bento grid — 6 columns, col-span wrappers control layout */}
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
				{/* Row 1: Fully Typed (2col) + Adapter System (4col) */}
				<div className="col-span-2 lg:col-span-2 transition-transform duration-300 ease-out hover:scale-[1.02]">
					<SmallCard
						icon={CodeIcon}
						title="Fully Typed"
						description="Schema types generated via CLI. Full IntelliSense and compile-time safety across queries, relations, and plugins."
					/>
				</div>
				<div className="col-span-2 lg:col-span-4 transition-transform duration-300 ease-out hover:scale-[1.02]">
					<AdapterCard />
				</div>

				{/* Row 2: CLI (3col) + Auth (3col) */}
				<div className="col-span-2 lg:col-span-3 transition-transform duration-300 ease-out hover:scale-[1.02]">
					<CliCard />
				</div>
				<div className="col-span-2 lg:col-span-3 transition-transform duration-300 ease-out hover:scale-[1.02]">
					<ApiPluginCard />
				</div>

				{/* Row 3: Plugin (2col) + Migration (2col) + Zero Lock-in (2col) */}
				<div className="col-span-2 lg:col-span-2 transition-transform duration-300 ease-out hover:scale-[1.02]">
					<SmallCard
						icon={PuzzleIcon}
						title="Plugin Architecture"
						description="Extend core through a structured plugin system. REST API, file uploads — only add what you need."
					/>
				</div>
				<div className="col-span-2 lg:col-span-2 transition-transform duration-300 ease-out hover:scale-[1.02]">
					<SmallCard
						icon={GitMergeIcon}
						title="Migration System"
						description="Schema changes tracked and applied through versioned migrations managed entirely via CLI."
					/>
				</div>
				<div className="col-span-2 lg:col-span-2 transition-transform duration-300 ease-out hover:scale-[1.02]">
					<SmallCard
						icon={WrenchIcon}
						title="Zero Lock-in"
						description="Forja integrates into your existing stack. No framework takeover, no opinionated project structure."
					/>
				</div>
			</div>
		</Container>
	);
}
