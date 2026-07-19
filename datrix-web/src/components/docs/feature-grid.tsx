import type { ReactNode, ComponentType } from "react";
import { Link } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { TypescriptCodeBlock } from "@/components/docs/code-block";

interface FeatureCardProps {
	icon: ComponentType<{ className?: string }>;
	title: string;
	children: ReactNode;
	code?: string;
	wide?: boolean;
	href?: string;
	compact?: boolean;
}

export function FeatureCard({
	icon: Icon,
	title,
	children,
	code,
	wide,
	href,
	compact,
}: FeatureCardProps) {
	if (compact) {
		const content = (
			<Card size="sm">
				<CardContent className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2">
						<div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
							<Icon className="size-3.5" />
						</div>
						<h3 className="text-sm font-semibold text-foreground">{title}</h3>
					</div>
					<p className="text-xs text-foreground/70 leading-snug">
						{children}
					</p>
				</CardContent>
			</Card>
		);

		return (
			<div className={wide ? "sm:col-span-2" : undefined}>
				{href ? (
					<Link
						to={href}
						className="block h-full transition-transform duration-200 ease-out hover:scale-[1.02]"
					>
						{content}
					</Link>
				) : (
					content
				)}
			</div>
		);
	}

	const iconEl = (
		<div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
			<Icon className="size-5" />
		</div>
	);

	const text = (
		<>
			<h3 className="text-base font-semibold text-foreground">{title}</h3>
			<p className="text-sm text-foreground/80 leading-relaxed">{children}</p>
		</>
	);

	const codeBlock = code && (
		<div className="text-xs [&_pre]:h-full [&_pre]:px-3 [&_pre]:py-3 [&_pre]:leading-6">
			<TypescriptCodeBlock code={code} />
		</div>
	);

	const content = (
		<Card>
			{wide && code ? (
				<CardContent className="flex h-full flex-col gap-4 pt-6 pb-6">
					{iconEl}
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
						<div className="flex flex-col gap-3">{text}</div>
						{codeBlock}
					</div>
				</CardContent>
			) : (
				<CardContent className="flex h-full flex-col gap-3 pt-6 pb-6">
					{iconEl}
					{text}
					{codeBlock && <div className="mt-1">{codeBlock}</div>}
				</CardContent>
			)}
		</Card>
	);

	return (
		<div className={wide ? "sm:col-span-2" : undefined}>
			{href ? (
				<Link
					to={href}
					className="block h-full transition-transform duration-200 ease-out hover:scale-[1.02]"
				>
					{content}
				</Link>
			) : (
				content
			)}
		</div>
	);
}

export function FeatureGrid({ children }: { children: ReactNode }) {
	return (
		<div className="not-prose grid grid-cols-1 gap-4 sm:grid-cols-2 my-6">
			{children}
		</div>
	);
}
