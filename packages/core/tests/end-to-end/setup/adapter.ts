/**
 * Adapter Factory for Core E2E Tests
 *
 * Re-exports from API tests to maintain consistency.
 * All adapter switching logic is centralized there.
 */

export {
	getAdapter,
	getMissingId,
	getTestEnv,
	getTestIdType,
	type AdapterType,
	type TestEnv,
} from "../../../../api/tests/data/adapter";
