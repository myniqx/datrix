
import { useRef, useMemo, useImperativeHandle } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { OrbDebugPanel } from "./orb-debug-panel"

// --- Orb geometry ---
const LARGE_DOT_COUNT = 4000
const LARGE_RADIUS = 3.8
const LARGE_ORBIT = 1.2

// --- Intro animation ---
const INTRO_DURATION = 0.8
const INTRO_ROT_SPEED = 2.5
const IDLE_ROT_SPEED = 0.15
const IDLE_ROT_X = 0.09
const ORBIT_SPEED = 0.22

export interface OrbControls {
  material: THREE.ShaderMaterial | null
  points: THREE.Points | null
  pause: () => void
  resume: () => void
  getCanvas: () => HTMLCanvasElement | null
  setTime: (t: number) => void
  setRotation: (x: number, y: number, z: number) => void
}

function generateSpherePoints(count: number, radius: number): Float32Array {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = radius * Math.cos(phi)
  }
  return positions
}

function createOrbMaterial(primaryColor: number, accentColor: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uIntro: { value: 0 },
      uWave1Origin: { value: new THREE.Vector3(0.0, 1.0, 0.0) },
      uWave2Origin: { value: new THREE.Vector3(0.6, -0.6, 0.5).normalize() },
      uPrimaryColor: { value: new THREE.Color(primaryColor) },
      uAccentColor: { value: new THREE.Color(accentColor) },
      // Runtime-tunable wave params
      uWaveSpeed: { value: 1.4 },
      uWaveWidth: { value: 0.4 },
      uWavePeriod: { value: 3.5 },
      uWave2Speed: { value: 1.26 },
      uWave2Width: { value: 0.48 },
      // Dot appearance
      uDotSizeBase: { value: 2.2 },
      uDotSizeWave1: { value: 2.8 },
      uDotSizeWave2: { value: 2.0 },
      uDotSizeCollision: { value: 5.0 },
      uAlphaBase: { value: 0.72 },
      uAlphaWave: { value: 0.25 },
      uAlphaCollision: { value: 0.4 },
      // Displacement
      uDisplaceWave1: { value: 0.09 },
      uDisplaceWave2: { value: 0.06 },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uIntro;
      uniform vec3 uWave1Origin;
      uniform vec3 uWave2Origin;
      uniform float uWaveSpeed;
      uniform float uWaveWidth;
      uniform float uWavePeriod;
      uniform float uWave2Speed;
      uniform float uWave2Width;
      uniform float uDotSizeBase;
      uniform float uDotSizeWave1;
      uniform float uDotSizeWave2;
      uniform float uDotSizeCollision;
      uniform float uDisplaceWave1;
      uniform float uDisplaceWave2;

      varying float vWave1;
      varying float vWave2;
      varying float vCollision;

      float ripple(vec3 pos, vec3 origin, float time, float period, float speed, float width) {
        float angularDist = acos(clamp(dot(normalize(pos), normalize(origin)), -1.0, 1.0));
        float waveAngle = mod(time, period) * speed;
        float diff = abs(angularDist - waveAngle);
        return smoothstep(width, 0.0, diff);
      }

      void main() {
        vec3 pos = position;

        float wave1 = ripple(pos, uWave1Origin, uTime, uWavePeriod, uWaveSpeed, uWaveWidth);
        float wave2 = ripple(pos, uWave2Origin, uTime + uWavePeriod * 0.5, uWavePeriod, uWave2Speed, uWave2Width);

        vWave1 = wave1;
        vWave2 = wave2;
        vCollision = pow(wave1 * wave2, 1.5);

        float displacement = (wave1 * uDisplaceWave1 + wave2 * uDisplaceWave2) * uIntro;
        vec3 displaced = normalize(pos) * (length(pos) + displacement);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced * uIntro, 1.0);
        gl_PointSize = (uDotSizeBase + wave1 * uDotSizeWave1 + wave2 * uDotSizeWave2 + vCollision * uDotSizeCollision) * uIntro;
      }
    `,
    fragmentShader: `
      uniform vec3 uPrimaryColor;
      uniform vec3 uAccentColor;
      uniform float uAlphaBase;
      uniform float uAlphaWave;
      uniform float uAlphaCollision;

      varying float vWave1;
      varying float vWave2;
      varying float vCollision;

      void main() {
        vec2 center = gl_PointCoord - 0.5;
        if (length(center) > 0.5) discard;

        float wave = max(vWave1, vWave2);
        vec3 color = mix(uPrimaryColor, uAccentColor, wave);
        color = mix(color, vec3(1.0), vCollision * 0.8);

        float alpha = (uAlphaBase + wave * uAlphaWave + vCollision * uAlphaCollision) * (1.0 - length(center) * 2.0);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })
}

