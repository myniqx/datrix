/**
 * Schema System
 *
 * Exports schema type definitions, registry, and type inference utilities.
 */

// Export all schema types
export type {
  FieldType,
  StringField,
  NumberField,
  BooleanField,
  DateField,
  JsonField,
  EnumField,
  ArrayField,
  RelationField,
  FileField,
  FieldDefinition,
  SchemaDefinition,
  IndexDefinition,
} from './types';

// Export schema registry
export { SchemaRegistry } from './registry';

// Export type inference utilities
export { inferFieldType, getRequiredFields, getOptionalFields } from './inference';
