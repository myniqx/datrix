import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into the "On this page" sidebar (below the TOC list)
 * instead of the main article flow. Use inside an .mdx file to surface
 * page-specific links or callouts next to the TOC.
 */
export function AsideSlot({ children }: { children: ReactNode }) {
	const [target, setTarget] = useState<HTMLElement | null>(null);

	useEffect(() => {
		setTarget(document.getElementById("docs-toc-aside"));
	}, []);

	if (!target) return null;
	return createPortal(
		<div className="not-prose flex flex-col gap-2">{children}</div>,
		target,
	);
}
