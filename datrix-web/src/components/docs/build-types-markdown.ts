import { TYPE_DEFINITIONS } from "./type-definitions";

export function buildTypesMarkdown(): string {
	const entries = Object.entries(TYPE_DEFINITIONS).filter(
		([, def]) => !def.skipDocs,
	);

	const groups = new Map<string, typeof entries>();
	for (const entry of entries) {
		const key = entry[1].group ?? "";
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key)!.push(entry);
	}

	const ordered = [
		...[...groups.entries()].filter(([k]) => k === ""),
		...[...groups.entries()].filter(([k]) => k !== ""),
	];

	const lines: string[] = ["# Types\n"];
	for (const [groupName, groupEntries] of ordered) {
		if (groupName) lines.push(`## ${groupName}\n`);
		for (const [key, def] of groupEntries) {
			lines.push(`### ${key}\n`);
			lines.push("```typescript");
			lines.push(def.signature);
			lines.push("```\n");
			if (def.description) lines.push(`${def.description}\n`);
		}
	}

	return lines.join("\n");
}
