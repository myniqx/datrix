import { cn } from "@/lib/utils";

interface SectionProps extends React.ComponentProps<"section"> {
	children: React.ReactNode;
}

export function Section({ className, children, ...props }: SectionProps) {
	return (
		<section
			className={cn(
				"relative flex min-h-screen w-full flex-col items-center justify-center",
				className,
			)}
			{...props}
		>
			{children}
		</section>
	);
}
