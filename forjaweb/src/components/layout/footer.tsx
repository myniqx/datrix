import Link from "next/link"
import { StarIcon } from "lucide-react"
import { siGithub } from "simple-icons"
import { Container } from "./container"
import { ForjaLogo } from "./logo"
import { FORJA_VERSION, FORJA_GITHUB_URL, FORJA_GITHUB_REPO } from "@/data/constants"

async function fetchGithubStars(): Promise<number | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${FORJA_GITHUB_REPO}`, {
      next: { revalidate: 3600 },
    })
    if (!response.ok) return null
    const data = await response.json() as { stargazers_count: number }
    return data.stargazers_count
  } catch {
    return null
  }
}

const NAV_LINKS = [
  { label: "Showcase", href: "#showcase" },
  { label: "Features", href: "#features" },
  { label: "Docs", href: "/docs" },
  { label: "Packages", href: "/packages" },
] as const

export async function Footer() {
  const starCount = await fetchGithubStars()

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
            <Link key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
          <Link
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
          </Link>
        </nav>

        {/* Right — copyright */}
        <div className="text-xs text-foreground/50">
          © {new Date().getFullYear()} forja — MIT License
        </div>

      </Container>
    </footer>
  )
}
