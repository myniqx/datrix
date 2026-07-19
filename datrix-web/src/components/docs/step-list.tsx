import type { ReactElement, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface StepProps {
	title: string;
	children: ReactNode;
}

export function Step({ title, children }: StepProps) {
	return (
		<>
			<span className="text-sm font-semibold text-foreground sm:w-36 sm:shrink-0">
				{title}
			</span>
			<span className="hidden text-primary/60 sm:inline">→</span>
			<span className="font-mono text-sm text-foreground/70">{children}</span>
		</>
	);
}

export function StepList({
	children,
}: {
	children: ReactElement<StepProps> | ReactElement<StepProps>[];
}) {
	const steps = Array.isArray(children) ? children : [children];
	return (
		<div className="not-prose my-6">
			<Card>
				<CardContent className="divide-y divide-border/50 px-0">
					{steps.map((step, i) => (
						<div key={i} className="flex items-center gap-4 px-5 py-4">
							<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
								{i + 1}
							</span>
							<div className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
								{step}
							</div>
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	);
}
