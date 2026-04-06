/**
 * Core - Schema Registry Tests - Error Path
 *
 * Tests error handling and validation:
 * - Duplicate registration prevention
 * - Validation in strict mode
 * - Locking mechanism errors
 * - Relation validation
 */

import { SchemaRegistry } from "../src";
import { SchemaDefinition } from "../src/types/core/schema";
import { expectFailureError } from "./test/helpers";
import { describe, it, expect, beforeEach } from "vitest";

describe("Core - Schema Registry - Error Path", () => {
	let strictSchemaRegistry: SchemaRegistry;

	beforeEach(() => {
		strictSchemaRegistry = new SchemaRegistry({
			strict: true,
			allowOverwrite: false,
			validateRelations: true,
		});
	});

	describe("Registration", () => {
		it("should prevent duplicate registration by default", () => {
			const duplicateSchema: SchemaDefinition = {
				name: "User",
				fields: { sid: { type: "string" } },
			};

			strictSchemaRegistry.register(duplicateSchema);
			const duplicateRegistrationResult = () =>
				strictSchemaRegistry.register(duplicateSchema);

			const registrationError = expectFailureError(duplicateRegistrationResult);
			expect(registrationError.code).toBe("DUPLICATE_SCHEMA");
		});

		it("should reject invalid schema in strict mode", () => {
			const invalidSchemaWithEmptyName: any = {
				name: "",
				fields: {},
			};

			const validationResult = () =>
				strictSchemaRegistry.register(invalidSchemaWithEmptyName);

			const validationError = expectFailureError(validationResult);
			expect(validationError.code).toBe("INVALID_SCHEMA_NAME");
		});
	});

	describe("Locking", () => {
		it("should prevent modifications when locked", () => {
			strictSchemaRegistry.lock();

			expect(strictSchemaRegistry.isLocked()).toBe(true);

			const testSchema: SchemaDefinition = {
				name: "Test",
				fields: { id: { type: "string" } },
			};
			const lockedRegistrationResult = () =>
				strictSchemaRegistry.register(testSchema);

			const lockError = expectFailureError(lockedRegistrationResult);
			expect(lockError.code).toBe("REGISTRY_LOCKED");

			expect(() => strictSchemaRegistry.remove("NonExistent")).toThrow();
			expect(() => strictSchemaRegistry.clear()).toThrow();
		});
	});

	describe("Relations", () => {
		it("should validate relation targets", () => {
			const postSchemaWithMissingRelation: SchemaDefinition = {
				name: "Post",
				fields: {
					author: { type: "relation", model: "User", kind: "belongsTo" },
				},
			};

			strictSchemaRegistry.registerMany([postSchemaWithMissingRelation]);
			const relationValidationResult = () =>
				strictSchemaRegistry.finalizeRegistry();

			const relationError = expectFailureError(relationValidationResult);
			expect(relationError.code).toBe("INVALID_RELATION_TARGET");
		});
	});
});
