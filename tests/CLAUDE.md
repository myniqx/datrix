# Forja - Test Writing Guidelines

**Philosophy:** Tests are security auditors. Every test must be comprehensive, strict, and security-focused.

---

## 🚨 Critical Rules

### 1. Separate Happy Path and Error Path Tests

```typescript
// ✅ where-clause.test.ts - Happy path
describe("WhereClause - Happy Path", () => {
	it("should parse simple equality condition", () => {
		const simpleCondition = { name: "John" };

		const data = expectSuccessData(parseWhere(simpleCondition));
		expect(data).toEqual({ field: "name", operator: "$eq", value: "John" });
	});
});

// ❌ where-clause.error.test.ts - Error path
describe("WhereClause - Error Path", () => {
	it("should reject invalid operator", () => {
		const invalidOperator = { name: { $invalidOp: "test" } };

		const error = expectFailureError(parseWhere(invalidOperator));
		expect(error.code).toBe("INVALID_OPERATOR");
	});

	it("should reject SQL injection in field name", () => {
		const sqlInjectionField = "name; DROP TABLE users;";

		const error = expectFailureError(parseWhere({ [sqlInjectionField]: "test" }));
		expect(error.code).toBe("INVALID_FIELD");
	});
});
```

**File Naming:**

- `module-name.test.ts` → Normal behavior tests
- `module-name.error.test.ts` → Error handling, validation, security tests
- if files ll be long, split into multiple files with logical grouping

### 2. Use Shared Fixtures and Helpers

```typescript
// ❌ NEVER: Inline test data
it("should create user", async () => {
	const result = await createUser({ email: "test@example.com", name: "John" });
});

// ✅ ALWAYS: Use fixtures
import {
	validData,
	createTestData,
	edgeCases,
} from "use/regular/path/fixtures";

it("should create user", async () => {
	const user = expectSuccessData(createUser(validData.user));
	expect(user.email).toBe(validData.user.email);
});
```

**When you need fixtures or helpers:**

- Check for existing fixtures/helpers → Add to `packages/types/src/test/fixtures.ts` and `packages/types/src/test/helpers.ts`

**When to add fixtures/helpers:**

- Same data used 3+ times → Add to `packages/types/src/test/fixtures.ts`
- Same assertion pattern 3+ times → Add to `packages/types/src/test/helpers.ts`

### 3. Self-Documenting Test Names and Variables

```typescript
// ❌ BAD: Vague names
it("should work correctly", () => {
	const data = { x: 1 };
	const res = fn(data);
	expect(res).toBe(true);
});

// ✅ GOOD: Descriptive names
it("should reject non-unique email addresses", () => {
	const duplicateEmail = "duplicate@example.com";

	await createUser({ email: duplicateEmail });
	const error = expectFailureError(createUser({ email: duplicateEmail }));
	expect(error.code).toBe("UNIQUE_VIOLATION");
});
```

### 4. Result<T, E> Pattern - Only 2 Helpers

```typescript
// ❌ NEVER: Manual checks (causes lint errors)
expect(result.success).toBe(true);
expect(result.data).toBe("*"); // ❌ Property 'data' does not exist

expect(result.success).toBe(false);
expect(result.error?.code).toBe("ERROR"); // ❌ Optional chaining needed

// ✅ ALWAYS: Use type-safe helpers

// For SUCCESS: expectSuccessData()
const data = expectSuccessData(result);
expect(data).toBe("*"); // ✅ No lint error

// For FAILURE: expectFailureError()
const error = expectFailureError(result);
expect(error.code).toBe("MIGRATION_ERROR");
expect(error.message).toContain("Not connected");
```

### 5. Security Tests are MANDATORY

Every module touching database/user input MUST have:

- SQL injection tests
- Authentication bypass tests (if applicable)
- Authorization escalation tests (if applicable)
- Constraint violation tests

---

## 📂 Test Organization

```
packages/
├── types/src/test/        # Shared utilities (fixtures.ts, helpers.ts)
├── core/tests/
│   ├── validator/
│   │   ├── field-validator.test.ts       # ✅ Happy path
│   │   └── field-validator.error.test.ts # ❌ Error path
│   └── query-builder/
│       ├── where-clause.test.ts
│       └── where-clause.error.test.ts
```

---

## 📋 Test Yazma Adımları

### 1. Fixture/Helper Kontrolü

