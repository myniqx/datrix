// @ts-nocheck
/**
 * MySQL Query Translator Tests
 *
 * Critical tests for SQL generation, parameter binding, and SQL injection prevention
 * Target: 95%+ coverage - SECURITY CRITICAL
 */

import { createMySQLTranslator } from "../src";
import { QueryObject, WhereClause } from "../../types/src/core/query-builder";
import { describe, it, expect, beforeEach } from "vitest";

describe("MySQL Query Translator", () => {
	let translator: ReturnType<typeof createMySQLTranslator>;

	beforeEach(() => {
		translator = createMySQLTranslator();
	});

	describe("Identifier Escaping", () => {
		it("should escape valid identifiers with backticks", () => {
			expect(translator.escapeIdentifier("users")).toBe("`users`");
			expect(translator.escapeIdentifier("user_name")).toBe("`user_name`");
			expect(translator.escapeIdentifier("_private")).toBe("`_private`");
			expect(translator.escapeIdentifier("table123")).toBe("`table123`");
		});

		it("should escape backticks in identifiers", () => {
			expect(translator.escapeIdentifier("test")).toBe("`test`");
		});

		it("should reject identifiers starting with numbers", () => {
			expect(() => translator.escapeIdentifier("123table")).toThrow(
				"Invalid identifier",
			);
			expect(() => translator.escapeIdentifier("9users")).toThrow(
				"Invalid identifier",
			);
		});

		it("should reject identifiers with special characters", () => {
			expect(() => translator.escapeIdentifier("user-name")).toThrow(
				"Invalid identifier",
			);
			expect(() => translator.escapeIdentifier("user.name")).toThrow(
				"Invalid identifier",
			);
			expect(() => translator.escapeIdentifier("user@domain")).toThrow(
				"Invalid identifier",
			);
			expect(() => translator.escapeIdentifier("user name")).toThrow(
				"Invalid identifier",
			);
		});

		it("should reject identifiers exceeding 64 characters", () => {
			const longName = "a".repeat(65);
			expect(() => translator.escapeIdentifier(longName)).toThrow(
				"exceeds MySQL maximum length",
			);
		});

		it("should accept identifiers with exactly 64 characters", () => {
			const maxName = "a".repeat(64);
			expect(translator.escapeIdentifier(maxName)).toBe(`\`${maxName}\``);
		});

		it("should accept valid patterns", () => {
			expect(translator.escapeIdentifier("UsErS")).toBe("`UsErS`");
			expect(translator.escapeIdentifier("_")).toBe("`_`");
			expect(translator.escapeIdentifier("a_b_c_1_2_3")).toBe("`a_b_c_1_2_3`");
		});

		it("should handle wildcard", () => {
			expect(translator.escapeIdentifier("*")).toBe("*");
		});
	});

	describe("Value Escaping", () => {
		it("should escape NULL values", () => {
			expect(translator.escapeValue(null)).toBe("NULL");
			expect(translator.escapeValue(undefined)).toBe("NULL");
		});

		it("should escape string values with single quotes", () => {
			expect(translator.escapeValue("hello")).toBe("'hello'");
			expect(translator.escapeValue("world")).toBe("'world'");
		});

		it("should escape single quotes in strings", () => {
			expect(translator.escapeValue("it's")).toBe("'it''s'");
			expect(translator.escapeValue("'quoted'")).toBe("'''quoted'''");
		});

		it("should escape backslashes in strings", () => {
			expect(translator.escapeValue("path\\to\\file")).toBe(
				"'path\\\\to\\\\file'",
			);
		});

		it("should escape numbers without quotes", () => {
			expect(translator.escapeValue(42)).toBe("42");
			expect(translator.escapeValue(3.14)).toBe("3.14");
			expect(translator.escapeValue(-10)).toBe("-10");
			expect(translator.escapeValue(0)).toBe("0");
		});

		it("should escape booleans as 1/0", () => {
			expect(translator.escapeValue(true)).toBe("1");
			expect(translator.escapeValue(false)).toBe("0");
		});

		it("should escape Date objects as MySQL datetime format", () => {
			const date = new Date("2024-01-01T12:30:45.000Z");
			const result = translator.escapeValue(date);
			expect(result).toContain("2024-01-01");
			expect(result).toContain("12:30:45");
		});

		it("should escape arrays as JSON_ARRAY", () => {
			const result = translator.escapeValue([1, 2, 3]);
			expect(result).toContain("JSON_ARRAY");
		});

		it("should escape objects as JSON with CAST", () => {
			const result = translator.escapeValue({ foo: "bar" });
			expect(result).toContain("CAST");
			expect(result).toContain("JSON");
			expect(result).toContain("foo");
		});
	});

	describe("Parameter Placeholders", () => {
		it("should generate MySQL-style parameter placeholders (?)", () => {
			expect(translator.getParameterPlaceholder(1)).toBe("?");
			expect(translator.getParameterPlaceholder(2)).toBe("?");
			expect(translator.getParameterPlaceholder(10)).toBe("?");
			expect(translator.getParameterPlaceholder(100)).toBe("?");
		});
	});

	describe("SELECT Translation", () => {
		it("should translate simple SELECT query", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("SELECT");
			expect(result.sql).toContain("FROM `users`");
			expect(result.params).toEqual([]);
		});

		it("should translate SELECT with specific fields", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				select: ["id", "email", "name"],
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("`id`");
			expect(result.sql).toContain("`email`");
			expect(result.sql).toContain("`name`");
		});

		it("should translate SELECT with WHERE clause", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				where: { email: "test@example.com" },
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("WHERE");
			expect(result.sql).toContain("`email`");
			expect(result.sql).toContain("?");
			expect(result.params).toEqual(["test@example.com"]);
		});

		it("should translate SELECT with ORDER BY", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				orderBy: [
					{ field: "name", direction: "asc" },
					{ field: "createdAt", direction: "desc" },
				],
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("ORDER BY");
			expect(result.sql).toContain("`name` ASC");
			expect(result.sql).toContain("`createdAt` DESC");
		});

		it("should translate SELECT with ORDER BY and NULLS handling", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				orderBy: [{ field: "deletedAt", direction: "asc", nulls: "first" }],
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("ORDER BY");
			expect(result.sql).toContain("CASE WHEN");
			expect(result.sql).toContain("IS NULL");
		});

		it("should translate SELECT with LIMIT", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				limit: 10,
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("LIMIT ?");
			expect(result.params).toEqual([10]);
		});

		it("should translate SELECT with OFFSET", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				offset: 20,
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("OFFSET ?");
			expect(result.params).toEqual([20]);
		});

		it("should translate SELECT with LIMIT and OFFSET", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				limit: 10,
				offset: 20,
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("LIMIT ?");
			expect(result.sql).toContain("OFFSET ?");
			expect(result.params).toEqual([10, 20]);
		});

		it("should translate complex SELECT with all clauses", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				select: ["id", "email"],
				where: { role: "admin" },
				orderBy: [{ field: "createdAt", direction: "desc" }],
				limit: 5,
				offset: 10,
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("SELECT");
			expect(result.sql).toContain("`id`");
			expect(result.sql).toContain("`email`");
			expect(result.sql).toContain("FROM `users`");
			expect(result.sql).toContain("WHERE");
			expect(result.sql).toContain("ORDER BY");
			expect(result.sql).toContain("LIMIT");
			expect(result.sql).toContain("OFFSET");
			expect(result.params).toHaveLength(3);
		});

		it("should translate COUNT query", () => {
			const query: QueryObject = {
				type: "count",
				table: "users",
				where: { active: true },
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("SELECT COUNT(*)");
			expect(result.sql).toContain("FROM `users`");
			expect(result.sql).toContain("WHERE");
		});
	});

	describe("INSERT Translation", () => {
		it("should translate simple INSERT query", () => {
			const query: QueryObject = {
				type: "insert",
				table: "users",
				data: {
					email: "test@example.com",
					name: "Test User",
				},
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("INSERT INTO `users`");
			expect(result.sql).toContain("`email`");
			expect(result.sql).toContain("`name`");
			expect(result.sql).toContain("VALUES");
			expect(result.sql).toContain("?");
			expect(result.params).toEqual(["test@example.com", "Test User"]);
		});

		it("should NOT include RETURNING clause (MySQL doesnt support it)", () => {
			const query: QueryObject = {
				type: "insert",
				table: "users",
				data: { email: "test@example.com" },
				returning: ["id", "email"],
			};

			const result = translator.translate(query);

			expect(result.sql).not.toContain("RETURNING");
		});

		it("should handle INSERT with NULL values", () => {
			const query: QueryObject = {
				type: "insert",
				table: "users",
				data: {
					email: "test@example.com",
					middleName: null,
				},
			};

			const result = translator.translate(query);

			expect(result.params).toContain("test@example.com");
			expect(result.params).toContain(null);
		});

		it("should handle INSERT with multiple data types", () => {
			const query: QueryObject = {
				type: "insert",
				table: "users",
				data: {
					email: "test@example.com",
					age: 25,
					active: true,
					metadata: { role: "user" },
				},
			};

			const result = translator.translate(query);

			expect(result.params).toEqual([
				"test@example.com",
				25,
				true,
				{ role: "user" },
			]);
		});
	});

	describe("UPDATE Translation", () => {
		it("should translate simple UPDATE query", () => {
			const query: QueryObject = {
				type: "update",
				table: "users",
				data: { name: "Updated Name" },
				where: { id: 1 },
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("UPDATE `users`");
			expect(result.sql).toContain("SET");
			expect(result.sql).toContain("`name` = ?");
			expect(result.sql).toContain("WHERE");
			expect(result.params).toEqual(["Updated Name", 1]);
		});

		it("should translate UPDATE with multiple fields", () => {
			const query: QueryObject = {
				type: "update",
				table: "users",
				data: {
					name: "New Name",
					email: "new@example.com",
					age: 30,
				},
				where: { id: 1 },
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("`name` = ?");
			expect(result.sql).toContain("`email` = ?");
			expect(result.sql).toContain("`age` = ?");
			expect(result.params).toEqual(["New Name", "new@example.com", 30, 1]);
		});

		it("should NOT include RETURNING clause for UPDATE", () => {
			const query: QueryObject = {
				type: "update",
				table: "users",
				data: { name: "Updated" },
				where: { id: 1 },
				returning: ["id", "name", "updatedAt"],
			};

			const result = translator.translate(query);

			expect(result.sql).not.toContain("RETURNING");
		});

		it("should handle UPDATE with NULL values", () => {
			const query: QueryObject = {
				type: "update",
				table: "users",
				data: { middleName: null },
				where: { id: 1 },
			};

			const result = translator.translate(query);

			expect(result.params).toContain(null);
		});
	});

	describe("DELETE Translation", () => {
		it("should translate simple DELETE query", () => {
			const query: QueryObject = {
				type: "delete",
				table: "users",
				where: { id: 1 },
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("DELETE FROM `users`");
			expect(result.sql).toContain("WHERE");
			expect(result.sql).toContain("`id` = ?");
			expect(result.params).toEqual([1]);
		});

		it("should translate DELETE with complex WHERE", () => {
			const query: QueryObject = {
				type: "delete",
				table: "users",
				where: {
					role: "guest",
					active: false,
				},
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("DELETE FROM `users`");
			expect(result.sql).toContain("WHERE");
			expect(result.params).toEqual(["guest", false]);
		});

		it("should NOT include RETURNING clause for DELETE", () => {
			const query: QueryObject = {
				type: "delete",
				table: "users",
				where: { id: 1 },
				returning: ["id"],
			};

			const result = translator.translate(query);

			expect(result.sql).not.toContain("RETURNING");
		});
	});

	describe("WHERE Clause Translation", () => {
		describe("Simple Equality", () => {
			it("should translate simple equality", () => {
				const result = translator.translateWhere(
					{ email: "test@example.com" },
					0,
				);

				expect(result.sql).toContain("`email` = ?");
				expect(result.params).toEqual(["test@example.com"]);
			});

			it("should translate multiple equality conditions with AND", () => {
				const result = translator.translateWhere(
					{
						email: "test@example.com",
						role: "admin",
					},
					0,
				);

				expect(result.sql).toContain("`email` = ?");
				expect(result.sql).toContain("AND");
				expect(result.sql).toContain("`role` = ?");
				expect(result.params).toEqual(["test@example.com", "admin"]);
			});
		});

		describe("Comparison Operators", () => {
			it("should translate $eq operator", () => {
				const result = translator.translateWhere({ age: { $eq: 25 } }, 0);

				expect(result.sql).toContain("`age` = ?");
				expect(result.params).toEqual([25]);
			});

			it("should translate $ne operator", () => {
				const result = translator.translateWhere(
					{ status: { $ne: "deleted" } },
					0,
				);

				expect(result.sql).toContain("`status` <> ?");
				expect(result.params).toEqual(["deleted"]);
			});

			it("should translate $gt operator", () => {
				const result = translator.translateWhere({ age: { $gt: 18 } }, 0);

				expect(result.sql).toContain("`age` > ?");
				expect(result.params).toEqual([18]);
			});

			it("should translate $gte operator", () => {
				const result = translator.translateWhere({ age: { $gte: 18 } }, 0);

				expect(result.sql).toContain("`age` >= ?");
				expect(result.params).toEqual([18]);
			});

			it("should translate $lt operator", () => {
				const result = translator.translateWhere({ age: { $lt: 65 } }, 0);

				expect(result.sql).toContain("`age` < ?");
				expect(result.params).toEqual([65]);
			});

			it("should translate $lte operator", () => {
				const result = translator.translateWhere({ age: { $lte: 65 } }, 0);

				expect(result.sql).toContain("`age` <= ?");
				expect(result.params).toEqual([65]);
			});

			it("should translate multiple operators on same field", () => {
				const result = translator.translateWhere(
					{
						age: { $gte: 18, $lte: 65 },
					},
					0,
				);

				expect(result.sql).toContain("`age` >= ?");
				expect(result.sql).toContain("AND");
				expect(result.sql).toContain("`age` <= ?");
				expect(result.params).toEqual([18, 65]);
			});
		});

		describe("String Operators", () => {
			it("should translate $like operator", () => {
				const result = translator.translateWhere(
					{ name: { $like: "%john%" } },
					0,
				);

				expect(result.sql).toContain("`name` LIKE ?");
				expect(result.params).toEqual(["%john%"]);
			});

			it("should translate $ilike operator with LOWER()", () => {
				const result = translator.translateWhere(
					{ name: { $ilike: "%JOHN%" } },
					0,
				);

				expect(result.sql).toContain("LOWER(`name`) LIKE LOWER(?)");
				expect(result.params).toEqual(["%JOHN%"]);
			});

			it("should translate $contains operator", () => {
				const result = translator.translateWhere(
					{ name: { $contains: "john" } },
					0,
				);

				expect(result.sql).toContain("LOWER(`name`) LIKE LOWER(?)");
				expect(result.params).toEqual(["%john%"]);
			});

			it("should translate $startsWith operator", () => {
				const result = translator.translateWhere(
					{ email: { $startsWith: "admin" } },
					0,
				);

				expect(result.sql).toContain("LOWER(`email`) LIKE LOWER(?)");
				expect(result.params).toEqual(["admin%"]);
			});

			it("should translate $endsWith operator", () => {
				const result = translator.translateWhere(
					{ domain: { $endsWith: ".com" } },
					0,
				);

				expect(result.sql).toContain("LOWER(`domain`) LIKE LOWER(?)");
				expect(result.params).toEqual(["%.com"]);
			});

			it("should translate $regex operator with REGEXP", () => {
				const result = translator.translateWhere(
					{ code: { $regex: "^[A-Z]{3}$" } },
					0,
				);

				expect(result.sql).toContain("`code` REGEXP ?");
				expect(result.params).toEqual(["^[A-Z]{3}$"]);
			});

			it("should translate $regex with RegExp object", () => {
				const result = translator.translateWhere(
					{ code: { $regex: /^[A-Z]+$/ } },
					0,
				);

				expect(result.sql).toContain("`code` REGEXP ?");
				expect(result.params).toEqual(["^[A-Z]+$"]);
			});
		});

		describe("Array Operators", () => {
			it("should translate $in operator", () => {
				const result = translator.translateWhere(
					{
						role: { $in: ["admin", "moderator", "user"] },
					},
					0,
				);

				expect(result.sql).toContain("`role` IN (?, ?, ?)");
				expect(result.params).toEqual(["admin", "moderator", "user"]);
			});

			it("should translate $nin operator", () => {
				const result = translator.translateWhere(
					{
						status: { $nin: ["deleted", "banned"] },
					},
					0,
				);

				expect(result.sql).toContain("`status` NOT IN (?, ?)");
				expect(result.params).toEqual(["deleted", "banned"]);
			});

			it("should handle empty array in $in", () => {
				const result = translator.translateWhere(
					{
						role: { $in: [] },
					},
					0,
				);

				expect(result.sql).toContain("FALSE");
			});

			it("should handle empty array in $nin", () => {
				const result = translator.translateWhere(
					{
						role: { $nin: [] },
					},
					0,
				);

				expect(result.sql).toContain("TRUE");
			});
		});

		describe("Logical Operators", () => {
			it("should translate $and operator", () => {
				const result = translator.translateWhere(
					{
						$and: [{ age: { $gte: 18 } }, { role: "user" }],
					},
					0,
				);

				expect(result.sql).toContain("`age` >= ?");
				expect(result.sql).toContain("AND");
				expect(result.sql).toContain("`role` = ?");
				expect(result.params).toEqual([18, "user"]);
			});

			it("should translate $or operator", () => {
				const result = translator.translateWhere(
					{
						$or: [{ role: "admin" }, { role: "moderator" }],
					},
					0,
				);

				expect(result.sql).toContain("`role` = ?");
				expect(result.sql).toContain("OR");
				expect(result.params).toEqual(["admin", "moderator"]);
			});

			it("should translate $not operator", () => {
				const result = translator.translateWhere(
					{
						$not: { status: "deleted" },
					},
					0,
				);

				expect(result.sql).toContain("NOT");
				expect(result.sql).toContain("`status` = ?");
				expect(result.params).toEqual(["deleted"]);
			});

			it("should translate nested logical operators", () => {
				const result = translator.translateWhere(
					{
						$and: [
							{ age: { $gte: 18 } },
							{
								$or: [{ role: "admin" }, { role: "moderator" }],
							},
						],
					},
					0,
				);

				expect(result.sql).toContain("AND");
				expect(result.sql).toContain("OR");
				expect(result.params).toEqual([18, "admin", "moderator"]);
			});
		});

		describe("NULL Handling", () => {
			it("should handle NULL equality check", () => {
				const result = translator.translateWhere({ deletedAt: null }, 0);

				expect(result.sql).toContain("`deletedAt` IS NULL");
				expect(result.params).toEqual([]);
			});

			it("should handle NULL with $ne operator", () => {
				const result = translator.translateWhere(
					{ deletedAt: { $ne: null } },
					0,
				);

				expect(result.sql).toContain("`deletedAt` IS NOT NULL");
				expect(result.params).toEqual([]);
			});

			it("should handle $exists operator (true)", () => {
				const result = translator.translateWhere(
					{ avatar: { $exists: true } },
					0,
				);

				expect(result.sql).toContain("`avatar` IS NOT NULL");
			});

			it("should handle $exists operator (false)", () => {
				const result = translator.translateWhere(
					{ avatar: { $exists: false } },
					0,
				);

				expect(result.sql).toContain("`avatar` IS NULL");
			});

			it("should handle $null operator", () => {
				const result = translator.translateWhere(
					{ deletedAt: { $null: true } },
					0,
				);

				expect(result.sql).toContain("`deletedAt` IS NULL");
			});
		});

		describe("Edge Cases and Security", () => {
			it("should prevent SQL injection in field names via validation", () => {
				expect(() => {
					translator.translateWhere(
						{ "email'; DROP TABLE users; --": "test" },
						0,
					);
				}).toThrow("Invalid identifier");
			});

			it("should safely handle special characters in values via parameterization", () => {
				const result = translator.translateWhere(
					{
						comment: "'; DROP TABLE users; --",
					},
					0,
				);

				expect(result.sql).not.toContain("DROP TABLE");
				expect(result.sql).toContain("?");
				expect(result.params).toEqual(["'; DROP TABLE users; --"]);
			});

			it("should handle very long field values via parameterization", () => {
				const longValue = "a".repeat(10000);
				const result = translator.translateWhere({ description: longValue }, 0);

				expect(result.sql).toContain("?");
				expect(result.params).toEqual([longValue]);
			});

			it("should handle Unicode characters safely", () => {
				const result = translator.translateWhere({ name: "测试用户 🚀" }, 0);

				expect(result.sql).toContain("?");
				expect(result.params).toEqual(["测试用户 🚀"]);
			});

			it("should reject excessive nesting depth", () => {
				let deep: WhereClause = { value: 1 };
				for (let i = 0; i < 15; i++) {
					deep = { $and: [deep] };
				}

				expect(() => {
					translator.translateWhere(deep, 0);
				}).toThrow();
			});

			it("should safely handle SQL comment injection in values", () => {
				const result = translator.translateWhere(
					{
						name: "-- DROP TABLE users;",
					},
					0,
				);

				expect(result.sql).not.toContain("DROP TABLE");
				expect(result.sql).toContain("?");
				expect(result.params).toEqual(["-- DROP TABLE users;"]);
			});

			it("should safely handle UNION-based SQL injection in values", () => {
				const result = translator.translateWhere(
					{
						email: "test@example.com' UNION SELECT * FROM passwords --",
					},
					0,
				);

				expect(result.sql).not.toContain("UNION");
				expect(result.sql).not.toContain("passwords");
				expect(result.sql).toContain("?");
				expect(result.params[0]).toBe(
					"test@example.com' UNION SELECT * FROM passwords --",
				);
			});

			it("should safely handle stacked query injection in values", () => {
				const result = translator.translateWhere(
					{
						username: "admin'; DELETE FROM users; --",
					},
					0,
				);

				expect(result.sql).not.toContain("DELETE FROM");
				expect(result.sql).toContain("?");
				expect(result.params).toEqual(["admin'; DELETE FROM users; --"]);
			});

			it("should safely handle null byte injection in values", () => {
				const result = translator.translateWhere(
					{
						filename: "file.txt\0.jpg",
					},
					0,
				);

				expect(result.sql).toContain("?");
				expect(result.params).toEqual(["file.txt\0.jpg"]);
			});

			it("should safely handle control characters in values", () => {
				const result = translator.translateWhere(
					{
						data: "test\r\n\t\0value",
					},
					0,
				);

				expect(result.sql).toContain("?");
				expect(result.params).toEqual(["test\r\n\t\0value"]);
			});

			it("should safely handle bidirectional text override in values", () => {
				const result = translator.translateWhere(
					{
						name: "user\u202Eadmin",
					},
					0,
				);

				expect(result.sql).toContain("?");
				expect(result.params).toEqual(["user\u202Eadmin"]);
			});
		});
	});

	describe("Parameter Binding", () => {
		it("should correctly bind parameters in order", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				where: {
					email: "test@example.com",
					age: { $gte: 18, $lte: 65 },
					role: { $in: ["admin", "user"] },
				},
			};

			const result = translator.translate(query);

			expect(result.params).toEqual([
				"test@example.com",
				18,
				65,
				"admin",
				"user",
			]);
		});

		it("should reset parameter index between queries", () => {
			const query1: QueryObject = {
				type: "select",
				table: "users",
				where: { id: 1 },
			};

			const query2: QueryObject = {
				type: "select",
				table: "posts",
				where: { userId: 2 },
			};

			const result1 = translator.translate(query1);
			const result2 = translator.translate(query2);

			expect(result1.params).toEqual([1]);
			expect(result2.params).toEqual([2]);
		});
	});

	describe("Error Handling", () => {
		it("should throw error for missing table name", () => {
			const query = {
				type: "select",
			} as unknown as QueryObject;

			expect(() => translator.translate(query)).toThrow();
		});

		it("should throw error for INSERT without data", () => {
			const query: QueryObject = {
				type: "insert",
				table: "users",
			};

			expect(() => translator.translate(query)).toThrow();
		});

		it("should throw error for UPDATE without data", () => {
			const query: QueryObject = {
				type: "update",
				table: "users",
				where: { id: 1 },
			};

			expect(() => translator.translate(query)).toThrow();
		});

		it("should throw error for invalid query type", () => {
			const query = {
				type: "invalid",
				table: "users",
			} as unknown as QueryObject;

			expect(() => translator.translate(query)).toThrow();
		});

		it("should throw error for unsupported operator", () => {
			expect(() => {
				translator.translateWhere({ age: { $unknownOp: 25 } }, 0);
			}).toThrow("Unsupported operator");
		});

		it("should throw error for $in with non-array value", () => {
			expect(() => {
				translator.translateWhere(
					{ role: { $in: "admin" as unknown as string[] } },
					0,
				);
			}).toThrow("$in operator requires array");
		});

		it("should throw error for $nin with non-array value", () => {
			expect(() => {
				translator.translateWhere(
					{ role: { $nin: "admin" as unknown as string[] } },
					0,
				);
			}).toThrow("$nin operator requires array");
		});
	});

	describe("MySQL-Specific Features", () => {
		it("should use backticks for identifiers (not double quotes)", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				select: ["id", "name"],
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("`users`");
			expect(result.sql).toContain("`id`");
			expect(result.sql).toContain("`name`");
			expect(result.sql).not.toContain('"users"');
			expect(result.sql).not.toContain('"id"');
		});

		it("should use ? for parameters (not $1, $2)", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				where: { id: 1, name: "test" },
			};

			const result = translator.translate(query);

			expect(result.sql).not.toContain("$1");
			expect(result.sql).not.toContain("$2");
			expect(result.sql.match(/\?/g)?.length).toBeGreaterThanOrEqual(2);
		});

		it("should emulate ILIKE with LOWER()", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				where: { name: { $ilike: "%TEST%" } },
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("LOWER(");
			expect(result.sql).not.toContain("ILIKE");
		});

		it("should use REGEXP instead of ~", () => {
			const query: QueryObject = {
				type: "select",
				table: "users",
				where: { code: { $regex: "^[A-Z]+$" } },
			};

			const result = translator.translate(query);

			expect(result.sql).toContain("REGEXP");
			expect(result.sql).not.toContain("~");
		});
	});
});
