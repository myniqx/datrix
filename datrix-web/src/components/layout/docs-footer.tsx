import { siGithub } from "simple-icons";
import { Container } from "./container";
import { DATRIX_VERSION, DATRIX_GITHUB_URL, MYNIQX_URL } from "@/data/constants";

export function DocsFooter() {
	return (
		<footer className="border-t border-border/40 bg-background/80">
			<Container className="py-6">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-xs text-foreground/50">
						© {new Date().getFullYear()} datrix — MIT License{" "}
						<span className="text-foreground/30">·</span>{" "}
						Built by{" "}
						<a
							href={MYNIQX_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="transition-colors hover:text-foreground"
						>
							myniqx.dev
						</a>
					</div>
					<div className="flex items-center gap-4 text-xs text-foreground/50">
						<a
							href={DATRIX_GITHUB_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-1.5 transition-colors hover:text-foreground"
						>
							<svg
								role="img"
								viewBox="0 0 24 24"
								className="size-3.5 fill-current"
							>
								<path d={siGithub.path} />
							</svg>
							GitHub
						</a>
						<span className="text-foreground/30">·</span>
						<span>{DATRIX_VERSION}</span>
					</div>
				</div>
			</Container>
		</footer>
	);
}
