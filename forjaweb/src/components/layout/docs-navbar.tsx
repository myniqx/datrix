import { siGithub } from "simple-icons"
import { Link } from "react-router-dom"
import { ForjaLogo } from "./logo"
import { FORJA_GITHUB_URL } from "@/data/constants"

export function DocsNavbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between px-6">

        {/* Left — logo → back to landing */}
        <Link to="/" className="flex items-center gap-2.5 text-foreground/80 hover:text-foreground transition-colors">
          <div className="text-primary">
            <ForjaLogo size={22} />
          </div>
          <span className="text-sm font-semibold">forja</span>
          <span className="text-foreground/30">/</span>
          <span className="text-sm text-foreground/60">docs</span>
        </Link>

        {/* Right — github */}
        <div className="flex items-center gap-2">
          <a
            href={FORJA_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-foreground/60 hover:text-foreground transition-colors px-2 py-1"
          >
            <svg role="img" viewBox="0 0 24 24" className="size-4 fill-current">
              <path d={siGithub.path} />
            </svg>
            GitHub
          </a>
        </div>

      </div>
    </header>
  )
}
