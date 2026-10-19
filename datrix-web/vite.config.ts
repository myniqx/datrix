import path from "node:path";
import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@mdx-js/rollup";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import remarkGfm from "remark-gfm";
import remarkTocExport from "./src/lib/remark-toc-export.ts";
import remarkExternalLinks from "./src/lib/remark-external-links.ts";
import rehypeSlug from "rehype-slug";
import { llmsPlugin } from "./src/lib/vite-plugin-llms.ts";
import { buildTypesMarkdown } from "./src/components/docs/build-types-markdown.ts";

export default defineConfig({
	resolve: {
		alias: { "@": path.resolve(import.meta.dirname, "src") },
	},
	plugins: [
		tailwindcss(),
		mdx({
			remarkPlugins: [
				remarkGfm,
				remarkFrontmatter,
				remarkMdxFrontmatter,
				remarkTocExport,
				remarkExternalLinks,
			],
			rehypePlugins: [rehypeSlug],
		}),
		reactRouter(),
		llmsPlugin({
			markdownOverrides: {
				"core/types": buildTypesMarkdown(),
			},
		}),
	],
});
