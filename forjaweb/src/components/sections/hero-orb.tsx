"use client"

import { useRef, useMemo } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import * as THREE from "three"

// --- Orb geometry ---
const LARGE_DOT_COUNT = 4000
const LARGE_RADIUS = 3.8
const LARGE_ORBIT = 1.2

// --- Wave behaviour ---
const WAVE_SPEED = 1.4        // radyan/saniye yayılma hızı
const WAVE_WIDTH = 0.4        // dalga cephesinin genişliği (radyan)
const WAVE_PERIOD = 3.5       // dalga tekrar süresi (saniye)

// --- Dot appearance ---
const DOT_SIZE_BASE = 2.2     // sakin durumdaki dot boyutu
const DOT_SIZE_WAVE1 = 2.8    // wave1 cephesinde ekstra boyut
const DOT_SIZE_WAVE2 = 2.0    // wave2 cephesinde ekstra boyut
const DOT_SIZE_COLLISION = 5.0 // çarpışma anında ekstra boyut
const DOT_ALPHA_BASE = 0.72   // sakin durumdaki opaklık
const DOT_ALPHA_WAVE = 0.25   // dalga üstüne eklenen opaklık
const DOT_ALPHA_COLLISION = 0.4 // çarpışma üstüne eklenen opaklık

// --- Displacement ---
const DISPLACE_WAVE1 = 0.09   // dalga1 geçerken radyal şişme
const DISPLACE_WAVE2 = 0.06   // dalga2 geçerken radyal şişme

// --- Intro animation ---
const INTRO_DURATION = 0.8    // saniye
const INTRO_ROT_SPEED = 2.5   // açılış dönüş hızı
const IDLE_ROT_SPEED = 0.15   // sakin dönüş hızı (y ekseni)
const IDLE_ROT_X = 0.09       // sakin dönüş hızı (x ekseni)

// --- Orbit ---
const ORBIT_SPEED = 0.22      // açı/saniye

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
    },
    vertexShader: `
      uniform float uTime;
      uniform float uIntro;
      uniform vec3 uWave1Origin;
      uniform vec3 uWave2Origin;

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

        float wave1 = ripple(pos, uWave1Origin, uTime, ${WAVE_PERIOD.toFixed(1)}, ${WAVE_SPEED.toFixed(1)}, ${WAVE_WIDTH.toFixed(1)});
        float wave2 = ripple(pos, uWave2Origin, uTime + ${(WAVE_PERIOD * 0.5).toFixed(1)}, ${WAVE_PERIOD.toFixed(1)}, ${(WAVE_SPEED * 0.9).toFixed(1)}, ${(WAVE_WIDTH * 1.2).toFixed(1)});

        vWave1 = wave1;
        vWave2 = wave2;
        vCollision = pow(wave1 * wave2, 1.5);

        float displacement = (wave1 * ${DISPLACE_WAVE1.toFixed(2)} + wave2 * ${DISPLACE_WAVE2.toFixed(2)}) * uIntro;
        vec3 displaced = normalize(pos) * (length(pos) + displacement);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced * uIntro, 1.0);
        gl_PointSize = (${DOT_SIZE_BASE.toFixed(1)} + wave1 * ${DOT_SIZE_WAVE1.toFixed(1)} + wave2 * ${DOT_SIZE_WAVE2.toFixed(1)} + vCollision * ${DOT_SIZE_COLLISION.toFixed(1)}) * uIntro;
      }
    `,
    fragmentShader: `
      uniform vec3 uPrimaryColor;
      uniform vec3 uAccentColor;

      varying float vWave1;
      varying float vWave2;
      varying float vCollision;

      void main() {
        vec2 center = gl_PointCoord - 0.5;
        if (length(center) > 0.5) discard;

        float wave = max(vWave1, vWave2);
        vec3 color = mix(uPrimaryColor, uAccentColor, wave);
        color = mix(color, vec3(1.0), vCollision * 0.8);

        float alpha = (${DOT_ALPHA_BASE.toFixed(2)} + wave * ${DOT_ALPHA_WAVE.toFixed(2)} + vCollision * ${DOT_ALPHA_COLLISION.toFixed(2)}) * (1.0 - length(center) * 2.0);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  })
}


function LargeOrbMesh() {
  const pointsRef = useRef<THREE.Points>(null)
  const groupRef = useRef<THREE.Group>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const clockRef = useRef(0)

  const positions = useMemo(() => generateSpherePoints(LARGE_DOT_COUNT, LARGE_RADIUS), [])
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3))
    return geo
  }, [positions])
  const material = useMemo(() => createOrbMaterial(0x6366f1, 0x8b5cf6), [])

  useFrame((_, delta) => {
    if (!groupRef.current || !materialRef.current || !pointsRef.current) return

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

export function HeroOrb() {
  return (
    <Canvas
      camera={{ position: [0, 0, 11], fov: 65 }}
      style={{ width: "100%", height: "100%" }}
    >
      <LargeOrbMesh />
    </Canvas>
  )
}
