import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HeroOrb } from "./hero-orb";
import { GridDebugPanel } from "@/components/layout/grid-debug-panel";
import { CopyButton } from "@/components/ui/copy-button";
import { ChevronDownIcon } from "lucide-react";
import {
	FORJA_VERSION,
	FORJA_GITHUB_URL,
	FORJA_NPM_INSTALL,
} from "@/data/constants";

export function Hero() {
	return (
		<div className="relative min-h-screen w-full overflow-hidden lg:grid lg:grid-cols-2 lg:items-center">
			<GridDebugPanel />

			{/* Orb — mobile: fullscreen background, desktop: absolute right */}
			<div className="absolute inset-0 z-0 lg:inset-auto lg:right-2.5 lg:top-1/2 lg:-translate-y-1/2 lg:size-240">
				<HeroOrb />
			</div>

			{/* Content — desktop: left grid column, 4K: capped with padding */}
			<div className="relative z-10 flex min-h-screen items-center justify-center lg:min-h-0 lg:justify-start">
				<div className="flex w-full max-w-2xl flex-col items-center gap-6 px-8 text-center lg:items-start lg:py-0 lg:text-left lg:transform-[perspective(1000px)_rotateY(8deg)_rotateX(2deg)_translateZ(150px)_translateX(40px)_scale(1.02)]">
					<Badge variant="outline">{FORJA_VERSION} — Early Preview</Badge>

					<h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground lg:text-6xl">
						Database layer for
						<br />
						TypeScript backends
					</h1>

					<p className="text-base text-foreground/80 leading-relaxed lg:text-lg">
						Define your schema once. Query with full type safety, swap databases
						freely, and extend with plugins — without adopting a full framework.
					</p>

					<div className="flex flex-wrap items-center gap-3">
						<Button size="lg">Get Started</Button>
						<Button asChild size="lg" variant="outline">
							<a
								href={FORJA_GITHUB_URL}
								target="_blank"
								rel="noopener noreferrer"
							>
								View on GitHub
							</a>
						</Button>
					</div>

					<div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-2.5 font-mono text-sm text-foreground/80">
						<span className="text-primary">$</span>
						<span>{FORJA_NPM_INSTALL}</span>
						<CopyButton text={FORJA_NPM_INSTALL} />
					</div>
				</div>
			</div>

			{/* See it in action — bottom center */}
			<div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2">
				<Button
					asChild
					variant="ghost"
					size="sm"
					className="flex flex-col gap-1 h-auto py-2 text-foreground/80 hover:text-foreground animate-bounce"
				>
					<a href="#showcase">
						<span className="text-xs">See it in action</span>
						<ChevronDownIcon className="size-4" />
					</a>
				</Button>
			</div>
		</div>
	);
}
