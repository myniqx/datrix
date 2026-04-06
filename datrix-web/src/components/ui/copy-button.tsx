import { useState } from "react";
import { CopyIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
	text: string;
	label?: string;
	className?: string;
}

export function CopyButton({ text, label, className }: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	function handleCopy() {
		void navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 3000);
	}

	return (
		<button
			onClick={handleCopy}
			className={cn(
				"flex items-center gap-1.5 transition-colors cursor-pointer",
				label
					? "text-xs font-sans px-2.5 py-1 rounded-md border border-border hover:border-border/80 text-foreground/50 hover:text-foreground/80"
					: "text-foreground/80 hover:text-foreground",
				copied && label && "text-green-400 border-green-900 bg-green-950/40",
				className,
			)}
		>
			{copied ? (
				<>
					<CheckIcon className="size-3.5 shrink-0" />
					{label && "copied!"}
				</>
			) : (
				<>
					<CopyIcon className="size-3.5 shrink-0" />
					{label}
				</>
			)}
		</button>
	);
}
