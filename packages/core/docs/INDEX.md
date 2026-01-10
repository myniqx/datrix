# Forja Core Documentation

> Complete reference for the core package - schema system, validation, query building, and migrations.

---

## Quick Links

**Getting Started:**
- [README.md](../README.md) - Package overview and quick start

**For Schema Users:**
- [Defining Schemas](./user-guide/defining-schemas.md) - Create database schemas
- [Field Types](./user-guide/field-types.md) - All field types and parameters
- [Relations](./user-guide/relations.md) - Configure relations between schemas
- [Indexes](./user-guide/indexes.md) - Database indexes

**For Plugin Developers:**
- [Getting Started](./plugin-developer/getting-started.md) - Plugin architecture overview
- [Base Plugin](./plugin-developer/base-plugin.md) - Extending BasePlugin class
- [Hooks](./plugin-developer/hooks.md) - Lifecycle and query hooks
- [Schema Access](./plugin-developer/schema-access.md) - SchemaRegistry API
- [Validation](./plugin-developer/validation.md) - Using validator in plugins

**For Adapter Developers:**
- [Getting Started](./adapter-developer/getting-started.md) - Adapter architecture overview
- [Query Builder](./adapter-developer/query-builder.md) - QueryObject translation
- [Migration System](./adapter-developer/migration-system.md) - Migration operations
- [Schema System](./adapter-developer/schema-system.md) - Schema metadata and utilities

**API Reference:**
- [Schema Module](./api-reference/schema-module.md) - Complete schema API
- [Validator Module](./api-reference/validator-module.md) - Complete validator API
- [Query Builder Module](./api-reference/query-builder-module.md) - Complete query builder API
- [Migration Module](./api-reference/migration-module.md) - Complete migration API
- [Plugin Module](./api-reference/plugin-module.md) - Complete plugin API

---

## Documentation Structure

### User Guide (`user-guide/`)

Target audience: Developers defining schemas for their applications.

These docs cover:
- Schema definition syntax
- Field type parameters
- Relation configuration
- Index configuration

**Note:** These docs do NOT cover API usage, validation, or query building. Those are handled automatically by the API layer.

### Plugin Developer Guide (`plugin-developer/`)

Target audience: Developers creating Forja plugins.

These docs cover:
- Plugin architecture
- BasePlugin class extension
- Lifecycle hooks
- Query hooks
- Schema registry access

### Adapter Developer Guide (`adapter-developer/`)

Target audience: Developers implementing database adapters.

These docs cover:
- QueryObject structure and translation
- Migration operation handling
- Schema metadata utilities
- Database-specific considerations

### API Reference (`api-reference/`)

Complete function and class signatures for all core modules.

Use these for quick lookup of:
- Function parameters
- Return types
- Type definitions

---

## Package Information

**Name:** `forja-core`
**Version:** 0.1.0
**License:** MIT

**Dependencies:**
- `forja-types` (workspace package)

**Zero external runtime dependencies.**

---

## Source Code

All source code is in `packages/core/src/`:

- `schema/` - Schema system and registry
- `validator/` - Validation engine
- `query-builder/` - Query builder and utilities
- `migration/` - Migration system
- `plugin/` - Plugin base class
- `dispatcher.ts` - Plugin hook dispatcher
- `utils/` - Utility functions

---

## Testing

See [Testing Guidelines](../../../tests/CLAUDE.md) for test strategy and examples.

---

## Contributing

When adding new features to core:

1. Update type definitions in `forja-types` package
2. Implement functionality in `packages/core/src/`
3. Add tests in `packages/core/tests/`
4. Update relevant documentation files
5. Follow [Documentation Guidelines](./claude/creating_documentation.md)

---

## Support

**Issues:** [GitHub Issues](https://github.com/myniqx/forja/issues)
**License:** [MIT](../../../LICENSE)

---

**Last Updated:** 2026-01-10
