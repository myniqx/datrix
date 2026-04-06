/**
 * Test Helpers for Core E2E Tests
 *
 * Common utilities for seeding data, assertions, and performance measurement.
 */

import type { Forja } from "@forja/core";
import type { ForjaEntry } from "@forja/core";
import { expect } from "vitest";

// ============================================================================
// Types
// ============================================================================

export interface SeedResult {
	organizations: ForjaEntry[];
	departments: ForjaEntry[];
	roles: ForjaEntry[];
	users: ForjaEntry[];
	categories: ForjaEntry[];
	tags: ForjaEntry[];
	posts: ForjaEntry[];
}

export interface TimedResult<T> {
	result: T;
	ms: number;
}

// ============================================================================
// Seed Data Helpers
// ============================================================================

/**
 * Seed basic test data for most tests
 *
 * Creates:
 * - 2 organizations
 * - 3 departments (2 under org1, 1 under org2)
 * - 3 roles
 * - 5 users
 * - 3 categories (1 parent, 2 children)
 * - 5 tags
 */
export async function seedBasicData(forja: Forja): Promise<SeedResult> {
	// Organizations
	const organizations = await forja.createMany("organization", [
		{ name: "Acme Corp", country: "USA", isActive: true },
		{ name: "Tech Ltd", country: "UK", isActive: true },
	]);

	// Departments
	const departments = await forja.createMany("department", [
		{
			name: "Engineering",
			code: "ENG",
			budget: 100000,
			organization: organizations[0].id,
		},
		{
			name: "Marketing",
			code: "MKT",
			budget: 50000,
			organization: organizations[0].id,
		},
		{
			name: "Sales",
			code: "SLS",
			budget: 75000,
			organization: organizations[1].id,
		},
	]);

	// Roles
	const roles = await forja.createMany("role", [
		{ name: "Admin", description: "Full access", level: 100 },
		{ name: "Editor", description: "Can edit content", level: 50 },
		{ name: "Viewer", description: "Read only", level: 10 },
	]);

	// Users
	const users = await forja.createMany("user", [
		{
			email: "admin@acme.com",
			name: "Admin User",
			age: 35,
			isActive: true,
			organization: organizations[0].id,
			department: departments[0].id,
		},
		{
			email: "editor@acme.com",
			name: "Editor User",
			age: 28,
			isActive: true,
			organization: organizations[0].id,
			department: departments[1].id,
		},
		{
			email: "viewer@acme.com",
			name: "Viewer User",
			age: 25,
			isActive: true,
			organization: organizations[0].id,
		},
		{
			email: "admin@tech.com",
			name: "Tech Admin",
			age: 40,
			isActive: true,
			organization: organizations[1].id,
			department: departments[2].id,
		},
		{
			email: "inactive@tech.com",
			name: "Inactive User",
			age: 30,
			isActive: false,
			organization: organizations[1].id,
		},
	]);

	// Categories (with self-reference)
	const parentCategory = await forja.create("category", {
		name: "Technology",
		slug: "technology",
		description: "Tech related posts",
		isActive: true,
	});

	const childCategories = await forja.createMany("category", [
		{
			name: "Programming",
			slug: "programming",
			description: "Programming tutorials",
			isActive: true,
			parent: parentCategory.id,
		},
		{
			name: "DevOps",
			slug: "devops",
			description: "DevOps practices",
			isActive: true,
			parent: parentCategory.id,
		},
	]);

	const categories = [parentCategory, ...childCategories];

	// Tags
	const tags = await forja.createMany("tag", [
		{ name: "JavaScript", color: "#F7DF1E" },
		{ name: "TypeScript", color: "#3178C6" },
		{ name: "Node.js", color: "#339933" },
		{ name: "React", color: "#61DAFB" },
		{ name: "Docker", color: "#2496ED" },
	]);

	// Posts (created separately, will be added in post-specific tests)
	const posts: ForjaEntry[] = [];

	return {
		organizations,
		departments,
		roles,
		users,
		categories,
		tags,
		posts,
	};
}

/**
 * Seed posts with relations
 */
