import { useNavigate } from "react-router-dom";
import { TYPE_DEFINITIONS, normalizeTypeName } from "./type-definitions";
import { CODE_COLORS, semanticKeyColor, tokenizeSignature, tokenKindToColor } from "./code-colors";

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type TokenKind =
  | "keyword"
  | "type"
  | "primitive"
  | "string"
  | "template"
  | "number"
  | "boolean"
  | "comment"
  | "punctuation"
  | "operator"
  | "queryKey"
  | "opKey"
  | "relKey"
  | "fnCall"
  | "plain";

interface Token {
  value: string;
  kind: TokenKind;
}

const TS_KEYWORDS = new Set([
  "import", "export", "from", "default", "const", "let", "var", "function",
  "async", "await", "return", "new", "class", "extends", "implements",
  "interface", "type", "typeof", "keyof", "readonly", "as", "in", "of",
  "if", "else", "for", "while", "throw", "try", "catch", "finally",
]);

const TS_PRIMITIVES = new Set([
  "string", "number", "boolean", "null", "undefined", "void",
  "never", "Date", "unknown", "any", "object",
]);

const TS_BOOLEANS = new Set(["true", "false", "null", "undefined"]);


function tokenize(code: string): Token[] {
  const result: Token[] = [];
  let i = 0;

  while (i < code.length) {
    // Single-line comment
    if (code[i] === "/" && code[i + 1] === "/") {
      let j = i;
      while (j < code.length && code[j] !== "\n") j++;
      result.push({ value: code.slice(i, j), kind: "comment" });
      i = j;
      continue;
    }

    // Template literal
    if (code[i] === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== "`") {
        if (code[j] === "\\") j++;
        j++;
      }
      result.push({ value: code.slice(i, j + 1), kind: "template" });
      i = j + 1;
      continue;
    }

    // String literal ' or "
    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i];
      let j = i + 1;
      while (j < code.length && code[j] !== quote) {
        if (code[j] === "\\") j++;
        j++;
      }
      result.push({ value: code.slice(i, j + 1), kind: "string" });
      i = j + 1;
      continue;
    }

    // Number
    if (/[0-9]/.test(code[i]!)) {
      let j = i;
      while (j < code.length && /[\d._]/.test(code[j]!)) j++;
      result.push({ value: code.slice(i, j), kind: "number" });
      i = j;
      continue;
    }

    // Word token
    if (/[a-zA-Z_$]/.test(code[i]!)) {
      let j = i;
      while (j < code.length && /[\w$]/.test(code[j]!)) j++;
      const word = code.slice(i, j);

      // Peek ahead for function call: word(
      const isCall = code[j] === "(";

      let kind: TokenKind;
      if (TS_BOOLEANS.has(word)) {
        kind = "boolean";
      } else if (TS_KEYWORDS.has(word)) {
        kind = "keyword";
      } else if (TS_PRIMITIVES.has(word)) {
        kind = "primitive";
      } else if (isCall) {
        kind = "fnCall";
      } else if (/^[A-Z]/.test(word)) {
        kind = "type";
      } else {
        kind = "plain";
      }

      result.push({ value: word, kind });
      i = j;
      continue;
    }

    // Punctuation
    if (/[{}()[\]<>;,.:!?|&=+\-*/%^~]/.test(code[i]!)) {
      result.push({ value: code[i]!, kind: "punctuation" });
      i++;
      continue;
    }

    // Whitespace / newlines / everything else
    result.push({ value: code[i]!, kind: "plain" });
    i++;
  }

  return result;
}

function tokenColor(kind: TokenKind): string {
  switch (kind) {
    case "keyword":     return CODE_COLORS.keyword;
    case "type":        return CODE_COLORS.type;
    case "primitive":   return CODE_COLORS.primitive;
    case "string":      return CODE_COLORS.string;
    case "template":    return CODE_COLORS.string;
    case "number":      return CODE_COLORS.number;
    case "boolean":     return CODE_COLORS.boolean;
    case "comment":     return CODE_COLORS.comment;
    case "punctuation": return CODE_COLORS.punctuation;
    case "fnCall":      return CODE_COLORS.fnName;
    case "operator":    return CODE_COLORS.punctuation;
    case "plain":       return CODE_COLORS.plain;
  }
}

// ─── Token renderer ───────────────────────────────────────────────────────────

