# Documentation Creation Guidelines for Forja Core

> Internal guide for writing consistent, professional documentation for the core package.

This document defines the standards and rules for creating documentation in the Forja Core package. Follow these guidelines when writing any `.md` file in `packages/core/docs/`.

---

## Documentation Philosophy

**Goal:** Create a concise, professional reference guide for TypeScript developers.

**NOT a tutorial.** NOT beginner-friendly. NOT verbose.

**Assumptions:**
- Reader knows TypeScript
- Reader understands databases, ORMs, query builders
- Reader can read source code if needed

---

## Target Audiences

### 1. **Schema Users** (Normal developers using Forja)
**What they do:**
- Define schemas with field types
- Configure relations and indexes
- Write schema definitions only

**What they DON'T do:**
- Call `validateSchema()` directly (API layer handles this)
- Build queries manually (API layer handles this)
- Write migrations manually (CLI handles this)

**Documentation focus:**
- Field types and parameters
- Schema definition syntax
- Relation configuration
- Index configuration

### 2. **Plugin Developers** (Extending Forja)
**What they do:**
- Extend `BasePlugin` class
- Use lifecycle hooks
- Access schema registry
- Optionally use validator

**Documentation focus:**
- Plugin architecture
- Hook system
- Schema access APIs
- Minimal validation examples

### 3. **Adapter Developers** (Database integration)
**What they do:**
- Implement `DatabaseAdapter` interface
- Translate `QueryObject` to SQL/NoSQL
- Handle migrations
- Parse schema definitions

**Documentation focus:**
- `QueryObject` structure
- Translation patterns
- Migration system
- Critical: SQL injection prevention

---

## Writing Style

### Language
- ✅ **English only**
- ✅ Technical, professional tone
- ✅ Direct, concise sentences
- ❌ No conversational language
- ❌ No "beginner-friendly" explanations

### Code Examples
- ✅ **TypeScript only** (no JavaScript)
- ✅ Type annotations on everything
- ✅ Real-world field names (not `foo`, `bar`)
- ✅ Short, focused examples (5-15 lines max)
- ❌ No "valid ✅ / invalid ❌" lists
- ❌ No step-by-step tutorials

### Formatting
- Use tables for parameters
- Use code blocks for examples
- Use `**bold**` for emphasis (sparingly)
- Use `> blockquotes` for important notes
- Section headers: `##` for major, `###` for sub-sections

---

## Document Structure

Every documentation file should follow this structure:

```markdown
# [Topic Name]

> Brief one-sentence description of what this covers.

---

## Overview

Brief explanation (2-3 sentences) of what this is and why it matters.

## [Main Content]

### Sub-section 1

Parameters table + code example + notes.

### Sub-section 2

...

## Reference

**Source Code:**
- List of relevant source files

**Utilities:**
- List of helper functions/utilities (if applicable)

**Related:**
- Links to other documentation files
- Link to tests/CLAUDE.md (if testing is relevant)
```

---

## What to Include

### For Schema Users (user-guide/)

✅ **DO include:**
- All field type parameters (table format)
- TypeScript type inference examples
- Common patterns (regex, relation configs)
- Short notes on behavior (e.g., "case-sensitive")

