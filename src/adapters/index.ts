/**
 * Adapters Module
 *
 * Exports all database adapter implementations and base adapter types.
 */

// Export base adapter types
export type {
  DatabaseAdapter,
  ConnectionError,
  QueryError,
  TransactionError,
  MigrationError,
  Transaction,
} from './base/types';

// Export PostgreSQL adapter
export * from './postgres';
