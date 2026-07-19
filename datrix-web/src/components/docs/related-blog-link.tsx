import { SidebarList, SidebarListItem } from "@/components/docs/sidebar-list";

interface RelatedBlogLinkProps {
	href: string;
	title: string;
}

export function RelatedBlogLink({ href, title }: RelatedBlogLinkProps) {
	return (
		<SidebarList label="Related blog">
			<SidebarListItem href={href} external>
				{title}
			</SidebarListItem>
		</SidebarList>
	);
}
