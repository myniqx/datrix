import { useNavigate } from "react-router";
import { CopyButton } from "@/components/ui/copy-button";
import { TYPE_DEFINITIONS, normalizeTypeName } from "./type-definitions";
import { FUNCTION_DEFINITIONS } from "./function-definitions";
import {
	CODE_COLORS,
	semanticKeyColor,
	tokenizeSignature,
	tokenKindToColor,
} from "./code-colors";

// ─── TypeScript tokenizer ─────────────────────────────────────────────────────

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
	"import",
	"export",
	"from",
	"default",
	"const",
	"let",
	"var",
	"function",
	"async",
	"await",
	"return",
	"new",
	"class",
	"extends",
	"implements",
	"interface",
	"type",
	"typeof",
	"keyof",
	"readonly",
	"as",
	"in",
	"of",
	"if",
	"else",
	"for",
	"while",
	"throw",
	"try",
	"catch",
	"finally",
]);

const TS_PRIMITIVES = new Set([
	"string",
	"number",
	"boolean",
	"null",
	"undefined",
	"void",
	"never",
	"Date",
	"unknown",
	"any",
	"object",
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

			// Peek ahead for function call: word( or word<...>(
			let peekJ = j;
			if (code[peekJ] === "<") {
				let depth = 1;
				peekJ++;
				while (peekJ < code.length && depth > 0) {
					if (code[peekJ] === "<") depth++;
					else if (code[peekJ] === ">") depth--;
					peekJ++;
				}
			}
			const isCall = code[peekJ] === "(";

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
		case "keyword":
			return CODE_COLORS.keyword;
		case "type":
			return CODE_COLORS.type;
		case "primitive":
			return CODE_COLORS.primitive;
		case "string":
			return CODE_COLORS.string;
		case "template":
			return CODE_COLORS.string;
		case "number":
			return CODE_COLORS.number;
		case "boolean":
			return CODE_COLORS.boolean;
		case "comment":
			return CODE_COLORS.comment;
		case "punctuation":
			return CODE_COLORS.punctuation;
		case "fnCall":
			return CODE_COLORS.fnName;
		case "operator":
			return CODE_COLORS.punctuation;
		case "plain":
		default:
			return CODE_COLORS.plain;
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

	// Check if this token is a hoverable function call
	if (token.kind === "fnCall") {
		const definition = FUNCTION_DEFINITIONS[token.value];

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
import type { FunctionDefinition } from "./function-definitions";

interface HoverableTokenProps {
	value: string;
	color: string;
	definition: TypeDefinition | FunctionDefinition;
	navigate: ReturnType<typeof useNavigate>;
}

function HoverableToken({
	value,
	color,
	definition,
	navigate,
}: HoverableTokenProps): React.ReactElement {
	const [coords, setCoords] = useState<{
		top: number;
		left: number;
		openUpward: boolean;
	} | null>(null);
	const ref = useRef<HTMLSpanElement>(null);

	function handleMouseEnter(): void {
		if (!ref.current) return;
		const rect = ref.current.getBoundingClientRect();
		const openUpward = rect.top > window.innerHeight / 2;
		setCoords({
			top: openUpward ? rect.top : rect.bottom,
			left: rect.left,
			openUpward,
		});
	}

	function handleClick(): void {
		const typeDef = definition as TypeDefinition;
		if (typeDef.skipDocs) return;
		const fnDef = definition as FunctionDefinition;
		if (fnDef.docsPath) {
			navigate(fnDef.docsPath);
			return;
		}
		navigate(`/docs/core/types#${value.toLowerCase()}`);
	}

	const tooltip = coords
		? createPortal(
				<div
					className="fixed z-9999 w-160 rounded-lg shadow-2xl font-mono text-xs"
					style={{
						top: coords.openUpward ? undefined : coords.top + 6,
						bottom: coords.openUpward
							? window.innerHeight - coords.top + 6
							: undefined,
						left: Math.min(coords.left, window.innerWidth - 400),
						backgroundColor: "#18181b",
						border: "1px solid #3f3f46",
					}}
				>
					<pre
						style={{ color: "#e4e4e7", margin: 0 }}
						className="px-4 pt-3 pb-2 whitespace-pre-wrap wrap-break-word leading-relaxed"
					>
						{tokenizeSignature(definition.signature).map((t, i) => (
							<span key={i} style={{ color: tokenKindToColor(t.kind) }}>
								{t.value}
							</span>
						))}
					</pre>
					<div
						style={{
							borderTop: "1px solid #3f3f46",
							backgroundColor: "#18181b",
						}}
						className="px-4 pb-3 pt-2 rounded-b-lg"
					>
						{definition.description && (
							<p
								style={{ color: "#a1a1aa" }}
								className="font-sans text-xs leading-relaxed whitespace-normal"
							>
								{definition.description}
							</p>
						)}
						{!(definition as TypeDefinition).skipDocs && (
							<p
								className="mt-2 font-sans text-xs"
								style={{ color: "#60a5fa" }}
							>
								click to view docs →
							</p>
						)}
					</div>
				</div>,
				document.body,
			)
		: null;

	return (
		<span ref={ref} className="relative inline">
			<span
				style={{
					color,
					cursor: (definition as TypeDefinition).skipDocs ? "help" : "pointer",
				}}
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

// ─── JSON renderer ────────────────────────────────────────────────────────────

/**
 * Renders a parsed JSON value with syntax highlighting.
 * Exported so playground.tsx can reuse it instead of duplicating.
 */
export function JsonToken({
	value,
	indent = 0,
}: {
	value: unknown;
	indent?: number;
}): React.ReactElement {
	const pad = "  ".repeat(indent);
	const innerPad = "  ".repeat(indent + 1);

	if (value === null)
		return <span style={{ color: CODE_COLORS.boolean }}>null</span>;
	if (typeof value === "boolean")
		return <span style={{ color: CODE_COLORS.boolean }}>{String(value)}</span>;
	if (typeof value === "number")
		return <span style={{ color: CODE_COLORS.number }}>{value}</span>;
	if (typeof value === "string")
		return (
			<span style={{ color: CODE_COLORS.string }}>&quot;{value}&quot;</span>
		);

	if (Array.isArray(value)) {
		if (value.length === 0)
			return <span style={{ color: CODE_COLORS.punctuation }}>{"[]"}</span>;
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
				{pad}
				{"]"}
			</span>
		);
	}

	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.length === 0)
			return <span style={{ color: CODE_COLORS.punctuation }}>{"{}"}</span>;
		return (
			<span>
				{"{\n"}
				{entries.map(([k, v], i) => (
					<span key={k}>
						{innerPad}
						<span style={{ color: CODE_COLORS.queryKey }}>&quot;{k}&quot;</span>
						{": "}
						<JsonToken value={v} indent={indent + 1} />
						{i < entries.length - 1 ? "," : ""}
						{"\n"}
					</span>
				))}
				{pad}
				{"}"}
			</span>
		);
	}

	return <span style={{ color: CODE_COLORS.plain }}>{String(value)}</span>;
}

// ─── JSON string renderer ─────────────────────────────────────────────────────

function JsonStringBlock({ code }: { code: string }): React.ReactElement {
	let parsed: unknown;
	try {
		parsed = JSON.parse(code.trim());
	} catch {
		// Not valid JSON — render as plain
		return (
			<pre
				className="rounded-lg border font-mono text-sm leading-7 overflow-x-auto px-5 py-4"
				style={{
					backgroundColor: "#09090b",
					borderColor: "#27272a",
					color: CODE_COLORS.plain,
				}}
			>
				<code>{code.trimEnd()}</code>
			</pre>
		);
	}

	return (
		<pre
			className="rounded-lg border font-mono text-sm leading-7 overflow-x-auto px-5 py-4"
			style={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
		>
			<code>
				<JsonToken value={parsed} />
			</code>
		</pre>
	);
}

// ─── Bash tokenizer ───────────────────────────────────────────────────────────

const BASH_COMMANDS = new Set([
	"pnpm",
	"npm",
	"npx",
	"yarn",
	"node",
	"ts-node",
	"tsx",
	"git",
	"cd",
	"ls",
	"mkdir",
	"rm",
	"cp",
	"mv",
	"cat",
	"echo",
	"curl",
	"chmod",
	"export",
	"source",
	"sh",
	"bash",
	"datrix",
]);

type BashTokenKind = "command" | "flag" | "string" | "comment" | "plain";

interface BashToken {
	value: string;
	kind: BashTokenKind;
}

function tokenizeBash(code: string): BashToken[] {
	const result: BashToken[] = [];

	for (const line of code.split("\n")) {
		const trimmed = line.trimStart();
		const leadingSpaces = line.slice(0, line.length - trimmed.length);
		if (leadingSpaces) result.push({ value: leadingSpaces, kind: "plain" });

		// Comment line
		if (trimmed.startsWith("#")) {
			result.push({ value: trimmed, kind: "comment" });
			result.push({ value: "\n", kind: "plain" });
			continue;
		}

		let i = 0;
		let isFirstWord = true;

		while (i < trimmed.length) {
			// String literal
			if (trimmed[i] === '"' || trimmed[i] === "'") {
				const quote = trimmed[i]!;
				let j = i + 1;
				while (j < trimmed.length && trimmed[j] !== quote) j++;
				result.push({ value: trimmed.slice(i, j + 1), kind: "string" });
				i = j + 1;
				isFirstWord = false;
				continue;
			}

			// Flag: --flag or -f
			if (trimmed[i] === "-") {
				let j = i;
				while (j < trimmed.length && trimmed[j] !== " " && trimmed[j] !== "=")
					j++;
				result.push({ value: trimmed.slice(i, j), kind: "flag" });
				i = j;
				isFirstWord = false;
				continue;
			}

			// Word token
			if (/\S/.test(trimmed[i]!)) {
				let j = i;
				while (j < trimmed.length && /\S/.test(trimmed[j]!)) j++;
				const word = trimmed.slice(i, j);
				const isCmd = isFirstWord && BASH_COMMANDS.has(word);
				result.push({ value: word, kind: isCmd ? "command" : "plain" });
				i = j;
				isFirstWord = false;
				continue;
			}

			// Whitespace
			result.push({ value: trimmed[i]!, kind: "plain" });
			i++;
		}

		result.push({ value: "\n", kind: "plain" });
	}

	// Trim trailing newline
	if (result.at(-1)?.value === "\n") result.pop();

	return result;
}

function bashTokenColor(kind: BashTokenKind): string {
	switch (kind) {
		case "command":
			return CODE_COLORS.fnName;
		case "flag":
			return CODE_COLORS.keyword;
		case "string":
			return CODE_COLORS.string;
		case "comment":
			return CODE_COLORS.comment;
		case "plain":
		default:
			return CODE_COLORS.plain;
	}
}

function BashLine({
	tokens,
	isComment,
	isEmpty,
}: {
	tokens: BashToken[];
	isComment: boolean;
	isEmpty: boolean;
}): React.ReactElement {
	const copyableText = tokens
		.map((t) => t.value)
		.join("")
		.trimEnd();

	return (
		<div className="group flex items-center gap-2 min-w-0">
			<span className="select-none shrink-0" style={{ color: "#52525b" }}>
				{isEmpty ? " " : "$"}
			</span>
			<span className="flex-1 min-w-0">
				{tokens.map((t, i) => (
					<span key={i} style={{ color: bashTokenColor(t.kind) }}>
						{t.value}
					</span>
				))}
			</span>
			{!isComment && !isEmpty && (
				<span className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
					<CopyButton
						text={copyableText}
						className="rounded px-1.5 py-0.5 bg-zinc-800 text-foreground/50 hover:text-foreground/80"
					/>
				</span>
			)}
		</div>
	);
}

function BashBlock({ code }: { code: string }): React.ReactElement {
	const lines = code.trimEnd().split("\n");

	return (
		<pre
			className="rounded-lg border font-mono text-sm leading-7 overflow-x-auto px-5 py-4"
			style={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
		>
			<code>
				{lines.map((line, i) => {
					const trimmed = line.trimStart();
					const isEmpty = trimmed === "";
					const isComment = trimmed.startsWith("#");
					const tokens = tokenizeBash(line);
					return (
						<BashLine
							key={i}
							tokens={tokens}
							isComment={isComment}
							isEmpty={isEmpty}
						/>
					);
				})}
			</code>
		</pre>
	);
}

// ─── HTTP tokenizer ───────────────────────────────────────────────────────────

const HTTP_METHODS = new Set([
	"GET",
	"POST",
	"PATCH",
	"PUT",
	"DELETE",
	"HEAD",
	"OPTIONS",
]);

function HttpBlock({ code }: { code: string }): React.ReactElement {
	const lines = code.trimEnd().split("\n");
	const rendered: React.ReactElement[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;

		// Request line: METHOD /path HTTP/1.1
		const methodMatch = line.match(/^([A-Z]+)\s+(\S+)(.*)$/);
		if (methodMatch && HTTP_METHODS.has(methodMatch[1]!)) {
			rendered.push(
				<span key={i}>
					<span style={{ color: CODE_COLORS.fnName }}>{methodMatch[1]}</span>
					<span style={{ color: CODE_COLORS.plain }}> </span>
					<span style={{ color: CODE_COLORS.string }}>{methodMatch[2]}</span>
					<span style={{ color: CODE_COLORS.comment }}>{methodMatch[3]}</span>
					{"\n"}
				</span>,
			);
			continue;
		}

		// Header: Key: Value
		const headerMatch = line.match(/^([\w-]+):\s*(.*)$/);
		if (headerMatch) {
			rendered.push(
				<span key={i}>
					<span style={{ color: CODE_COLORS.queryKey }}>{headerMatch[1]}</span>
					<span style={{ color: CODE_COLORS.punctuation }}>: </span>
					<span style={{ color: CODE_COLORS.string }}>{headerMatch[2]}</span>
					{"\n"}
				</span>,
			);
			continue;
		}

		// Empty line or body
		rendered.push(
			<span key={i} style={{ color: CODE_COLORS.plain }}>
				{line}
				{"\n"}
			</span>,
		);
	}

	return (
		<pre
			className="rounded-lg border font-mono text-sm leading-7 overflow-x-auto px-5 py-4"
			style={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
		>
			<code>{rendered}</code>
		</pre>
	);
}

// ─── Pre / Code override ──────────────────────────────────────────────────────

interface PreProps {
	children?: React.ReactNode;
}

/**
 * Drop-in replacement for <pre> in MDX.
 * Detects language from className and renders with syntax highlighting.
 */
export function DocsCodeBlock({ children }: PreProps): React.ReactElement {
	const codeEl = children as React.ReactElement<{
		className?: string;
		children?: string;
	}>;
	const className = codeEl?.props?.className ?? "";
	const rawCode = codeEl?.props?.children ?? "";

	if (typeof rawCode !== "string") {
		return (
			<pre className="rounded-lg bg-zinc-950 border border-zinc-800 px-5 py-4 font-mono text-sm leading-7 overflow-x-auto">
				{children}
			</pre>
		);
	}

	const isTs =
		className.includes("typescript") ||
		className.includes("language-ts") ||
		className.includes("language-tsx");
	const isJson = className.includes("json");
	const isBash = className.includes("bash") || className.includes("shell");
	const isHttp = className.includes("http");

	if (isTs) {
		const tokens = tokenize(rawCode.trimEnd());
		return <TypescriptCodeBlock code={tokens} />;
	}
	if (isJson) return <JsonStringBlock code={rawCode} />;
	if (isBash) return <BashBlock code={rawCode} />;
	if (isHttp) return <HttpBlock code={rawCode} />;

	// Fallback: plain pre block
	return (
		<pre
			className="rounded-lg border font-mono text-sm leading-7 overflow-x-auto px-5 py-4"
			style={{
				backgroundColor: "#09090b",
				borderColor: "#27272a",
				color: CODE_COLORS.plain,
			}}
		>
			<code>{rawCode.trimEnd()}</code>
		</pre>
	);
}

/**
 * Renders a tokenized TypeScript code block with syntax highlighting and hoverable tooltips.
 * Accepts a raw string — use this when rendering signatures outside of MDX.
 */
export function TypescriptCodeBlock({
	code,
}: {
	code: string | Token[];
}): React.ReactElement {
	const tokens = typeof code === "string" ? tokenize(code.trimEnd()) : code;

	return (
		<pre
			className="rounded-lg border font-mono text-sm leading-7 overflow-x-auto px-5 py-4"
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
