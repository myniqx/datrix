import type { ReactNode, ComponentType } from "react";
import { Card, CardContent } from "@/components/ui/card";

interface PrereqItemProps {
	icon: ComponentType<{ className?: string }>;
	children: ReactNode;
}

export function PrereqItem({ icon: Icon, children }: PrereqItemProps) {
	return (
		<Card size="sm">
			<CardContent className="flex items-center gap-3">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
					<Icon className="size-3.5" />
				</span>
				<span className="text-sm text-foreground/80">{children}</span>
			</CardContent>
		</Card>
	);
}

export function PrereqGrid({ children }: { children: ReactNode }) {
	return (
		<div className="not-prose my-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
			{children}
		</div>
	);
}
