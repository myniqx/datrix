export function PerspectiveGrid() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--color-border) 1px, transparent 1px),
            linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          opacity: 0.4,
          transform: "perspective(1600px) rotateX(-45deg) rotateY(15deg) scale(1.5) translateY(10%)",
          transformOrigin: "center top",
          maskImage: "linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)",
        }}
      />
    </div>
  )
}