```typescript
import { validData, invalidData, edgeCases } from "use/relative/path";

// IF not exist in then add to fixtures.ts
export const validData = {
	comment: { id: 1, content: "Great!", userId: 1 },
};
```

### 2. Test Dosyası Oluştur

```bash
touch packages/core/tests/where-clause.test.ts
touch packages/core/tests/where-clause.error.test.ts
```

### 3. Happy Path Testleri

```typescript
describe("WhereClause - Happy Path", () => {
	it("should parse simple equality", () => {
		const simpleWhere = { name: "John" };

		const data = expectSuccessData(parseWhere(simpleWhere));
		expect(data.operator).toBe("$eq");
	});

	it("should parse nested AND conditions", () => {
		const nestedConditions = {
			$and: [{ status: "active" }, { age: { $gte: 18 } }],
		};

		const data = expectSuccessData(parseWhere(nestedConditions));
		expect(data.type).toBe("and");
		expect(data.conditions).toHaveLength(2);
	});
});
```

### 4. Error Path Testleri

```typescript
describe("WhereClause - Error Path", () => {
	it("should reject invalid operator", () => {
		const invalidOperator = { name: { $unknownOp: "test" } };

		const error = expectFailureError(parseWhere(invalidOperator));
		expect(error.code).toBe("INVALID_OPERATOR");
	});

	it("should parameterize SQL injection", async () => {
		const sqlInjection = "'; DROP TABLE users; --";
		await executeQuery({ where: { name: sqlInjection } });

		const [sql, params] = mockDb.query.mock.calls[0];
		expect(sql).toMatch(/\$\d+/);
		expect(sql).not.toContain("DROP TABLE");
		expect(params).toContain(sqlInjection);
	});
});
```

### 5. Test Review Checklist

- [ ] Test data `fixtures.ts`'den mi?
- [ ] `expectSuccessData()` veya `expectFailureError()` kullanıldı mı?
- [ ] Happy path `.test.ts`'de mi?
- [ ] Error path `.error.test.ts`'de mi?
- [ ] Variable isimleri açıklayıcı mı?
- [ ] SQL injection testleri var mı?

---

## 🔒 Mandatory Security Tests

### SQL Injection Protection

```typescript
describe("Security: SQL Injection", () => {
	it("should parameterize WHERE values", async () => {
		const sqlInjection = "'; DROP TABLE users; --";
		await handler({ query: { "where[name]": sqlInjection } });

		const [sql, params] = mockPool.query.mock.calls[0];
		expect(sql).toMatch(/\$\d+/);
		expect(sql).not.toContain("DROP TABLE");
		expect(params[0]).toBe(sqlInjection);
	});

	it("should reject invalid field names", async () => {
		const maliciousField = "name; DROP TABLE users;";
		const result = await handler({
			query: { [`where[${maliciousField}]`]: "test" },
		});

		expect(result.status).toBe(400);
		expect(result.body.error.code).toBe("INVALID_FIELD");
	});
});
```

### Authentication & Authorization

```typescript
describe("Security: Authentication", () => {
	it("should reject missing auth token", async () => {
		const noAuthHeaders = {};
		const result = await protectedHandler({ headers: noAuthHeaders });
		expect(result.status).toBe(401);
	});

	it("should reject expired JWT", async () => {
		const expiredToken = generateExpiredJWT();
		const result = await protectedHandler({
			headers: { authorization: `Bearer ${expiredToken}` },
		});
		expect(result.status).toBe(401);
	});
});

describe("Security: Authorization", () => {
	it("should prevent user from accessing admin endpoints", async () => {
		const userToken = generateToken({ role: "user" });
		const result = await adminHandler({
			headers: { authorization: `Bearer ${userToken}` },
		});
		expect(result.status).toBe(403);
	});
});
```

### Database Constraints

```typescript
describe("Security: Constraints", () => {
	it("should enforce unique constraint", async () => {
		const duplicateEmail = "test@example.com";
		await createUser({ email: duplicateEmail });

		const error = expectFailureError(createUser({ email: duplicateEmail }));
		expect(error.code).toBe("UNIQUE_VIOLATION");
	});

	it("should enforce foreign key constraint", async () => {
		const nonExistentAuthorId = 99999;

		const error = expectFailureError(
			createPost({ authorId: nonExistentAuthorId })
		);
		expect(error.code).toBe("FOREIGN_KEY_VIOLATION");
	});
});
```

---

## 📦 Test Data Management

### Available Fixtures

