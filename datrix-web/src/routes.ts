import {
	type RouteConfig,
	index,
	route,
	layout,
} from "@react-router/dev/routes";

export default [
	index("pages/home-page.tsx"),
	layout("pages/docs-layout.tsx", [
		route("/docs", "pages/docs-content.tsx"),
		route("/docs/:section", "pages/docs-content.tsx", { id: "docs-section" }),
		route("/docs/:section/:page", "pages/docs-content.tsx", {
			id: "docs-page",
		}),
	]),
] satisfies RouteConfig;
