import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { TYPE_DEFINITIONS, normalizeTypeName } from "./type-definitions";
import { tokenizeSignature, tokenKindToColor } from "./code-colors";

interface TypeTooltipProps {
  token: string;
  colorClass?: string;
}

interface TooltipCoords {
  top: number;
  left: number;
  openUpward: boolean;
}

export function TypeTooltip({ token, colorClass }: TypeTooltipProps): React.ReactElement {
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const navigate = useNavigate();

  const key = normalizeTypeName(token);
  const definition = TYPE_DEFINITIONS[key];
  const color = colorClass ?? (isPrimitive(key) ? "text-blue-400" : "text-emerald-400");

  if (!definition) {
    return <span className={color}>{token}</span>;
  }

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
    if (definition?.docsPath) {
      navigate(definition.docsPath);
    }
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
      <pre
        style={{ color: "#e4e4e7", margin: 0 }}
        className="px-4 pt-3 pb-2 whitespace-pre-wrap break-words leading-relaxed"
      >
        {colorizeSignature(definition.signature)}
      </pre>
      <div
        style={{ borderTop: "1px solid #3f3f46", backgroundColor: "#18181b" }}
        className="px-4 pb-3 pt-2 rounded-b-lg"
      >
        {definition.description && (
          <p style={{ color: "#a1a1aa" }} className="font-sans text-xs leading-relaxed whitespace-normal">
            {definition.description}
          </p>
        )}
        {definition.docsPath && (
          <p className="mt-2 font-sans text-xs" style={{ color: "#60a5fa" }}>
            click to view docs →
          </p>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <span className="relative inline-block" ref={ref}>
      <span
        className={`${color} underline decoration-dotted underline-offset-2`}
        style={{ cursor: definition.docsPath ? "pointer" : "help" }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setCoords(null)}
        onClick={handleClick}
      >
        {token}
      </span>
      {tooltip}
    </span>
  );
}

function isPrimitive(key: string): boolean {
  return key === "string" || key === "number" || key === "boolean";
}

function colorizeSignature(signature: string): React.ReactNode {
  return tokenizeSignature(signature).map((t, i) => (
    <span key={i} style={{ color: tokenKindToColor(t.kind) }}>{t.value}</span>
  ));
}
