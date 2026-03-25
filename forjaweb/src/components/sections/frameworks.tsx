import { useEffect, useRef } from "react";
import { Container } from "@/components/layout/container";
import { Card, CardContent } from "@/components/ui/card";
import { WindIcon } from "lucide-react";
import {
	siNextdotjs,
	siExpress,
	siFastify,
	siNestjs,
	siHono,
	siBun,
	siRemix,
} from "simple-icons";

interface Framework {
	name: string;
	description: string;
	icon: { path: string } | null; // null = use lucide fallback
}

const FRAMEWORKS: Framework[] = [
	{
		name: "Next.js",
		description: "Full-stack React framework",
		icon: siNextdotjs,
	},
	{ name: "Express", description: "Minimal Node.js server", icon: siExpress },
	{ name: "Fastify", description: "Fast & low overhead", icon: siFastify },
	{ name: "NestJS", description: "Modular & typed backend", icon: siNestjs },
	{ name: "Hono", description: "Edge-ready web framework", icon: siHono },
	{ name: "Bun", description: "Runtime & toolkit", icon: siBun },
	{ name: "Elysia", description: "Bun-native framework", icon: null },
	{ name: "Remix", description: "Full-stack web framework", icon: siRemix },
];

// Gaussian peak at left 30% of screen
const SCALE_MAX = 0.35; // max scale boost
const SIGMA = 280; // spread in pixels

function gaussian(cardCenterX: number, peakX: number): number {
	const d = cardCenterX - peakX;
	return SCALE_MAX * Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
}

const CARD_WIDTH = 200; // px
const CARD_GAP = 32; // px
const CARD_UNIT = CARD_WIDTH + CARD_GAP;
const SPEED = 0.6; // px per frame

// Triplicate for seamless loop
const ITEMS = [...FRAMEWORKS, ...FRAMEWORKS, ...FRAMEWORKS];
const LOOP_WIDTH = FRAMEWORKS.length * CARD_UNIT;

export function Frameworks() {
	const trackRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
	const offsetRef = useRef(0);
	const rafRef = useRef<number>(0);
	const pausedRef = useRef(false);
	const trackInitialLeftRef = useRef<number | null>(null);

	useEffect(() => {
		function tick() {
			// Capture initial track left once (before any translate)
			if (trackInitialLeftRef.current === null && trackRef.current) {
				trackRef.current.style.transform = "";
				trackInitialLeftRef.current =
					trackRef.current.getBoundingClientRect().left;
			}

			if (!pausedRef.current) {
				offsetRef.current += SPEED;
				if (offsetRef.current >= LOOP_WIDTH) {
					offsetRef.current -= LOOP_WIDTH;
				}
			}

			if (trackRef.current) {
				trackRef.current.style.transform = `translateX(${-offsetRef.current}px)`;
			}

			const peakX = window.innerWidth * 0.3;
			const trackInitialLeft = trackInitialLeftRef.current ?? 0;
			ITEMS.forEach((_, i) => {
				const el = cardRefs.current[i];
				if (!el) return;
				const cardCenterX =
					trackInitialLeft + i * CARD_UNIT + CARD_WIDTH / 2 - offsetRef.current;
				const scale = 1 + gaussian(cardCenterX, peakX);
				const extraMargin = (CARD_WIDTH * (scale - 1)) / 2;
				el.style.transform = `scale(${scale})`;
				el.style.marginLeft = `${extraMargin}px`;
				el.style.marginRight = `${extraMargin}px`;
			});

			rafRef.current = requestAnimationFrame(tick);
		}

		rafRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafRef.current);
	}, []);

	return (
		<Container className="py-24">
			{/* Header */}
			<div className="mb-12 flex flex-col gap-3">
				<h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
					Works with your stack
				</h2>
				<p className="text-base text-foreground/80">
					Forja is framework-agnostic. Use it with any TypeScript backend — no
					lock-in.
				</p>
			</div>

			{/* Carousel */}
			<div
				className="overflow-x-hidden py-8"
				onMouseEnter={() => {
					pausedRef.current = true;
				}}
				onMouseLeave={() => {
					pausedRef.current = false;
				}}
			>
				<div
					ref={trackRef}
					className="flex items-center will-change-transform"
					style={{ gap: CARD_GAP }}
				>
					{ITEMS.map((fw, i) => (
						<div
							key={i}
							ref={(el) => {
								cardRefs.current[i] = el;
							}}
							className="shrink-0"
							style={{
								width: CARD_WIDTH,
								height: 120,
								transformOrigin: "center center",
							}}
						>
							<Card className="h-full">
								<CardContent className="flex h-full items-center gap-3 overflow-hidden px-5 py-4">
									<div className="shrink-0 text-foreground/70">
										{fw.icon ? (
											<svg
												role="img"
												viewBox="0 0 24 24"
												className="size-7 fill-current"
											>
												<path d={fw.icon.path} />
											</svg>
										) : (
											<WindIcon className="size-7" />
										)}
									</div>
									<div className="flex flex-col gap-0.5 min-w-0">
										<span className="text-sm font-semibold text-foreground truncate">
											{fw.name}
										</span>
										<span className="text-xs text-foreground/80 truncate">
											{fw.description}
										</span>
									</div>
								</CardContent>
							</Card>
						</div>
					))}
				</div>
			</div>
		</Container>
	);
}
