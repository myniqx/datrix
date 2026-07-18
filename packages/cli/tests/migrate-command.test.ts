/**
 * Migrate Command Tests (issues 1.7, 1.8)
 *
 * - non-interactive runs must fail fast instead of hanging on prompts
 * - --yes skips the confirmation prompt
 * - invalid answers to ambiguous-change prompts re-prompt instead of aborting
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MigrationSession } from "@datrix/core";
import { migrateCommand } from "../src/commands/migrate";
import { CLIError } from "../src/types";
import { ask, isInteractive } from "../src/utils/prompt";

vi.mock("../src/utils/prompt", () => ({
	ask: vi.fn(),
	confirm: vi.fn(),
	isInteractive: vi.fn(),
}));

const mockedAsk = vi.mocked(ask);
const mockedIsInteractive = vi.mocked(isInteractive);

interface FakeSessionOverrides {
	readonly ambiguous?: unknown[];
	readonly hasChanges?: boolean;
}

function fakeSession(overrides: FakeSessionOverrides = {}): {
	session: MigrationSession;
	apply: ReturnType<typeof vi.fn>;
	resolveAmbiguous: ReturnType<typeof vi.fn>;
} {
	const apply = vi.fn().mockResolvedValue([]);
	const resolveAmbiguous = vi.fn();

	const session = {
		hasChanges: () => overrides.hasChanges ?? true,
		ambiguous: overrides.ambiguous ?? [],
		getPlan: () => ({
			tablesToCreate: [],
			tablesToDrop: [],
			tablesToAlter: [],
			operations: [],
		}),
		resolveAmbiguous,
		apply,
	} as unknown as MigrationSession;

	return { session, apply, resolveAmbiguous };
}

const ambiguousChange = {
	id: "relation_upgrade:post.category",
	type: "relation_upgrade_single_to_many",
	warning: "Existing single relations can be migrated to junction table.",
	possibleActions: [
		{ type: "migrate_to_junction", description: "Migrate to junction table" },
		{ type: "drop_and_create", description: "Drop and recreate" },
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	mockedIsInteractive.mockReturnValue(true);
});

describe("migrate --yes / non-TTY (issue 1.7)", () => {
	it("fails fast when stdin is not a TTY and --yes was not given", async () => {
		mockedIsInteractive.mockReturnValue(false);
		const { session, apply } = fakeSession();

		await expect(migrateCommand({}, session)).rejects.toThrow(CLIError);
		await expect(migrateCommand({}, session)).rejects.toThrow(/--yes/);
		expect(apply).not.toHaveBeenCalled();
		expect(mockedAsk).not.toHaveBeenCalled();
	});

	it("--yes applies without prompting", async () => {
		mockedIsInteractive.mockReturnValue(false);
		const { session, apply } = fakeSession();

		await migrateCommand({ yes: true }, session);

		expect(apply).toHaveBeenCalledOnce();
		expect(mockedAsk).not.toHaveBeenCalled();
	});

	it("ambiguous changes still require a TTY even with --yes", async () => {
		mockedIsInteractive.mockReturnValue(false);
		const { session, apply } = fakeSession({ ambiguous: [ambiguousChange] });

		await expect(migrateCommand({ yes: true }, session)).rejects.toThrow(
			/interactive/i,
		);
		expect(apply).not.toHaveBeenCalled();
	});

	it("does nothing when there are no changes", async () => {
		mockedIsInteractive.mockReturnValue(false);
		const { session, apply } = fakeSession({ hasChanges: false });

		await migrateCommand({}, session);

		expect(apply).not.toHaveBeenCalled();
	});
});

describe("ambiguous-change prompt re-prompts on invalid input (issue 1.8)", () => {
	it("re-prompts after a typo and then resolves", async () => {
		const { session, apply, resolveAmbiguous } = fakeSession({
			ambiguous: [ambiguousChange],
		});

		// 1st answer invalid, 2nd valid, 3rd confirms the migration
		mockedAsk
			.mockResolvedValueOnce("x")
			.mockResolvedValueOnce("1")
			.mockResolvedValueOnce("y");

		await migrateCommand({}, session);

		expect(resolveAmbiguous).toHaveBeenCalledWith(
			"relation_upgrade:post.category",
			"migrate_to_junction",
		);
		expect(apply).toHaveBeenCalledOnce();
	});

	it("aborts after three invalid answers", async () => {
		const { session, apply } = fakeSession({ ambiguous: [ambiguousChange] });

		mockedAsk
			.mockResolvedValueOnce("x")
			.mockResolvedValueOnce("99")
			.mockResolvedValueOnce("zzz");

		await expect(migrateCommand({}, session)).rejects.toThrow(/Invalid choice/);
		expect(apply).not.toHaveBeenCalled();
	});

	it("accepts a valid answer on the first try", async () => {
		const { session, apply, resolveAmbiguous } = fakeSession({
			ambiguous: [ambiguousChange],
		});

		mockedAsk.mockResolvedValueOnce("2").mockResolvedValueOnce("y");

		await migrateCommand({}, session);

		expect(resolveAmbiguous).toHaveBeenCalledWith(
			"relation_upgrade:post.category",
			"drop_and_create",
		);
		expect(apply).toHaveBeenCalledOnce();
	});
});
