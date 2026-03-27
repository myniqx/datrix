import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { MetaFunction } from "react-router";
import "./app/globals.css";
import "@fontsource-variable/inter";
import "highlight.js/styles/github-dark.min.css";
import "@fontsource-variable/jetbrains-mono";

const SITE_URL = "https://tryforja.com";
const OG_IMAGE = `${SITE_URL}/og.png`;

export const meta: MetaFunction = () => [
	{ title: "Forja" },
	{
		name: "description",
		content: "Schema-driven database layer for TypeScript.",
	},
	{ property: "og:site_name", content: "Forja" },
	{ property: "og:image", content: OG_IMAGE },
	{ property: "og:type", content: "website" },
	{ name: "twitter:card", content: "summary_large_image" },
	{ name: "twitter:image", content: OG_IMAGE },
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className="dark">
			<head>
				<meta charSet="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<link rel="icon" type="image/png" href="/logo.png" />
				<Meta />
				<Links />
			</head>
			<body>
				<div className="font-sans">{children}</div>
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function Root() {
	return <Outlet />;
}
