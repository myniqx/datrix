import { Container } from "./container"

export function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between">
        <span className="text-lg font-bold text-foreground">forja</span>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href="/docs" className="hover:text-foreground transition-colors">Docs</a>
          <a href="/packages" className="hover:text-foreground transition-colors">Packages</a>
          <a href="https://github.com" className="hover:text-foreground transition-colors">GitHub</a>
        </nav>
      </Container>
    </header>
  )
}
