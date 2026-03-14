"use client"

import { useState } from "react"
import type { OrbControls } from "./hero-orb"

interface OrbDebugPanelProps {
  controlsRef: React.RefObject<OrbControls | null>
}

// [uniform key, label, min, max, step, default]
type SliderDef = [string, string, number, number, number, number]

const SLIDERS: SliderDef[] = [
  ["uWaveSpeed", "wave speed", 0.1, 4.0, 0.01, 1.4],
  ["uWaveWidth", "wave width", 0.0, 1.5, 0.01, 0.4],
  ["uWavePeriod", "wave period", 0.5, 8.0, 0.1, 3.5],
  ["uWave2Speed", "wave2 speed", 0.1, 4.0, 0.01, 1.26],
  ["uWave2Width", "wave2 width", 0.0, 1.5, 0.01, 0.48],
  ["uDotSizeBase", "dot size base", 0.5, 6.0, 0.1, 2.2],
  ["uDotSizeWave1", "dot size wave1", 0.0, 8.0, 0.1, 2.8],
  ["uDotSizeWave2", "dot size wave2", 0.0, 8.0, 0.1, 2.0],
  ["uDotSizeCollision", "dot size coll.", 0.0, 12.0, 0.1, 5.0],
  ["uAlphaBase", "alpha base", 0.0, 1.0, 0.01, 0.72],
  ["uAlphaWave", "alpha wave", 0.0, 1.0, 0.01, 0.25],
  ["uAlphaCollision", "alpha collision", 0.0, 1.0, 0.01, 0.4],
  ["uDisplaceWave1", "displace wave1", 0.0, 0.5, 0.01, 0.09],
  ["uDisplaceWave2", "displace wave2", 0.0, 0.5, 0.01, 0.06],
]

export function OrbDebugPanel({ controlsRef }: OrbDebugPanelProps) {
  const [open, setOpen] = useState(true)
  const [paused, setPaused] = useState(false)
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(SLIDERS.map(([key, , , , , def]) => [key, def]))
  )
  const [time, setTimeState] = useState(0)
  const [rotX, setRotX] = useState(0)
  const [rotY, setRotY] = useState(0)
  const [rotZ, setRotZ] = useState(0)

  const getUniform = (key: string): number => {
    return controlsRef.current?.material?.uniforms[key]?.value ?? 0
  }

  const setUniform = (key: string, val: number) => {
    if (controlsRef.current?.material) {
      controlsRef.current.material.uniforms[key].value = val
    }
    setValues((prev) => ({ ...prev, [key]: val }))
  }

  const handleOpen = () => {
    if (!open) {
      // Paneli açarken mevcut uniform değerlerini oku
      const current = Object.fromEntries(
        SLIDERS.map(([key]) => [key, getUniform(key)])
      )
      setValues(current)
    }
    setOpen((o) => !o)
  }

  const togglePause = () => {
    if (paused) {
      controlsRef.current?.resume()
    } else {
      controlsRef.current?.pause()
    }
    setPaused((p) => !p)
  }

  const resetDefaults = () => {
    const defaults = Object.fromEntries(SLIDERS.map(([key, , , , , def]) => [key, def]))
    setValues(defaults)
    if (controlsRef.current?.material) {
      SLIDERS.forEach(([key, , , , , def]) => {
        controlsRef.current!.material!.uniforms[key].value = def
      })
    }
  }

  const exportPng = () => {
    const canvas = controlsRef.current?.getCanvas()
    if (!canvas) return
    const url = canvas.toDataURL("image/png")
    const a = document.createElement("a")
    a.href = url
    a.download = "forja-orb.png"
    a.click()
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 rounded-xl border border-border bg-card text-xs shadow-xl">
      <button
        onClick={handleOpen}
        className="flex w-full items-center justify-between px-4 py-3 font-mono text-muted-foreground hover:text-foreground"
      >
        {open && <span>orb debug</span>}
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 w-72 max-h-128 overflow-y-auto">
          {/* Controls */}
          <div className="flex gap-2">
            <button
              onClick={togglePause}
              className="flex-1 rounded-lg border border-border px-2 py-1.5 text-muted-foreground hover:text-foreground"
            >
              {paused ? "▶ resume" : "⏸ pause"}
            </button>
            <button
              onClick={exportPng}
              className="flex-1 rounded-lg border border-border px-2 py-1.5 text-muted-foreground hover:text-foreground"
            >
              ↓ png
            </button>
            <button
              onClick={resetDefaults}
              className="flex-1 rounded-lg border border-border px-2 py-1.5 text-muted-foreground hover:text-foreground"
            >
              ↺ reset
            </button>
          </div>

          {/* Time & Rotation */}
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <div className="flex justify-between text-muted-foreground">
              <span>time</span>
              <span className="font-mono">{time.toFixed(2)}</span>
            </div>
            <input type="range" min={0} max={20} step={0.01} value={time}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setTimeState(v)
                controlsRef.current?.setTime(v)
              }}
              className="w-full accent-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-muted-foreground">
              <span>rotation X</span>
              <span className="font-mono">{rotX.toFixed(2)}</span>
            </div>
            <input type="range" min={-Math.PI} max={Math.PI} step={0.01} value={rotX}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setRotX(v)
                controlsRef.current?.setRotation(v, rotY, rotZ)
              }}
              className="w-full accent-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-muted-foreground">
              <span>rotation Y</span>
              <span className="font-mono">{rotY.toFixed(2)}</span>
            </div>
            <input type="range" min={-Math.PI} max={Math.PI} step={0.01} value={rotY}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setRotY(v)
                controlsRef.current?.setRotation(rotX, v, rotZ)
              }}
              className="w-full accent-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-muted-foreground">
              <span>rotation Z</span>
              <span className="font-mono">{rotZ.toFixed(2)}</span>
            </div>
            <input type="range" min={-Math.PI} max={Math.PI} step={0.01} value={rotZ}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                setRotZ(v)
                controlsRef.current?.setRotation(rotX, rotY, v)
              }}
              className="w-full accent-primary"
            />
          </div>

          {/* Uniform Sliders */}
          <div className="border-t border-border pt-2" />
          {SLIDERS.map(([key, label, min, max, step]) => (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex justify-between text-muted-foreground">
                <span>{label}</span>
                <span className="font-mono">{values[key]?.toFixed(2) ?? "—"}</span>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={values[key] ?? 0}
                onChange={(e) => setUniform(key, parseFloat(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
