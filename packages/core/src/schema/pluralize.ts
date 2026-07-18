/**
 * Shared pluralization helper
 *
 * Single source of truth for table-name pluralization. Used by the schema
 * registry (table name generation) and inference utilities — the two must
 * never disagree on how a model name maps to a table name.
 */

/**
 * Enhanced pluralization with common English rules
 */
export function pluralize(word: string): string {
	const irregulars: Record<string, string> = {
		person: "people",
		child: "children",
		man: "men",
		woman: "women",
		tooth: "teeth",
		foot: "feet",
		mouse: "mice",
		goose: "geese",
		ox: "oxen",
		datum: "data",
		index: "indices",
		vertex: "vertices",
		matrix: "matrices",
		status: "statuses",
		quiz: "quizzes",
	};

	const lower = word.toLowerCase();
	const irregular = irregulars[lower];
	if (irregular) {
		const firstChar = word.charAt(0);
		return firstChar === firstChar.toUpperCase()
			? irregular.charAt(0).toUpperCase() + irregular.slice(1)
			: irregular;
	}

	if (
		word.endsWith("ss") ||
		lower === "data" ||
		lower === "information" ||
		lower === "equipment"
	) {
		return word;
	}

	if (word.endsWith("y") && word.length > 1) {
		const beforeY = word[word.length - 2];
		if (beforeY && !"aeiou".includes(beforeY.toLowerCase())) {
			return word.slice(0, -1) + "ies";
		}
	}

	if (word.endsWith("f")) {
		return word.slice(0, -1) + "ves";
	}
	if (word.endsWith("fe")) {
		return word.slice(0, -2) + "ves";
	}

	if (word.endsWith("o") && word.length > 1) {
		const beforeO = word[word.length - 2];
		if (beforeO && !"aeiou".includes(beforeO.toLowerCase())) {
			return word + "es";
		}
	}

	if (
		word.endsWith("ch") ||
		word.endsWith("sh") ||
		word.endsWith("s") ||
		word.endsWith("x") ||
		word.endsWith("z")
	) {
		return word + "es";
	}

	return word + "s";
}
