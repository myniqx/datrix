import { useState, useRef, useEffect } from "react"
import { CODE_COLORS, semanticKeyColor } from "@/components/docs/code-colors"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Maximize2Icon, Minimize2Icon } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Card } from "@/components/ui/card"
import playgroundData from "@/data/playground.json"

// ─── Types ────────────────────────────────────────────────────────────────────

type ForjaAction =
  | "create" | "createMany"
  | "findMany" | "count"
  | "update" | "updateMany"
  | "delete" | "deleteMany"

interface Scenario {
  id: string
  label: string
  action: ForjaAction
  model: string
  query?: unknown
  data?: unknown
  idArg?: number
  options?: unknown
  output: unknown
}

interface Group {
  id: string
  label: string
  scenarios: Scenario[]
}

interface SchemaField {
  type: string
  required?: boolean
  kind?: string
  model?: string
  [key: string]: unknown
}

interface Schema {
  name: string
  fields: Record<string, SchemaField | undefined>
  [key: string]: unknown
}

const { schemas, groups } = playgroundData as unknown as { schemas: Schema[]; groups: Group[] }

// ─── Code renderer ────────────────────────────────────────────────────────────

// Inline styles from shared CODE_COLORS palette
const S = {
  punct:    { color: "var(--muted-foreground)" },
  queryKey: { color: CODE_COLORS.queryKey },
  opKey:    { color: CODE_COLORS.opKey },
  relKey:   { color: CODE_COLORS.relKey },
  str:      { color: CODE_COLORS.string },
  num:      { color: CODE_COLORS.number },
  bool:     { color: CODE_COLORS.boolean },
  kw:       { color: CODE_COLORS.keyword },
  fn:       { color: CODE_COLORS.fnName },
  model:    { color: CODE_COLORS.modelName },
  obj:      { color: CODE_COLORS.objectKey },
} as const

function CodeArg({ value, indent = 2 }: { value: unknown; indent?: number }) {
  const pad = " ".repeat(indent)
  const innerPad = " ".repeat(indent + 2)

  if (value === null) return <span style={S.kw}>null</span>
  if (value === undefined) return <span style={S.kw}>undefined</span>

  if (typeof value === "string") {
    return <span style={S.str}>&quot;{value}&quot;</span>
  }
  if (typeof value === "number") {
    return <span style={S.num}>{value}</span>
  }
  if (typeof value === "boolean") {
    return <span style={S.bool}>{String(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={S.punct}>{"[]"}</span>
    return (
      <>
        <span style={S.punct}>{"["}</span>{"\n"}
        {value.map((item, i) => (
          <span key={i}>
            {innerPad}<CodeArg value={item} indent={indent + 2} />
            <span style={S.punct}>{i < value.length - 1 ? "," : ""}</span>{"\n"}
          </span>
        ))}
        {pad}<span style={S.punct}>{"]"}</span>
      </>
    )
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span style={S.punct}>{"{}"}</span>
    return (
      <>
        <span style={S.punct}>{"{"}</span>{"\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {innerPad}<span style={{ color: semanticKeyColor(k) }}>{k}</span>
            <span style={S.punct}>{": "}</span>
            <CodeArg value={v} indent={indent + 2} />
            <span style={S.punct}>{i < entries.length - 1 ? "," : ""}</span>{"\n"}
          </span>
        ))}
        {pad}<span style={S.punct}>{"}"}</span>
      </>
    )
  }

  return <span style={S.obj}>{String(value)}</span>
}

function CodeBlock({ scenario }: { scenario: Scenario }) {
  const { action, model, query, data, idArg, options } = scenario

  const fn = <><span style={S.kw}>forja</span><span style={S.punct}>.</span><span style={S.fn}>{action}</span></>
  const mod = <span style={S.model}>&quot;{model}&quot;</span>
  const sep = <span style={S.punct}>{", "}</span>
  const op = <span style={S.punct}>{"("}</span>
  const cl = <span style={S.punct}>{")"}</span>
  const opts = options ? <>{sep}<CodeArg value={options} /></> : null

  return (
    <pre className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed min-h-0">
      <code>
        {fn}{op}
        {(action === "create" || action === "createMany") && <>
          {mod}{sep}<CodeArg value={data} />{opts}
        </>}
        {(action === "findMany" || action === "count") && <>
          {mod}{query ? <>{sep}<CodeArg value={query} /></> : null}{opts}
        </>}
        {action === "update" && <>
          {mod}{sep}<span style={S.num}>{idArg}</span>{sep}<CodeArg value={data} />{opts}
        </>}
        {action === "updateMany" && <>
          {mod}{sep}<CodeArg value={query} />{sep}<CodeArg value={data} />{opts}
        </>}
        {action === "delete" && <>
          {mod}{sep}<span style={S.num}>{idArg}</span>{opts}
        </>}
        {action === "deleteMany" && <>
          {mod}{sep}<CodeArg value={query} />{opts}
        </>}
        {cl}
      </code>
    </pre>
  )
}

// ─── JSON Renderer ────────────────────────────────────────────────────────────

