import { StarIcon } from "lucide-react"
import { siGithub } from "simple-icons"
import { Container } from "./container"
import { ForjaLogo } from "./logo"
import { FORJA_VERSION, FORJA_GITHUB_URL } from "@/data/constants"

const NAV_LINKS = [
  { label: "Showcase", href: "#showcase" },
  { label: "Features", href: "#features" },
  { label: "Docs", href: "/docs" },
  { label: "Packages", href: "/packages" },
] as const

interface FooterProps {
  starCount: number | null
}

export function Footer({ starCount }: FooterProps): JSX.Element {
  const starLabel = starCount === null
    ? null
    : starCount >= 1000
      ? `${(starCount / 1000).toFixed(1)}k`
      : String(starCount)

  return (
    <footer className="border-t border-border/40 bg-background/80">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">

        {/* Left — logo + version */}
        <div className="flex items-center gap-3">
          <div className="text-primary">
            <ForjaLogo size={22} />
          </div>
          <span className="text-sm font-semibold text-foreground">forja</span>
          <span className="text-xs text-foreground/50">{FORJA_VERSION}</span>
        </div>

        {/* Center — links */}
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-foreground/70">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </a>
          ))}
          <a
            href={FORJA_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <svg role="img" viewBox="0 0 24 24" className="size-3.5 fill-current">
              <path d={siGithub.path} />
            </svg>
            GitHub
            {starLabel !== null && (
              <span className="flex items-center gap-1 text-foreground/50">
                <StarIcon className="size-3" />
                {starLabel}
              </span>
            )}
          </a>
        </nav>

        {/* Right — copyright */}
        <div className="text-xs text-foreground/50">
          © {new Date().getFullYear()} forja — MIT License
        </div>

      </Container>
    </footer>
  )
}