❌ **DON'T include:**
- Validation examples (they won't call `validateField()`)
- "Valid/invalid" value lists (they know TypeScript)
- Error handling examples (API layer handles this)
- Implementation details

**Example:**
```typescript
// ✅ GOOD - Just show the parameters
email: {
  type: 'string',
  required: true,
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
}

// ❌ BAD - Don't explain what's valid
// ✅ "user@example.com" is valid
// ❌ "invalid-email" throws PATTERN error
```

### For Plugin Developers (plugin-developer/)

✅ **DO include:**
- Class/interface signatures
- Hook lifecycle explanation
- Schema registry access patterns
- Minimal code examples (method signatures)

❌ **DON'T include:**
- Full implementation code (tell them to read source)
- Test examples (link to tests/CLAUDE.md instead)
- Detailed error handling (show patterns, not all cases)

**Example:**
```typescript
// ✅ GOOD - Show signature and usage
class MyPlugin extends BasePlugin {
  async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
    // Modify query here
    return query;
  }
}

// ❌ BAD - Don't write full implementation
class MyPlugin extends BasePlugin {
  async onBeforeQuery(query: QueryObject): Promise<QueryObject> {
    // Don't show 50 lines of actual logic
    // Just say "modify query and return it"
  }
}
```

### For Adapter Developers (adapter-developer/)

✅ **DO include:**
- `QueryObject` structure (full interface)
- Translation examples (QueryObject → SQL)
- Critical warnings (SQL injection, edge cases)
- Utility function references

❌ **DON'T include:**
- Full translator implementation
- Database-specific quirks (link to example adapter instead)
- Detailed test suites (link to tests/CLAUDE.md)

**Example:**
```typescript
// ✅ GOOD - Show the structure and translation
{
  type: 'select',
  table: 'users',
  where: { role: 'admin' }
}
// SQL: SELECT * FROM users WHERE role = $1

// ❌ BAD - Don't write the full translator
function translateWhere(where: WhereClause): string {
  // 100 lines of implementation...
}
```

---

## Mandatory: Reference Section

**Every documentation file MUST end with a Reference section.**

This section tells readers where to find more details in the source code.

### Template

```markdown
## Reference

**Source Code:**
- [Description] - `relative/path/to/file.ts`
- [Description] - `relative/path/to/another.ts`

**Utilities:**
- [Function name] - `path/to/utilities/`
- [Function name] - `path/to/helpers/`

**Example Implementation:**
- [Description] - `path/to/example/implementation.ts`

**Related:**
- [Link to related doc](./other-doc.md)
- [Link to related doc](./another-doc.md)
- [Testing Guidelines](../../../tests/CLAUDE.md) (if applicable)
```

### Rules

1. **Paths must be relative** to the package root
   - ✅ `packages/core/src/schema/registry.ts`
   - ❌ `/home/user/forja/packages/core/...`

2. **Include ALL relevant files**
   - Type definitions
   - Implementation files
   - Utility functions
   - Example adapters/plugins

3. **Link to tests/CLAUDE.md** when testing is discussed

4. **Cross-reference related docs**

---

## What to Exclude

### Never Include:

❌ **Turkish language** (English only)

❌ **Beginner explanations** (e.g., "min/max means minimum and maximum")

❌ **Valid/invalid lists** (TypeScript developers understand types)

❌ **Validation examples** (unless for plugin/adapter devs who need it)

❌ **Full implementation code** (reference source instead)

❌ **Test code** (link to tests/CLAUDE.md)

❌ **Database-specific details** (link to adapter implementation)

❌ **Future features** (only document what exists)

---

## Examples: Good vs. Bad

### Parameter Documentation

```markdown
✅ GOOD:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `minLength` | `number` | - | Minimum string length |

Notes:
- Empty string `""` passes validation unless `required: true`

❌ BAD:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `minLength` | `number` | - | The minimum length that the string must have. For example, if you set minLength to 5, then the string "hello" is valid because it has exactly 5 characters, but "hi" is invalid because it only has 2 characters. |

Valid values:
✅ "hello" (5 characters, passes minLength: 5)
❌ "hi" (2 characters, fails minLength: 5)
```

### Code Examples

```markdown
✅ GOOD:

```typescript
// User schema
const userSchema = {
  name: 'User',
  fields: {
    email: {
      type: 'string',
      required: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    }
  }
};
```

❌ BAD:

```typescript
// First, let's import the necessary modules
import { validateSchema } from 'forja-core';

// Now, let's define our user data
const userData = {
  email: 'user@example.com',
  name: 'John Doe'
};

// Next, we validate it against the schema
const result = validateSchema(userData, userSchema);

// Finally, we check if it's valid
if (result.success) {
  console.log('Validation passed!');
  console.log('Valid data:', result.data);
} else {
  console.error('Validation failed!');
  console.error('Errors:', result.error);
}
```
```

### Reference Section

```markdown
✅ GOOD:

## Reference

**Source Code:**
- Field definitions - `packages/types/src/schema.ts`
- Validation - `packages/core/src/validator/`
- Type inference - `packages/core/src/schema/inference.ts`

**Related:**
- [Schema Definition Guide](./defining-schemas.md)
- [Relations Guide](./relations.md)

❌ BAD:

## Reference

For more information, check the source code.

(Missing: specific file paths, no links to related docs)
```

---

## File Naming Conventions

### User Guide
- `field-types.md` (not `FieldTypes.md` or `field_types.md`)
- `defining-schemas.md`
- `relations.md`
- `indexes.md`

### Developer Guides
- `query-builder.md`
- `base-plugin.md`
- `schema-access.md`

### API Reference
- `schema-module.md`
- `validator-module.md`
- `query-builder-module.md`

**Rules:**
- All lowercase
- Hyphen-separated (kebab-case)
- Descriptive, not abbreviated
- `.md` extension

---

## Length Guidelines

### User Guide Files
- **Target:** 300-500 lines per file
- **Max:** 600 lines
- If longer, split into multiple files

### Developer Guide Files
- **Target:** 400-600 lines per file
- **Max:** 700 lines
- Focus on reference, not tutorials

### API Reference Files
- **Target:** 200-400 lines per file
- Just function signatures + brief descriptions
- Link to source for full implementation

---

## Checklist Before Committing

Before pushing any documentation file, verify:

- [ ] English only (no Turkish, no other languages)
- [ ] TypeScript code examples (no JavaScript)
- [ ] No "valid ✅ / invalid ❌" lists
- [ ] No validation examples (unless for plugin/adapter devs)
- [ ] No full implementation code
- [ ] Reference section exists with file paths
- [ ] Links to related docs
- [ ] File name is kebab-case
- [ ] Parameters in table format
- [ ] Code blocks have language tag (```typescript)
- [ ] No conversational tone ("Let's do this!")
- [ ] No beginner explanations ("min means minimum")
- [ ] Source file paths are relative
- [ ] Link to tests/CLAUDE.md if testing mentioned

---

## Package-Specific Information

### Package Name
- ✅ `forja-core` (from package.json)
- ❌ `@forja/core`
- ❌ `Forja Core`

### Source Paths
All paths relative to monorepo root:
- `packages/core/src/schema/`
- `packages/core/src/validator/`
- `packages/core/src/query-builder/`
- `packages/core/src/migration/`
- `packages/core/src/plugin/`
- `packages/types/src/`

### Testing Reference
When mentioning tests:
- Link to `../../../tests/CLAUDE.md` (from core/docs/)
- Or `tests/CLAUDE.md` (from repo root)

---

## Template Files

### User Guide Template

```markdown
# [Field Type / Feature Name]

> Brief description.

---

## [Main Concept]

Brief explanation.

```typescript
// Single focused example
```

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `param` | `type` | `default` | Description |

**Notes:**
- Important behavior note 1
- Important behavior note 2

---

## Reference

**Source Code:**
- [Description] - `path/to/file.ts`

**Related:**
- [Link](./other.md)
```

### Developer Guide Template

```markdown
# [Component Name] - Developer Reference

> Technical reference for [target audience].

---

## Overview

What this is and why adapter/plugin developers need it.

```typescript
// Structure or interface
```

**Source:** `path/to/types.ts`

---

## [Main Sections]

### Sub-section

Brief explanation + minimal code example.

---

## Implementation

### Required Methods

```typescript
// Method signatures only
```

### Critical Warnings

List of edge cases and security concerns.

---

## Utility Functions

```typescript
import { utilityName } from 'forja-core';

// Brief usage example
```

**Source:** `path/to/utilities/`

---

## Reference

**Type Definitions:**
- [Description] - `path/to/types.ts`

**Utilities:**
- [Function] - `path/to/utils/`

**Example Implementation:**
- [Adapter/Plugin] - `path/to/example/`

**Related:**
- [Link](./other.md)
- [Testing Guidelines](../../../tests/CLAUDE.md)
```

---

## Final Notes

**Remember:**
- Documentation is a reference, not a tutorial
- Target audience: experienced TypeScript developers
- Less is more: concise, professional, actionable
- Always include Reference section
- Open source code is the ultimate documentation

**When in doubt:**
- Look at revised examples in `EXAMPLE_USER_GUIDE.md` and `EXAMPLE_DEVELOPER_GUIDE.md`
- Read this guide again
- Check PostgreSQL adapter docs (if exists) for style

---

**Last Updated:** 2026-01-10
**Maintainer:** Forja Core Team
