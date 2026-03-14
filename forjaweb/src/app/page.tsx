import { Navbar } from "@/components/layout/navbar"
import { Section } from "@/components/layout/section"
import { Container } from "@/components/layout/container"
import { Hero } from "@/components/sections/hero"
import { Playground } from "@/components/sections/playground"
import { Features } from "@/components/sections/features"

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Section id="hero" className="p-0">
          <Hero />
        </Section>

        <Section id="playground" className="min-h-0 py-24">
          <Container>
            <div className="mb-12 flex flex-col items-center gap-4 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                See it in action
              </h2>
              <p className="max-w-xl text-base text-muted-foreground">
                Real queries, real output. Browse CRUD operations and explore how Forja handles relations, filters, and nested queries.
              </p>
            </div>
            <Playground />
          </Container>
        </Section>

        <Section id="features" className="min-h-0">
          <Features />
        </Section>

        <Section id="packages">
          <Container>
            <p className="text-muted-foreground">Packages section — yakında</p>
          </Container>
        </Section>
      </main>
    </>
  )
}