export async function seedPosts(
	forja: Forja,
	seed: SeedResult,
): Promise<ForjaEntry[]> {
	const posts = await forja.createMany("post", [
		{
			title: "Getting Started with TypeScript",
			content: "TypeScript is a typed superset of JavaScript...",
			slug: "getting-started-typescript",
			isPublished: true,
			viewCount: 100,
			author: seed.users[0].id,
			category: seed.categories[1].id,
			tags: {
				connect: [seed.tags[0].id, seed.tags[1].id],
			},
		},
		{
			title: "Docker for Beginners",
			content: "Docker is a containerization platform...",
			slug: "docker-beginners",
			isPublished: true,
			viewCount: 50,
			author: seed.users[1].id,
			category: seed.categories[2].id,
			tags: {
				connect: [seed.tags[4].id],
			},
		},
		{
			title: "Draft Post",
			content: "This is a draft...",
			slug: "draft-post",
			isPublished: false,
			viewCount: 0,
			author: seed.users[0].id,
			category: seed.categories[1].id,
		},
	]);

	return posts;
}

// ============================================================================
// Data Generators
// ============================================================================

/**
 * Generate N users with unique emails
 */
export function generateUsers(count: number): Array<{
	email: string;
	name: string;
	age: number;
	isActive: boolean;
}> {
	return Array.from({ length: count }, (_, i) => ({
		email: `user${i}@test.com`,
		name: `Test User ${i}`,
		age: 20 + (i % 50),
		isActive: i % 3 !== 0,
	}));
}

/**
 * Generate N categories with unique slugs
 */
export function generateCategories(count: number): Array<{
	name: string;
	slug: string;
	isActive: boolean;
}> {
	return Array.from({ length: count }, (_, i) => ({
		name: `Category ${i}`,
		slug: `category-${i}`,
		isActive: true,
	}));
}

/**
 * Generate N tags with unique names
 */
export function generateTags(count: number): Array<{
	name: string;
	color: string;
}> {
	const colors = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF"];
	return Array.from({ length: count }, (_, i) => ({
		name: `Tag${i}`,
		color: colors[i % colors.length],
	}));
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that object has all specified fields
 */
export function expectToHaveFields<T extends ForjaEntry>(
	obj: T,
	fields: (keyof T)[],
): void {
	for (const field of fields) {
		expect(obj).toHaveProperty(field as string);
	}
}

/**
 * Assert that a relation is populated (not just an ID)
 */
export function expectRelationPopulated<T extends ForjaEntry>(
	obj: T,
	relationField: keyof T,
): void {
	const relation = obj[relationField];
	expect(relation).not.toBeNull();
	expect(typeof relation).toBe("object");
	expect(relation).toHaveProperty("id");
}

/**
 * Assert that a relation is NOT populated (just an ID or null)
 */
export function expectRelationNotPopulated<T extends ForjaEntry>(
	obj: T,
	relationField: keyof T,
): void {
	const value = obj[relationField];
	if (value !== null && value !== undefined) {
		expect(typeof value).not.toBe("object");
	}
}

/**
 * Assert that record has auto-generated fields
 */
export function expectAutoFields<T extends ForjaEntry>(obj: T): void {
	expect(obj).toHaveProperty("id");
	expect(obj).toHaveProperty("createdAt");
	expect(obj).toHaveProperty("updatedAt");
	expect(typeof obj.id).toBe("number");
}

/**
 * Assert that timestamps are valid dates
 */
export function expectValidTimestamps<T extends ForjaEntry>(obj: T): void {
	const createdAt = new Date(obj.createdAt as string);
	const updatedAt = new Date(obj.updatedAt as string);

	expect(createdAt.getTime()).not.toBeNaN();
	expect(updatedAt.getTime()).not.toBeNaN();
	expect(updatedAt.getTime()).toBeGreaterThanOrEqual(createdAt.getTime());
}

// ============================================================================
// Performance Helpers
// ============================================================================

/**
 * Measure execution time of a function
 */
export async function measureTime<T>(
	fn: () => Promise<T>,
): Promise<TimedResult<T>> {
	const start = performance.now();
	const result = await fn();
	const ms = performance.now() - start;
	return { result, ms };
}

/**
 * Assert that operation completes within time limit
 */
export async function expectWithinTime<T>(
	fn: () => Promise<T>,
	maxMs: number,
): Promise<T> {
	const { result, ms } = await measureTime(fn);
	expect(ms).toBeLessThan(maxMs);
	return result;
}

// ============================================================================
// Random Data Helpers
// ============================================================================

/**
 * Generate random string
 */
export function randomString(length: number): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	return Array.from({ length }, () =>
		chars.charAt(Math.floor(Math.random() * chars.length)),
	).join("");
}

/**
 * Generate random email
 */
export function randomEmail(): string {
	return `${randomString(8)}@test.com`;
}

/**
 * Generate random slug
 */
export function randomSlug(): string {
	return `slug-${randomString(10)}`;
}
