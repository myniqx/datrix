import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HeroOrb } from "./hero-orb"
import { GridDebugPanel } from "@/components/layout/grid-debug-panel"

export function Hero() {

  return (
    <div className="relative min-h-screen w-full overflow-hidden lg:grid lg:grid-cols-2 lg:items-center">
      <GridDebugPanel />

      {/* Orb — mobile: fullscreen background, desktop: absolute right */}
      <div className="absolute inset-0 z-0 lg:inset-auto lg:right-2.5 lg:top-1/2 lg:-translate-y-1/2 lg:size-240">
        <HeroOrb />
      </div>

      {/* Content — desktop: left grid column, 4K: capped with padding */}
      <div className="relative z-10 flex min-h-screen items-center justify-center lg:min-h-0 lg:justify-start">
        <div
          className="flex w-full max-w-2xl flex-col items-center gap-6 px-8 text-center lg:items-start lg:py-0 lg:text-left lg:transform-[perspective(1000px)_rotateY(8deg)_rotateX(2deg)_translateZ(150px)_translateX(40px)_scale(1.02)]"
        >
          <Badge variant="outline">v0.1 — Early Preview</Badge>

          <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground lg:text-6xl">
            TypeScript-first<br />
            database framework
          </h1>

          <p className="text-base text-muted-foreground leading-relaxed lg:text-lg">
            Strapi-like flexibility without the overhead.
            Schema-driven, type-safe, and built to integrate
            into your existing stack.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg">Get Started</Button>
            <Button size="lg" variant="outline">View on GitHub</Button>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-2.5 font-mono text-sm text-muted-foreground">
            <span className="text-primary">$</span>
            <span>npm install @forja/core</span>
          </div>
        </div>
      </div>
    </div>
  )
}