```typescript
import {
	sampleFields, // Field definitions
	sampleSchemas, // Complete schemas
	validData, // Valid test objects
	invalidData, // Invalid test objects
	edgeCases, // Edge case values (sqlInjection, xss, etc.)
	createTestData, // Factory functions
} from "use/relative/path/fixtures";
```

### Available Helpers

```typescript
import {
	// Result<T, E> helpers (ONLY USE THESE TWO)
	expectSuccessData, // Assert success + return data
	expectFailureError, // Assert failure + return error

	// Performance
	expectWithinTimeLimit, // Assert execution time

	// Utilities
	randomString,
	randomEmail,
} from "use/relative/path/utils";
```

---

## 🎯 Coverage Requirements

| Module   | Target | Priority    |
| -------- | ------ | ----------- |
| Core     | 90%+   | 🔴 CRITICAL |
| Adapters | 80%+   | 🔴 CRITICAL |
| Plugins  | 75%+   | 🔴 CRITICAL |
| API      | 85%+   | 🔴 CRITICAL |

**Common Issues:**

1. **Shared state** → Use `beforeEach` + `vi.clearAllMocks()`
2. **Async issues** → Always `await`
3. **Mock not called** → Check `mockResolvedValueOnce` usage

---

## 📝 Test Documentation

**Only comment complex security logic:**

```typescript
describe("QueryBuilder", () => {
	/**
	 * SECURITY: Validates foreign key before JOIN to prevent
	 * unauthorized data access via malicious populate queries
	 */
	it("should validate relation before generating JOIN", async () => {
		const nonExistentRelation = "hackedRelation";
		const result = await handler({
			query: { [`populate[${nonExistentRelation}]`]: "true" },
		});
		expect(result.status).toBe(400);
	});
});
```

---

## ⚡ Performance Testing

```typescript
import { expectWithinTimeLimit } from "use/relative/path/utils";

describe("Performance", () => {
	it("should parse simple query in <1ms", async () => {
		const simpleQuery = { name: "John" };
		await expectWithinTimeLimit(() => parseWhere(simpleQuery), 1);
	});

	it("should not leak memory on 1000 iterations", async () => {
		const initialMemory = process.memoryUsage().heapUsed;

		for (let i = 0; i < 1000; i++) {
			await buildQuery({ table: "user", where: { id: i } });
		}

		if (global.gc) global.gc();
		const memoryGrowth = process.memoryUsage().heapUsed - initialMemory;
		expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024); // <10MB
	});
});
```

---

## 💡 Result<T, E> Pattern Examples

### Problem: Lint Errors

```typescript
// ❌ PROBLEM: TypeScript can't narrow type
const result = migrate();

expect(result.success).toBe(true);
expect(result.data).toBe("*"); // ❌ Property 'data' does not exist

expect(result.success).toBe(false);
expect(result.error?.code).toBe("ERROR"); // ❌ Optional chaining needed
```

### Solution: Use 2 Helpers

```typescript
// ✅ For SUCCESS: expectSuccessData()
const migratedData = expectSuccessData(migrate());
expect(migratedData).toBe("*"); // ✅ Clean, no lint error

// ✅ For FAILURE: expectFailureError()
const migrationError = expectFailureError(migrate());
expect(migrationError.code).toBe("MIGRATION_ERROR");
expect(migrationError.message).toContain("Not connected");
```

### Real Examples

```typescript
// Migration test
describe("Migration - Error Path", () => {
	it("should fail when not connected", async () => {
		const notConnectedAdapter = new PostgresAdapter(config);

		const error = expectFailureError(notConnectedAdapter.migrate());
		expect(error.name).toBe("MigrationError");
		expect(error.code).toBe("MIGRATION_ERROR");
		expect(error.message).toContain("Not connected");
	});
});

// Validator test
describe("Validator - Happy Path", () => {
	it("should validate email", () => {
		const emailField = { type: "string", pattern: /^[\w-\.]+@/ };

		const validatedEmail = expectSuccessData(
			validateField("test@example.com", emailField)
		);
		expect(validatedEmail).toBe("test@example.com");
	});
});

// Query parser test
describe("QueryParser - Error Path", () => {
	it("should reject invalid operator", () => {
		const invalidQuery = { where: { age: { $unknownOp: 18 } } };

		const error = expectFailureError(parseQuery(invalidQuery));
		expect(error.code).toBe("INVALID_OPERATOR");
		expect(error.field).toBe("age");
	});
});
```

