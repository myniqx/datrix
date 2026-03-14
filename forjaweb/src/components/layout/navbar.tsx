import Link from "next/link"
import { StarIcon, GithubIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Container } from "./container"
import { ForjaLogo } from "./logo"
import { NavbarMobile } from "./navbar-mobile"

async function fetchGithubStars(): Promise<number | null> {
  try {
    const response = await fetch("https://api.github.com/repos/myniqx/forja", {
      next: { revalidate: 3600 }, // revalidate every hour
    })
    if (!response.ok) return null
    const data = await response.json() as { stargazers_count: number }
    return data.stargazers_count
  } catch {
    return null
  }
}

export async function Navbar() {
  const starCount = await fetchGithubStars()

  const starLabel = starCount === null
    ? null
    : starCount >= 1000
      ? `${(starCount / 1000).toFixed(1)}k`
      : String(starCount)

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between">

        {/* Left — logo + name + version */}
        <Link href="/" className="flex items-center gap-3">
          <div className="text-primary">
            <ForjaLogo size={28} />
          </div>
          <span className="text-lg font-bold text-foreground">forja</span>
          <Badge variant="outline" className="px-1.5 py-0 text-xs">v0.1</Badge>
        </Link>

        {/* Desktop — nav + CTA */}
        <div className="hidden items-center gap-6 md:flex">
          <nav className="flex items-center gap-6 text-sm text-foreground/70">
            <Link href="/docs" className="transition-colors hover:text-foreground">
              Docs
            </Link>
            <Link href="/packages" className="transition-colors hover:text-foreground">
              Packages
            </Link>
            <Button asChild variant="outline" size="sm">
              <Link
                href="https://github.com/myniqx/forja"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2"
              >
                <GithubIcon className="size-4" />
                {starLabel !== null ? (
                  <>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <StarIcon className="size-3" />
                      {starLabel}
                    </span>
                  </>
                ) : (
                  "GitHub"
                )}
              </Link>
            </Button>
          </nav>
          <Button asChild size="sm">
            <Link href="/docs">Get Started</Link>
          </Button>
        </div>

        {/* Mobile — hamburger */}
        <NavbarMobile starCount={starCount} />

      </Container>
    </header>
  )
}
