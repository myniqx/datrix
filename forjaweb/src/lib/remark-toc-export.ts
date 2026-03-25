import { visit } from "unist-util-visit";
import { toString } from "mdast-util-to-string";
import { valueToEstree } from "estree-util-value-to-estree";
import type { Plugin } from "unified";
import type { Root, Heading } from "mdast";
import type { MdxjsEsm } from "mdast-util-mdx";

export interface TocItem {
	depth: number; // 1 = h1, 2 = h2, 3 = h3
	text: string;
	id: string;
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-");
}

/**
 * Remark plugin that extracts headings and exports them as `toc` from MDX.
 * rehype-slug uses the same slugify logic so IDs match.
 */
const remarkTocExport: Plugin<[], Root> = () => {
	return (tree) => {
		const items: TocItem[] = [];

		visit(tree, "heading", (node: Heading) => {
			const text = toString(node);
			const id = slugify(text);
			items.push({ depth: node.depth, text, id });
		});

		// Export `toc` from the MDX module
		const exportNode: MdxjsEsm = {
			type: "mdxjsEsm",
			value: "",
			data: {
				estree: {
					type: "Program",
					sourceType: "module",
					body: [
						{
							type: "ExportNamedDeclaration",
							specifiers: [],
							attributes: [],
							source: null,
							declaration: {
								type: "VariableDeclaration",
								kind: "const",
								declarations: [
									{
										type: "VariableDeclarator",
										id: { type: "Identifier", name: "toc" },
										init: valueToEstree(items),
									},
								],
							},
						},
					],
				},
			},
		};

		tree.children.push(exportNode);
	};
};

export default remarkTocExport;
