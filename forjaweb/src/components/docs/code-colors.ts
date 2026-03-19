/**
 * Shared color palette for all code rendering components.
 * Used by: TypeTooltip, TypedSignature, Playground (CodeArg, JsonToken)
 */

export const CODE_COLORS = {
  keyword:     "#c792ea", // purple  — interface, type, extends, readonly
  type:        "#82aaff", // blue    — PascalCase type names
  primitive:   "#ffcb6b", // yellow  — string, number, boolean, null, Date
  string:      "#c3e88d", // green   — string literal values "foo"
  number:      "#f9a06a", // orange  — number values
  boolean:     "#f87171", // red     — boolean / null / undefined values
  punctuation: "#89ddff", // cyan    — { } ( ) [ ] < > : ; , | &
  comment:     "#637777", // gray    — // comments
  plain:       "#e4e4e7", // white   — everything else

  // Semantic — query structure
  queryKey:    "#67e8f9", // cyan    — where, populate, select, orderBy, limit, offset
  opKey:       "#818cf8", // indigo  — $eq, $gt, $and, $or etc.
  relKey:      "#f472b6", // pink    — connect, disconnect, set
  fnName:      "#fde047", // yellow  — method names (forja.findMany etc.)
  modelName:   "#86efac", // green   — model name strings
  objectKey:   "#94a3b8", // slate   — generic object keys
} as const

export type CodeColor = keyof typeof CODE_COLORS

/**
 * Semantic key color for query/operator/relation keys.
 * Used by CodeArg in playground.
 */
const QUERY_KEYS = new Set(["where", "populate", "select", "orderBy", "limit", "offset", "data", "query"])
const OP_KEYS    = new Set(["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$like", "$ilike", "$and", "$or", "$not"])
const REL_KEYS   = new Set(["connect", "disconnect", "set"])

export function semanticKeyColor(key: string): string {
  if (QUERY_KEYS.has(key)) return CODE_COLORS.queryKey
  if (OP_KEYS.has(key))    return CODE_COLORS.opKey
  if (REL_KEYS.has(key))   return CODE_COLORS.relKey
  return CODE_COLORS.objectKey
}

/**
 * TypeScript signature tokenizer.
 * Splits a TS type string into colored tokens for rendering.
 */
export type TokenKind = "keyword" | "type" | "primitive" | "string" | "punctuation" | "plain"

export interface SyntaxToken {
  value: string
  kind: TokenKind
}

const TS_KEYWORDS  = new Set(["interface", "type", "extends", "readonly", "export", "import", "keyof"])
const TS_PRIMITIVES = new Set(["string", "number", "boolean", "null", "undefined", "void", "never", "Date", "unknown"])

export function tokenizeSignature(input: string): SyntaxToken[] {
  const result: SyntaxToken[] = []
  let i = 0

  while (i < input.length) {
    // String literals: "asc" | "desc"
    if (input[i] === '"') {
      let j = i + 1
      while (j < input.length && input[j] !== '"') j++
      result.push({ value: input.slice(i, j + 1), kind: "string" })
      i = j + 1
      continue
    }

    // Word tokens
    if (/[a-zA-Z_$]/.test(input[i]!)) {
      let j = i
      while (j < input.length && /[\w$]/.test(input[j]!)) j++
      const word = input.slice(i, j)
      const kind: TokenKind = TS_KEYWORDS.has(word)
        ? "keyword"
        : TS_PRIMITIVES.has(word)
          ? "primitive"
          : /^[A-Z]/.test(word)
            ? "type"
            : "plain"
      result.push({ value: word, kind })
      i = j
      continue
    }

    // Punctuation
    if (/[{}()[\]<>|&:;,?.=]/.test(input[i]!)) {
      result.push({ value: input[i]!, kind: "punctuation" })
      i++
      continue
    }

    // Spaces, newlines, everything else
    result.push({ value: input[i]!, kind: "plain" })
    i++
  }

  return result
}

export function tokenKindToColor(kind: TokenKind): string {
  switch (kind) {
    case "keyword":     return CODE_COLORS.keyword
    case "type":        return CODE_COLORS.type
    case "primitive":   return CODE_COLORS.primitive
    case "string":      return CODE_COLORS.string
    case "punctuation": return CODE_COLORS.punctuation
    case "plain":       return CODE_COLORS.plain
  }
}
