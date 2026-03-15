import Link from "next/link"
import { Container } from "@/components/layout/container"
import { Card, CardContent } from "@/components/ui/card"
import { CopyButton } from "@/components/ui/copy-button"
import { FORJA_PACKAGES } from "@/data/constants"

export function Packages() {
  return (
    <Container className="py-24">
      <div className="mb-16 flex flex-col items-center gap-4 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          Packages
        </h2>
        <p className="max-w-xl text-base text-muted-foreground">
          Forja is modular. Install only what you need.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {FORJA_PACKAGES.map((pkg) => (
          <Card key={pkg.name}>
            <CardContent className="flex flex-col gap-3 pt-5 pb-4">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={pkg.npm}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs font-semibold text-primary hover:underline truncate"
                >
                  {pkg.name}
                </Link>
                <CopyButton text={`npm install ${pkg.name}`} />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {pkg.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </Container>
  )
}
