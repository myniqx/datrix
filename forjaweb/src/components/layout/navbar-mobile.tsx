import { MenuIcon, StarIcon, GithubIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ForjaLogo } from "./logo"
import { FORJA_VERSION, FORJA_GITHUB_URL } from "@/data/constants"

interface NavbarMobileProps {
  starCount: number | null
}

export function NavbarMobile({ starCount }: NavbarMobileProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="md:hidden">
          <MenuIcon />
          <span className="sr-only">Menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader className="pb-4">
          <SheetTitle asChild>
            <div className="flex items-center gap-2">
              <div className="text-primary">
                <ForjaLogo size={22} />
              </div>
              <span className="text-base font-bold">forja</span>
              <Badge variant="outline" className="px-1.5 py-0 text-xs">{FORJA_VERSION}</Badge>
            </div>
          </SheetTitle>
        </SheetHeader>

        <nav className="flex flex-col gap-1 px-6">
          <a
            href="#showcase"
            className="rounded-md px-2 py-2 text-sm text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            Showcase
          </a>
          <a
            href="#features"
            className="rounded-md px-2 py-2 text-sm text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            Features
          </a>
          <a
            href="/docs"
            className="rounded-md px-2 py-2 text-sm text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            Docs
          </a>
          <a
            href="/packages"
            className="rounded-md px-2 py-2 text-sm text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            Packages
          </a>
          <a
            href={FORJA_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            <GithubIcon className="size-4" />
            GitHub
            {starCount !== null && (
              <span className="ml-auto flex items-center gap-1 text-xs text-foreground/80">
                <StarIcon className="size-3" />
                {starCount >= 1000
                  ? `${(starCount / 1000).toFixed(1)}k`
                  : starCount}
              </span>
            )}
          </a>
        </nav>

        <div className="mt-4 px-6">
          <Button asChild className="w-full" size="sm">
            <a href="/docs">Get Started</a>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
