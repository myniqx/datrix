import { Container } from "@/components/layout/container"
import {
  DatabaseIcon,
  TerminalIcon,
  PuzzleIcon,
  ShieldIcon,
  GitMergeIcon,
  CodeIcon,
} from "lucide-react"

const FEATURES = [
  {
    icon: CodeIcon,
    title: "Fully Typed",
    description:
      "Schema types are generated via CLI, giving you complete IntelliSense and compile-time safety across queries, relations, and plugins.",
  },
  {
    icon: DatabaseIcon,
    title: "Adapter System",
    description:
      "Swap databases without touching your business logic. PostgreSQL, MySQL, MongoDB, and JSON adapters available out of the box.",
  },
  {
    icon: PuzzleIcon,
    title: "Plugin Architecture",
    description:
      "Extend core functionality through a structured plugin system. REST API, file uploads, and more — only add what you need.",
  },
  {
    icon: ShieldIcon,
    title: "Auth Built-in",
    description:
      "Authentication is integrated directly into the API plugin — JWT and session support without a separate service.",
  },
  {
    icon: TerminalIcon,
    title: "CLI Tooling",
    description:
      "Generate schema types, run migrations, and scaffold new resources from the command line with the Forja CLI.",
  },
  {
    icon: GitMergeIcon,
    title: "Migration System",
    description:
      "Schema changes are tracked and applied through versioned migrations managed entirely via CLI.",
  },
] as const

export function Features() {
  return (
    <Container className="py-24">
      {/* Header */}
      <div className="mb-16 flex flex-col items-center gap-4 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Everything you need, nothing you don't
        </h2>
        <p className="max-w-xl text-base text-muted-foreground">
          Forja is a minimal, type-safe database framework designed to integrate
          into your existing stack — not replace it.
        </p>
      </div>

      {/* Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => {
          const Icon = feature.icon
          return (
            <div
              key={feature.title}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          )
        })}
      </div>
    </Container>
  )
}
