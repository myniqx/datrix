import type { ReactNode } from "react";

interface SidebarListProps {
	label: string;
	children: ReactNode;
}

export function SidebarList({ label, children }: SidebarListProps) {
	return (
		<div className="not-prose">
			<p className="text-[11px] font-semibold uppercase tracking-widest text-foreground/30 mb-3">
				{label}
			</p>
			<nav className="flex flex-col border-l border-border/25">{children}</nav>
		</div>
	);
}

interface SidebarListItemProps {
	href: string;
	active?: boolean;
	indent?: boolean;
	external?: boolean;
	children: ReactNode;
}

export function SidebarListItem({
	href,
	active,
	indent,
	external,
	children,
}: SidebarListItemProps) {
	return (
		<a
			href={href}
			target={external ? "_blank" : undefined}
			rel={external ? "noopener noreferrer" : undefined}
			className={`text-sm py-1 font-heading leading-snug transition-colors border-l -ml-px ${
				indent ? "pl-5" : "pl-3"
			} ${
				active
					? "text-foreground border-primary"
					: "text-foreground/65 border-transparent hover:text-foreground/80 hover:border-border"
			}`}
		>
			{children}
		</a>
	);
}