---

## 📚 Resources

- `packages/types/src/test/` - Shared fixtures & helpers
- `CLAUDE.md` (root) - Global development guidelines

---

**Remember:**

- Use `expectSuccessData()` for success cases
- Use `expectFailureError()` for error cases
- Variable names explain intent (`maliciousInput`, `duplicateEmail`)
- Test names describe behavior
- Comments only for complex security logic
- ASLA! ASLA! testi su an ki implementation gececek sekilde revize etme! Testler her zaman ideal davranisi test etmeli.
- import ettigin dosyalarda relative path kullanmalisin.

## Determinism (Deterministik Davranış)

**Olmalı**

- Aynı input → her zaman aynı output
- Object key sırası değişince sonuç değişmemeli
- Zaman, random, env bağımlılığı olmamalı
  **Olmamalı**
- `Date.now()`, `Math.random()` etkisi
- Global state’e bağlı sonuç
- Cache varsa bile dışarıdan gözlemlenebilir fark

## Idempotency (Tekrar Güvenliği)

**Olmalı**

- Aynı input ile tekrar çağrı aynı sonucu üretmeli
- Yan etkisiz veya yan etki kontrollü olmalı
  **Olmamalı**
- İkinci çağrıda farklı davranış
- Gizli state birikimi

## Input Immutability (Girdi Dokunulmazlığı)

**Olmalı**

- Input object hiçbir şekilde mutate edilmemeli
- Deep structure korunmalı
  **Olmamalı**
- Reference üzerinden değişiklik
- Silent mutation

## Boundary Safety (Sınır Güvenliği)

**Olmalı**

- Min / max / empty / overflow değerleri test edilmeli
- Derinlik ve uzunluk sınırları tanımlı olmalı
  **Olmamalı**
- Sonsuz recursion
- Sessiz truncate / overflow

## Invalid-But-Plausible Input Handling

**Olmalı**

- “Doğru gibi görünen yanlış” inputlar reddedilmeli veya normalize edilmeli
- Tip uyuşmazlıkları açıkça ele alınmalı
  **Olmamalı**
- Implicit coercion
- Sessiz fallback

## Hostile Input Resistance

**Olmalı**

- Control chars, unicode tricks, injection pattern’leri test edilmeli
- Input ya reddedilmeli ya da güvenli hale getirilmeli
  **Olmamalı**
- Raw input’un içeri sızması
- “Sonra bir yerde patlar” varsayımı

## Negative Space Coverage (Yapmaması Gerekenler)

**Olmalı**

- Bilinmeyen alanlar yok sayılmalı veya hata üretmeli
- Fazladan gelen data sızmamalı
  **Olmamalı**
- Input’taki her şeyin otomatik kabulü
- Gelecekte sessiz yetki genişlemesi

## Explicit Failure (Açık Hata Davranışı)

**Olmalı**

- Failure durumları deterministik
- Error code + mesaj tutarlı
  **Olmamalı**
- `undefined`, `null`, `false` ile hata anlatımı
- Farklı hatalar için aynı response

## Invariant Protection (Değişmez Kurallar)

**Olmalı**

- “Ne olursa olsun bozulmaması gerekenler” test edilmeli
- Refactor sonrası kırılması beklenen testler olmalı
  **Olmamalı**
- Sadece happy path doğrulayan testler
- Implementation’a aşırı bağlı assert’ler

## State Isolation (Testler Arası Yalıtım)

**Olmalı**

- Her test bağımsız çalışabilmeli
- Paralel çalışınca sonuç değişmemeli
  **Olmamalı**
- Önceki testten kalan state
- Test sırasına bağımlılık

## Observability Safety (Gözlemlenebilirlik)

**Olmalı**

- Log / output’ta hassas veri sızmamalı
- Hata mesajları kontrollü olmalı
  **Olmamalı**
- Input’un olduğu gibi loglanması
- Internal detayların dışarı sızması

## Evolution Safety (Geleceğe Dayanıklılık)

**Olmalı**

- Yeni özellik eklenince eski testler fail edebilmeli
- Yetki / kapsam genişlemesi yakalanmalı
  **Olmamalı**
- “Her şeyi kabul eden” test yapısı
- Snapshot abuse (anlamsız snapshot)

## Tek Cümlelik Altın Kural

> Test, kodun yanlış yönde **genişlemesini engellemiyorsa**, güvenli değildir.