function JsonToken({ value, indent = 0 }: { value: unknown; indent?: number }) {
  const pad = "  ".repeat(indent)
  const innerPad = "  ".repeat(indent + 1)

  if (value === null) return <span style={S.bool}>null</span>
  if (typeof value === "boolean") return <span style={S.bool}>{String(value)}</span>
  if (typeof value === "number") return <span style={S.num}>{value}</span>
  if (typeof value === "string") return <span style={S.str}>&quot;{value}&quot;</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>{"[]"}</span>
    return (
      <span>
        {"[\n"}
        {value.map((item, i) => (
          <span key={i}>
            {innerPad}
            <JsonToken value={item} indent={indent + 1} />
            {i < value.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {pad}{"]"}
      </span>
    )
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span>{"{}"}</span>
    return (
      <span>
        {"{\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {innerPad}
            <span style={S.queryKey}>&quot;{k}&quot;</span>
            {": "}
            <JsonToken value={v} indent={indent + 1} />
            {i < entries.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {pad}{"}"}
      </span>
    )
  }

  return <span>{String(value)}</span>
}

// ─── Schema Viewer ────────────────────────────────────────────────────────────

const FIELD_TYPE_COLORS: Record<string, string> = {
  string:   CODE_COLORS.string,
  number:   CODE_COLORS.number,
  boolean:  CODE_COLORS.boolean,
  date:     CODE_COLORS.queryKey,
  json:     CODE_COLORS.opKey,
  enum:     CODE_COLORS.fnName,
  array:    CODE_COLORS.fnName,
  relation: CODE_COLORS.relKey,
}

function SchemaViewer({ modelName }: { modelName: string }) {
  const [showJson, setShowJson] = useState(false)
  const schema = schemas.find((s) => s.name === modelName)
  if (!schema) return null

  const fields = Object.entries(schema.fields)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schema</span>
        <Badge variant="outline" className="text-xs px-1.5 py-0">{schema.name}</Badge>
        <button
          onClick={() => setShowJson((v) => !v)}
          className={`ml-auto text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${showJson
            ? "border-primary text-primary bg-primary/10"
            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
        >
          {"{ }"}
        </button>
      </div>

      {showJson ? (
        <pre className="text-xs font-mono leading-relaxed">
          <code>
            <span className="text-muted-foreground">{"defineSchema("}</span>
            <JsonToken value={{ name: schema.name, fields: schema.fields }} indent={0} />
            <span className="text-muted-foreground">{")"}</span>
          </code>
        </pre>
      ) : (
        fields.map(([fieldName, def]) => {
          if (!def) return null
          return (
            <div key={fieldName} className="flex items-center gap-2 text-xs font-mono">
              <span className="text-foreground/80 w-32 truncate">{fieldName}</span>
              <span style={{ color: FIELD_TYPE_COLORS[def.type] ?? CODE_COLORS.plain }}>
                {def.type === "relation" ? `→ ${def.model}` : def.type}
              </span>
              {def.required && (
                <span className="text-destructive text-[10px]">required</span>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── Playground ───────────────────────────────────────────────────────────────

const GROUP_COLORS: Record<string, string> = {
  create: "data-[state=active]:text-chart-3 data-[state=active]:border-chart-3",
  read: "data-[state=active]:text-primary data-[state=active]:border-primary",
  update: "data-[state=active]:text-chart-2 data-[state=active]:border-chart-2",
  delete: "data-[state=active]:text-destructive data-[state=active]:border-destructive",
}

export function Playground() {
  const [activeGroup, setActiveGroup] = useState<string>(groups[0]!.id)
  const [activeScenario, setActiveScenario] = useState<string>(groups[0]!.scenarios[0]!.id)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange)
  }, [])

  const currentGroup = groups.find((g) => g.id === activeGroup)!
  const currentScenario = currentGroup.scenarios.find((s) => s.id === activeScenario)
    ?? currentGroup.scenarios[0]!

  function handleGroupChange(groupId: string) {
    setActiveGroup(groupId)
    const group = groups.find((g) => g.id === groupId)!
    setActiveScenario(group.scenarios[0]!.id)
  }

  function toggleFullscreen() {
    if (!isFullscreen) {
      containerRef.current?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  return (
    <Card ref={containerRef} className={`w-full gap-0 p-0 ${isFullscreen ? "flex flex-col h-screen" : ""}`}>

      {/* Header — CRUD tabs */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-muted/30">
        <Tabs value={activeGroup} onValueChange={handleGroupChange}>
          <TabsList className="bg-transparent gap-1 p-0 h-auto">
            {groups.map((group) => (
              <TabsTrigger
                key={group.id}
                value={group.id}
                className={`h-7 px-3 text-xs font-mono border border-transparent rounded-md transition-colors
                  text-muted-foreground hover:text-foreground
                  data-[state=active]:bg-transparent data-[state=active]:shadow-none
                  ${GROUP_COLORS[group.id] ?? ""}`}
              >
                {group.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Scenario dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden sm:block">Select a scenario:</span>
        <Select value={activeScenario} onValueChange={setActiveScenario}>
          <SelectTrigger className="h-7 w-52 text-xs font-mono border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="w-52" container={containerRef.current}>
            {currentGroup.scenarios.map((scenario) => (
              <SelectItem key={scenario.id} value={scenario.id} className="text-xs font-mono">
                {scenario.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
          <Button variant="ghost" size="icon-sm" onClick={toggleFullscreen} className="shrink-0">
            {isFullscreen ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* Body — code | output, fixed height */}
      <div className={`grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border ${isFullscreen ? "flex-1 min-h-0" : "h-[480px]"}`}>

        {/* Left — code + schema */}
        <div className="flex flex-col h-full min-h-0">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Query</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{currentScenario.action}</Badge>
          </div>
          <CodeBlock scenario={currentScenario} />
          <Separator className="shrink-0" />
          <div className={`shrink-0 overflow-auto p-4 ${isFullscreen ? "h-1/2" : "h-44"}`}>
            <SchemaViewer modelName={currentScenario.model} />
          </div>
        </div>

        {/* Right — output */}
        <div className="flex flex-col h-full min-h-0">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Output</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{currentScenario.model}</Badge>
          </div>
          <pre className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed min-h-0">
            <code>
              <JsonToken value={currentScenario.output} />
            </code>
          </pre>
        </div>

      </div>
    </Card>
  )
}
