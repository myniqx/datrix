declare module "*.mdx" {
  import type { ComponentType } from "react";
  import type { TocItem } from "@/lib/remark-toc-export";

  export const frontmatter: {
    title: string
    description?: string
    section: string
    order: number
  };
  export const toc: TocItem[];
  const MDXComponent: ComponentType;
  export default MDXComponent;
}