function TokenSpan({ token }: { token: Token }): React.ReactElement {
  const navigate = useNavigate();
  const color = tokenColor(token.kind);

  // Check if this token is a hoverable type
  if (token.kind === "type" || token.kind === "primitive") {
    const key = normalizeTypeName(token.value);
    const definition = TYPE_DEFINITIONS[key];

    if (definition) {
      return (
        <HoverableToken
          value={token.value}
          color={color}
          definition={definition}
          navigate={navigate}
        />
      );
    }
  }

  // Plain words: check if they have semantic meaning (query/op/rel keys)
  if (token.kind === "plain") {
    const semantic = semanticKeyColor(token.value);
    if (semantic !== CODE_COLORS.objectKey) {
      return <span style={{ color: semantic }}>{token.value}</span>;
    }
  }

  return <span style={{ color }}>{token.value}</span>;
}

// ─── Hoverable token ──────────────────────────────────────────────────────────

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { TypeDefinition } from "./type-definitions";

interface HoverableTokenProps {
  value: string;
  color: string;
  definition: TypeDefinition;
  navigate: ReturnType<typeof useNavigate>;
}

function HoverableToken({ value, color, definition, navigate }: HoverableTokenProps): React.ReactElement {
  const [coords, setCoords] = useState<{ top: number; left: number; openUpward: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  function handleMouseEnter(): void {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const openUpward = rect.top > window.innerHeight / 2;
    setCoords({
      top: openUpward ? rect.top + window.scrollY : rect.bottom + window.scrollY,
      left: rect.left + window.scrollX,
      openUpward,
    });
  }

  function handleClick(): void {
    if (definition.docsPath) navigate(definition.docsPath);
  }

  const tooltip = coords ? createPortal(
    <div
      className="absolute z-[9999] w-96 rounded-lg shadow-2xl font-mono text-xs"
      style={{
        top: coords.openUpward ? undefined : coords.top + 6,
        bottom: coords.openUpward ? window.innerHeight - coords.top + window.scrollY + 6 : undefined,
        left: Math.min(coords.left, window.innerWidth - 400),
        backgroundColor: "#18181b",
        border: "1px solid #3f3f46",
      }}
    >
      <pre style={{ color: "#e4e4e7", margin: 0 }} className="px-4 pt-3 pb-2 whitespace-pre-wrap break-words leading-relaxed">
        {tokenizeSignature(definition.signature).map((t, i) => (
          <span key={i} style={{ color: tokenKindToColor(t.kind) }}>{t.value}</span>
        ))}
      </pre>
      <div style={{ borderTop: "1px solid #3f3f46", backgroundColor: "#18181b" }} className="px-4 pb-3 pt-2 rounded-b-lg">
        {definition.description && (
          <p style={{ color: "#a1a1aa" }} className="font-sans text-xs leading-relaxed whitespace-normal">
            {definition.description}
          </p>
        )}
        {definition.docsPath && (
          <p className="mt-2 font-sans text-xs" style={{ color: "#60a5fa" }}>click to view docs →</p>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <span ref={ref} className="relative inline">
      <span
        style={{ color, cursor: definition.docsPath ? "pointer" : "help" }}
        className="underline decoration-dotted underline-offset-2"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setCoords(null)}
        onClick={handleClick}
      >
        {value}
      </span>
      {tooltip}
    </span>
  );
}

// ─── Pre / Code override ──────────────────────────────────────────────────────

interface PreProps {
  children?: React.ReactNode;
}

/**
 * Drop-in replacement for <pre> in MDX.
 * Detects language from className (e.g. "language-typescript") and renders
 * with syntax highlighting + hoverable type tooltips.
 */
export function DocsCodeBlock({ children }: PreProps): React.ReactElement {
  // MDX renders <pre><code className="language-ts">...</code></pre>
  const codeEl = children as React.ReactElement<{ className?: string; children?: string }>;
  const className = codeEl?.props?.className ?? "";
  const rawCode = codeEl?.props?.children ?? "";

  const isTs = className.includes("typescript") || className.includes("ts") || className.includes("tsx");

  if (!isTs || typeof rawCode !== "string") {
    // Fallback: plain pre block
    return (
      <pre className="rounded-lg bg-zinc-950 border border-zinc-800 px-5 py-4 font-mono text-sm leading-7 overflow-x-auto">
        {children}
      </pre>
    );
  }

  const tokens = tokenize(rawCode.trimEnd());

  return (
    <pre className="rounded-lg border font-mono text-sm leading-7 overflow-x-auto px-5 py-4"
      style={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
    >
      <code>
        {tokens.map((token, i) => (
          <TokenSpan key={i} token={token} />
        ))}
      </code>
    </pre>
  );
}
