import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import mdx from "@mdx-js/rollup";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import remarkGfm from "remark-gfm";
import remarkTocExport from "./src/lib/remark-toc-export";
import rehypeSlug from "rehype-slug";
import { llmsPlugin } from "./src/lib/vite-plugin-llms";
import { buildTypesMarkdown } from "./src/components/docs/build-types-markdown";

export default defineConfig({
	plugins: [
		tailwindcss(),
		mdx({
			remarkPlugins: [
				remarkGfm,
				remarkFrontmatter,
				remarkMdxFrontmatter,
				remarkTocExport,
			],
			rehypePlugins: [rehypeSlug],
		}),
		react(),
		tsconfigPaths(),
		llmsPlugin({
			markdownOverrides: {
				"core/types": buildTypesMarkdown(),
			},
		}),
	],
});
