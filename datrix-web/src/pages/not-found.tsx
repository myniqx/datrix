import type { MetaFunction } from "react-router";
import { Link } from "react-router";
import { Navbar } from "@/components/layout/navbar";
import { Button } from "@/components/ui/button";

export const meta: MetaFunction = () => [
	{ title: "Page not found — Datrix" },
	{ name: "robots", content: "noindex" },
];

export default function NotFoundPage() {
	return (
		<main>
			<Navbar starCount={null} />
			<div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
				<p className="font-mono text-sm text-primary">404</p>
				<h1 className="font-heading text-3xl font-semibold text-foreground">
					Page not found
				</h1>
				<p className="text-foreground/70">
					The page you are looking for does not exist or has moved.
				</p>
				<div className="flex gap-2">
					<Button asChild variant="outline" size="sm">
						<Link to="/">Home</Link>
					</Button>
					<Button asChild size="sm">
						<Link to="/docs/">Docs</Link>
					</Button>
				</div>
			</div>
		</main>
	);
}
