import { Navbar } from "@/components/layout/navbar"
import { Section } from "@/components/layout/section"
import { Container } from "@/components/layout/container"
import { Hero } from "@/components/sections/hero"

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <Section id="hero" className="p-0">
          <Hero />
        </Section>

        <Section id="features">
          <Container>
            <p className="text-muted-foreground">Features section — yakında</p>
          </Container>
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
