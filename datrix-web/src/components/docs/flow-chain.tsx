import {
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { ArrowDownRightIcon } from "lucide-react";

interface FlowStepProps {
	children: ReactNode;
	/** Manual mode only — indentation level of this step (0 = no indent). */
	level?: number;
}

export function FlowStep({ children }: FlowStepProps) {
	return (
		<span className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 font-mono text-sm text-foreground/90 whitespace-nowrap">
			{children}
		</span>
	);
}

interface FlowChainProps {
	children: ReactElement<FlowStepProps> | ReactElement<FlowStepProps>[];
	/**
	 * "auto" (default) — each step indents one level further than the last.
	 * "manual" — indentation comes from each FlowStep's own `level` prop,
	 * allowing branches that step back in (e.g. after a COMMIT).
	 */
	indent?: "auto" | "manual";
}

export function FlowChain({ children, indent = "auto" }: FlowChainProps) {
	const steps = Array.isArray(children) ? children : [children];
	return (
		<div className="not-prose my-6 flex flex-col gap-2">
			{steps.map((step, i) => {
				const level =
					indent === "manual" && isValidElement<FlowStepProps>(step)
						? (step.props.level ?? 0)
						: i;
				return (
					<div
						key={i}
						className="flex items-center gap-2"
						style={{ paddingLeft: `${level * 1.5}rem` }}
					>
						{level > 0 && (
							<ArrowDownRightIcon className="size-4 shrink-0 text-primary/50" />
						)}
						{step}
					</div>
				);
			})}
		</div>
	);
}
