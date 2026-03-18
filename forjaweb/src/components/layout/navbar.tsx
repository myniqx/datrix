import { StarIcon } from "lucide-react"
import { siGithub } from "simple-icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Container } from "./container"
import { ForjaLogo } from "./logo"
import { NavbarMobile } from "./navbar-mobile"
import { FORJA_VERSION, FORJA_GITHUB_URL } from "@/data/constants"

const NAV_LINKS = [
  { label: "Showcase", href: "#showcase" },
  { label: "Features", href: "#features" },
  { label: "Docs", href: "/docs" },
  { label: "Packages", href: "/packages" },
] as const

interface NavbarProps {
  starCount: number | null
}

export function Navbar({ starCount }: NavbarProps): JSX.Element {
  const starLabel = starCount === null
    ? null
    : starCount >= 1000
      ? `${(starCount / 1000).toFixed(1)}k`
      : String(starCount)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between">

        {/* Left — logo + name + version */}
        <a href="/" className="flex items-center gap-3">
          <div className="text-primary">
            <ForjaLogo size={28} />
          </div>
          <span className="text-lg font-bold text-foreground">forja</span>
          <Badge variant="outline" className="px-1.5 py-0 text-xs">{FORJA_VERSION}</Badge>
        </a>

        {/* Desktop — nav + CTA */}
        <div className="hidden items-center gap-2 md:flex">
          <nav className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Button key={link.href} asChild variant="outline" size="sm">
                <a href={link.href}>{link.label}</a>
              </Button>
            ))}
            <Button asChild variant="outline" size="sm">
              <a
                href={FORJA_GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <svg role="img" viewBox="0 0 24 24" className="size-4 fill-current">
                  <path d={siGithub.path} />
                </svg>
                {starLabel !== null ? (
                  <span className="flex items-center gap-1 text-foreground/60">
                    <StarIcon className="size-3" />
                    {starLabel}
                  </span>
                ) : (
                  "GitHub"
                )}
              </a>
            </Button>
          </nav>
          <Button asChild size="sm">
            <a href="/docs">Get Started</a>
          </Button>
        </div>

        {/* Mobile — hamburger */}
        <NavbarMobile starCount={starCount} />

      </Container>
    </header>
  )
}
