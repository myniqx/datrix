"use client"

import { useState } from "react"

interface GridParams {
  perspective: number
  rotateX: number
  rotateY: number
  rotateZ: number
  scale: number
  translateY: number
  opacity: number
  gridSize: number
}

const defaults: GridParams = {
  perspective: 695,
  rotateX: -10,
  rotateY: -30,
  scale: 1.5,
  translateY: -15,
  opacity: 0.3,
  gridSize: 45,
  rotateZ: 10,
}

export function GridDebugPanel() {
  const [params, setParams] = useState<GridParams>(defaults)
  const [open, setOpen] = useState(true)

  const set = (key: keyof GridParams) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setParams((p) => ({ ...p, [key]: parseFloat(e.target.value) }))

  const transform = `perspective(${params.perspective}px) rotateX(${params.rotateX}deg) rotateY(${params.rotateY}deg) rotateZ(${params.rotateZ}deg) scale(${params.scale}) translateY(${params.translateY}%)`

  return (
    <>
      {/* Grid preview */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(to right, var(--color-border) 1px, transparent 1px),
              linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)
            `,
            backgroundSize: `${params.gridSize}px ${params.gridSize}px`,
            opacity: params.opacity,
            transform,
            transformOrigin: "center top",
            maskImage: "linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)",
          }}
        />
      </div>

      {/* Panel */}
      <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-border bg-card text-xs shadow-xl">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 font-mono text-muted-foreground hover:text-foreground"
        >
          <span>grid debug</span>
          <span>{open ? "▲" : "▼"}</span>
        </button>

        {open && (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
            {(
              [
                ["perspective", 200, 3000, 1],
                ["rotateX", -90, 90, 1],
                ["rotateY", -90, 90, 1],
                ["rotateZ", -180, 180, 1],
                ["scale", 0.5, 5, 0.05],
                ["translateY", -50, 100, 1],
                ["opacity", 0, 1, 0.01],
                ["gridSize", 20, 200, 2],
              ] as [keyof GridParams, number, number, number][]
            ).map(([key, min, max, step]) => (
              <div key={key} className="flex flex-col gap-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>{key}</span>
                  <span className="font-mono">{params[key]}</span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={params[key]}
                  onChange={set(key)}
                  className="w-full accent-primary"
                />
              </div>
            ))}

            <button
              onClick={() => {
                const css = `perspective(${params.perspective}px) rotateX(${params.rotateX}deg) rotateY(${params.rotateY}deg) scale(${params.scale}) translateY(${params.translateY}%)`
                navigator.clipboard.writeText(JSON.stringify(params, null, 2))
              }}
              className="mt-1 rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"
            >
              copy values
            </button>
          </div>
        )}
      </div>
    </>
  )
}
