import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { Section } from "@/components/layout/section"
import { Container } from "@/components/layout/container"
import { Hero } from "@/components/sections/hero"
import { Playground } from "@/components/sections/playground"
import { Features } from "@/components/sections/features"
import { Frameworks } from "@/components/sections/frameworks"

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Section id="hero" className="p-0">
          <Hero />
        </Section>

        <Section id="showcase" className="min-h-0 py-24">
          <Container>
            <div className="mb-12 flex flex-col gap-4">
              <h2 className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                See it in action
              </h2>
              <p className="text-base text-foreground/80">
                Real queries, real output. Browse CRUD operations and explore how Forja handles relations, filters, and nested queries.
              </p>
            </div>
            <Playground />
          </Container>
        </Section>

        <Section id="features" className="min-h-0">
          <Features />
        </Section>

        <Section id="frameworks" className="min-h-0 py-0">
          <Frameworks />
        </Section>
      </main>
      <Footer />
    </>
  )
}
