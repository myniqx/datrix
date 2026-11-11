import { visit } from "unist-util-visit";
import { withTrailingSlash } from "./trailing-slash.ts";

// Inline types to avoid depending on "unified" and "mdast" packages directly
type Root = { type: "root"; children: unknown[] };
type Link = { type: "link"; url: string };

/**
 * Remark plugin that rewrites internal markdown links (`/docs/x#y`) to their
 * trailing-slash form (`/docs/x/#y`) so they match the canonical URLs.
 */
const remarkTrailingSlash = () => {
	return (tree: Root) => {
		visit(tree, "link", (node: Link) => {
			node.url = withTrailingSlash(node.url);
		});
	};
};

export default remarkTrailingSlash;
