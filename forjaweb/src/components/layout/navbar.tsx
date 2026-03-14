import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Container } from "./container"
import { ForjaLogo } from "./logo"

export function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between">
        {/* Sol — logo + isim + version */}
        <div className="flex items-center gap-3">
          <div className="text-primary">
            <ForjaLogo size={28} />
          </div>
          <span className="text-lg font-bold text-foreground">forja</span>
          <Badge variant="outline" className="text-xs px-1.5 py-0">v0.1</Badge>
        </div>

        {/* Sağ — nav + CTA */}
        <div className="flex items-center gap-6">
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="/docs" className="hover:text-foreground transition-colors">Docs</a>
            <a href="/packages" className="hover:text-foreground transition-colors">Packages</a>
            <a href="https://github.com" className="hover:text-foreground transition-colors">GitHub</a>
          </nav>
          <Button size="sm">Get Started</Button>
        </div>
      </Container>
    </header>
  )
}
