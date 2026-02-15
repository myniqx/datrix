/**
 * Adapter Factory for Migration E2E Tests
 *
 * Re-exports from API tests to maintain consistency.
 * All adapter switching logic is centralized there.
 */

export {
	getAdapter,
	getAdapterType,
	type AdapterType,
} from "../../../../../api/tests/data/adapter";
