import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HeroOrb } from "./hero-orb"
import { GridDebugPanel } from "@/components/layout/grid-debug-panel"

export function Hero() {
  return (
    <div className="relative grid min-h-screen w-full grid-cols-2 items-center overflow-hidden">
      <GridDebugPanel />

      {/* Sol — içerik */}
      <div
        className="relative z-10 flex flex-col items-start gap-6 pl-42"
        style={{
          transform: "perspective(1000px) rotateY(8deg) rotateX(2deg) translateZ(150px) scale(1.02)",
        }}
      >
        <Badge variant="outline">v0.1 — Early Preview</Badge>

        <h1 className="text-6xl font-bold leading-tight tracking-tight text-foreground">
          TypeScript-first<br />
          database framework
        </h1>

        <p className="text-lg text-muted-foreground leading-relaxed">
          Strapi-like flexibility without the overhead.
          Schema-driven, type-safe, and built to integrate
          into your existing stack.
        </p>

        <div className="flex items-center gap-3">
          <Button size="lg">Get Started</Button>
          <Button size="lg" variant="outline">View on GitHub</Button>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-2.5 font-mono text-sm text-muted-foreground">
          <span className="text-primary">$</span>
          <span>npm install @forja/core</span>
        </div>
      </div>

      {/* Sağ — orb */}

      <div style={{ width: "960px", height: "960px", position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)" }}>
        <HeroOrb />
      </div>

    </div>
  )
}
