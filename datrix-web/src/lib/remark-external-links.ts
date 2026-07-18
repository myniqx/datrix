import { visit } from "unist-util-visit";

// Inline types to avoid depending on "unified" and "mdast" packages directly
type Root = { type: "root"; children: unknown[] };
type Link = {
	type: "link";
	url: string;
	data?: {
		hProperties?: Record<string, string>;
	};
};

/**
 * Remark plugin that opens external (http/https) markdown links in a new tab.
 * Only touches `link` nodes — leaves code blocks and everything else alone.
 */
const remarkExternalLinks = () => {
	return (tree: Root) => {
		visit(tree, "link", (node: Link) => {
			if (!/^https?:\/\//.test(node.url)) return;

			node.data ??= {};
			node.data.hProperties = {
				...node.data.hProperties,
				target: "_blank",
				rel: "noopener noreferrer",
			};
		});
	};
};

export default remarkExternalLinks;
