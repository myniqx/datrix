import { useEffect, useRef, useState } from "react"
import { Outlet, useLocation, Link } from "react-router-dom"
import { DocsNavbar } from "@/components/layout/docs-navbar"
import { buildDocNav, getDocModule } from "@/docs/use-doc-nav"
import type { TocItem } from "@/lib/remark-toc-export"

const NAV_SECTIONS = buildDocNav()

// --- Sidebar ---

function SidebarLink({ slug, title, currentSlug }: { slug: string; title: string; currentSlug: string }) {
  return (
    <Link
      to={`/docs/${slug}`}
      className={`text-sm px-2 py-1.5 rounded-md transition-colors ${
        currentSlug === slug
          ? "bg-muted text-foreground font-medium"
          : "text-foreground/70 hover:text-foreground hover:bg-muted/60"
      }`}
    >
      {title}
    </Link>
  )
}

function DocsSidebar({ currentSlug }: { currentSlug: string }) {
  return (
    <aside className="hidden md:block w-60 shrink-0 border-r border-border/40 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto pt-8 pr-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title || "__root__"} className="mb-6">
          {section.title && (
            section.slug ? (
              <SidebarLink slug={section.slug} title={section.title} currentSlug={currentSlug} />
            ) : (
              <p className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-2 px-2">
                {section.title}
              </p>
            )
          )}
          {section.items.length > 0 && (
            <nav className="flex flex-col gap-0.5 mt-0.5 ml-2">
              {section.items.map((item) => (
                <SidebarLink key={item.slug} slug={item.slug} title={item.title} currentSlug={currentSlug} />
              ))}
            </nav>
          )}
        </div>
      ))}
    </aside>
  )
}

// --- TOC ---

function DocsToc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>("")
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect()

    const headings = document.querySelectorAll<HTMLElement>("article h1, article h2, article h3")

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
            break
          }
        }
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0 },
    )

    headings.forEach((el) => observerRef.current!.observe(el))

    return () => observerRef.current?.disconnect()
  }, [items])

  // Only show h2 and h3, skip h1 (page title)
  const visible = items.filter((item) => item.depth === 2 || item.depth === 3)

  if (visible.length === 0) return null

  return (
    <aside className="hidden xl:block w-52 shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] overflow-y-auto pt-8 pl-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground/40 mb-3">
        On this page
      </p>
      <nav className="flex flex-col gap-0.5">
        {visible.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`text-sm py-0.5 transition-colors ${
              item.depth === 3 ? "pl-3" : ""
            } ${
              activeId === item.id
                ? "text-foreground font-medium"
                : "text-foreground/50 hover:text-foreground"
            }`}
          >
            {item.text}
          </a>
        ))}
      </nav>
    </aside>
  )
}

// --- Routing ---

function useCurrentSlug(): string {
  const { pathname } = useLocation()
  const match = pathname.match(/^\/docs\/(.+)$/)
  if (!match) {
    const first = NAV_SECTIONS[0]
    return first?.slug ?? first?.items[0]?.slug ?? "getting-started"
  }
  const slug = match[1]
  const directMod = getDocModule(slug)
  if (directMod) return slug
  const indexMod = getDocModule(`${slug}/index`)
  return indexMod ? `${slug}/index` : slug
}

// --- Layout ---

export function DocsLayout() {
  const currentSlug = useCurrentSlug()
  const mod = getDocModule(currentSlug)
  const toc = mod?.toc ?? []

  return (
    <div className="min-h-screen">
      <DocsNavbar />
      <div className="flex w-full px-6 pt-14">
        <DocsSidebar currentSlug={currentSlug} />
        <main className="min-w-0 flex-1 px-8 py-8">
          <Outlet />
        </main>
        <DocsToc items={toc} />
      </div>
    </div>
  )
}

// --- Content ---

export default function DocsContent() {
  const currentSlug = useCurrentSlug()
  const mod = getDocModule(currentSlug)
  const DocComponent = mod?.default

  return (
    <article className="prose prose-invert max-w-3xl">
      {DocComponent ? <DocComponent /> : (
        <p className="text-foreground/50">Page not found.</p>
      )}
    </article>
  )
}
