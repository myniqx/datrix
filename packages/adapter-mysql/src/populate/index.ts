/**
 * MySQL Populate Module
 *
 * Exports all populate-related functionality.
 */

export { MySQLPopulator } from "./populator";
export { JoinBuilder } from "./join-builder";
export { AggregationBuilder } from "./aggregation-builder";
export { ResultProcessor } from "./result-processor";
export type {
	PopulateStrategy,
	JoinClause,
	AggregationClause,
	ProcessedResult,
} from "./types";
