import { TYPE_DEFINITIONS } from "./type-definitions";
import { TypescriptCodeBlock } from "./code-block";

/**
 * Renders all entries in TYPE_DEFINITIONS as a docs reference section,
 * grouped by the `group` field. Ungrouped entries render at the top.
 * Single source of truth — add a type to type-definitions.ts, it appears here automatically.
 */
export function TypesReference(): React.ReactElement {
  const entries = Object.entries(TYPE_DEFINITIONS).filter(([, def]) => !def.skipDocs);

  const groups: Map<string, [string, (typeof TYPE_DEFINITIONS)[string]][]> = new Map();

  for (const entry of entries) {
    const groupName = entry[1].group ?? "";
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push(entry);
  }

  const allEntries = Array.from(groups.entries());
  const ungrouped = allEntries.filter(([name]) => name === "");
  const grouped   = allEntries.filter(([name]) => name !== "");
  const ordered   = [...ungrouped, ...grouped];

  return (
    <>
      {ordered.map(([groupName, groupEntries], groupIndex) => (
        <div key={groupName || "__ungrouped"}>
          {groupName && <h2>{groupName}</h2>}
          {groupEntries.map(([key, def], entryIndex) => {
            const isLast =
              groupIndex === ordered.length - 1 &&
              entryIndex === groupEntries.length - 1;
            return (
              <div key={key}>
                <h3 id={key.toLowerCase()}>{key}</h3>
                <TypescriptCodeBlock code={def.signature} />
                {def.description && <p>{def.description}</p>}
                {!isLast && <hr />}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