interface LargeOrbMeshProps {
  controlsRef: React.RefObject<OrbControls | null>
}

function LargeOrbMesh({ controlsRef }: LargeOrbMeshProps) {
  const pointsRef = useRef<THREE.Points>(null)
  const groupRef = useRef<THREE.Group>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const clockRef = useRef(0)
  const pausedRef = useRef(false)

  const positions = useMemo(() => generateSpherePoints(LARGE_DOT_COUNT, LARGE_RADIUS), [])
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    return geo
  }, [positions])
  const material = useMemo(() => createOrbMaterial(0x6366f1, 0x8b5cf6), [])

  useImperativeHandle(controlsRef, () => ({
    material: materialRef.current,
    points: pointsRef.current,
    pause: () => { pausedRef.current = true },
    resume: () => { pausedRef.current = false },
    getCanvas: () => {
      const canvas = document.querySelector("canvas")
      return canvas ?? null
    },
    setTime: (t: number) => {
      clockRef.current = t
      if (materialRef.current) materialRef.current.uniforms.uTime.value = t
    },
    setRotation: (x: number, y: number, z: number) => {
      if (pointsRef.current) {
        pointsRef.current.rotation.x = x
        pointsRef.current.rotation.y = y
        pointsRef.current.rotation.z = z
      }
    },
  }))

  useFrame((_, delta) => {
    if (!groupRef.current || !materialRef.current || !pointsRef.current) return
    if (pausedRef.current) return

    clockRef.current += delta
    const t = clockRef.current

    const intro = Math.min(1, t / INTRO_DURATION)
    const introEased = 1 - Math.pow(1 - intro, 3)

    const angle = t * ORBIT_SPEED
    const x = Math.sin(angle) * LARGE_ORBIT
    const y = Math.sin(angle * 0.7) * LARGE_ORBIT * 0.8
    const z = Math.cos(angle) * LARGE_ORBIT * 0.6
    groupRef.current.position.set(x, y, z)

    materialRef.current.uniforms.uIntro.value = introEased
    materialRef.current.uniforms.uTime.value = t

    const rotSpeed = Math.max(IDLE_ROT_SPEED, INTRO_ROT_SPEED * (1 - introEased) + IDLE_ROT_SPEED)
    pointsRef.current.rotation.y += delta * rotSpeed
    pointsRef.current.rotation.x += delta * IDLE_ROT_X
  })

  return (
    <group ref={groupRef}>
      <points ref={pointsRef} geometry={geometry}>
        <primitive ref={materialRef} object={material} attach="material" />
      </points>
    </group>
  )
}

interface HeroOrbProps {
  controlsRef?: React.RefObject<OrbControls | null>
}

export function HeroOrb({ controlsRef }: HeroOrbProps) {
  const internalRef = useRef<OrbControls | null>(null)
  const ref = controlsRef ?? internalRef
  const hidePanel = process.env.NODE_ENV === "production" || true

  return (
    <>
      <Canvas
        gl={{ alpha: true, preserveDrawingBuffer: true }}
        camera={{ position: [0, 0, 11], fov: 65 }}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      >
        <LargeOrbMesh controlsRef={ref} />
      </Canvas>
      {!hidePanel && <OrbDebugPanel controlsRef={ref} />}
    </>
  )
}
