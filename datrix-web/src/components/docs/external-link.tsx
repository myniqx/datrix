import type { ReactNode } from "react";
import { ArrowUpRightIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface ExternalLinkProps {
	href: string;
	title: string;
	children: ReactNode;
}

export function ExternalLink({ href, title, children }: ExternalLinkProps) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="not-prose group block my-6 transition-transform duration-200 ease-out hover:scale-[1.01]"
		>
			<Card size="sm">
				<CardContent className="flex items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<h3 className="text-sm font-semibold text-foreground">
							{title}
						</h3>
						<p className="text-xs text-foreground/70 leading-snug">
							{children}
						</p>
					</div>
					<ArrowUpRightIcon className="size-4 shrink-0 text-primary transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
				</CardContent>
			</Card>
		</a>
	);
}
