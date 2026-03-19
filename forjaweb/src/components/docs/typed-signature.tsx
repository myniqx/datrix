import { TypeTooltip } from "./type-tooltip";

interface TypedSignatureProps {
  /** Method name shown at the top */
  name: string;
  /** Each line: { param, type, comment } or a return line */
  lines: SignatureLine[];
  /** Return type token */
  returns: string;
  /** Optional description shown below the code block */
  description?: string;
  /** Optional note (throws, behavior) shown below description */
  note?: string;
}

export interface SignatureLine {
  /** Parameter name */
  param: string;
  /** Type string, e.g. "RawCrudOptions<T>" */
  type: string;
  /** Optional flag — renders "?" after param name */
  optional?: boolean;
  /** Inline comment */
  comment?: string;
}

/**
 * Renders a TypeScript method signature with hoverable type tokens.
 */
export function TypedSignature({
  name,
  lines,
  returns,
  description,
  note,
}: TypedSignatureProps): React.ReactElement {
  return (
    <div className="my-6">
      {/* Code block */}
      <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-5 py-4 font-mono text-sm leading-7 overflow-x-auto">
        {/* Method name */}
        <div>
          <span className="text-yellow-300">{name}</span>
          <span className="text-zinc-400">(</span>
        </div>

        {/* Parameters */}
        {lines.map((line) => (
          <div key={line.param} className="pl-6 flex items-baseline gap-1">
            <span className="text-zinc-300">
              {line.param}
              {line.optional ? "?" : ""}
            </span>
            <span className="text-zinc-500">:</span>
            <span>
              <TypeToken token={line.type} />
            </span>
            {line.comment && (
              <span className="text-zinc-600 ml-2">{"// "}{line.comment}</span>
            )}
            <span className="text-zinc-500">,</span>
          </div>
        ))}

        {/* Closing + return type */}
        <div>
          <span className="text-zinc-400">{"): "}</span>
          <span className="text-zinc-300">{"Promise<"}</span>
          <TypeToken token={returns} />
          <span className="text-zinc-300">{">"}</span>
        </div>
      </div>

      {/* Description */}
      {description && (
        <p className="mt-3 text-sm text-foreground/80">{description}</p>
      )}

      {/* Note */}
      {note && (
        <p className="mt-2 text-sm text-foreground/50 italic">{note}</p>
      )}
    </div>
  );
}

/**
 * Parses a type token that may contain generics like "RawCrudOptions<T>"
 * and renders the base type as a TypeTooltip, preserving generic syntax.
 */
function TypeToken({ token }: { token: string }): React.ReactElement {
  const genericMatch = token.match(/^([^<]+)(<.+>)?$/);
  if (!genericMatch) {
    return <TypeTooltip token={token} />;
  }

  const base = genericMatch[1]!;
  const generic = genericMatch[2];

  return (
    <>
      <TypeTooltip token={base} />
      {generic && <span className="text-zinc-400">{generic}</span>}
    </>
  );
}
