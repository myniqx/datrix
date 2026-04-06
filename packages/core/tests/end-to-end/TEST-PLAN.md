# Core End-to-End Test Plan

Bu dosya, `packages/core/tests/end-to-end` için test planını içerir.
Tartışarak geliştireceğiz.

---

## 1. Dosya Yapısı Önerisi

```
packages/core/tests/end-to-end/
├── setup/
│   ├── config.ts              # Test config (API tests'ten adapt edilmiş)
│   ├── adapter.ts             # Adapter factory (mevcut kodu import)
│   ├── schemas.ts             # Dinamik schema generator + sabit schemalar
│   └── helpers.ts             # Ortak test helper'ları
│
├── fixtures/
│   ├── seed-data.ts           # Fixture data generator
│   └── expected-results.ts    # Beklenen sonuçlar (opsiyonel)
│
├── create/
│   ├── single-create.test.ts         # Tekli insert
│   ├── bulk-create.test.ts           # Çoklu insert
│   ├── create-with-relations.test.ts # Relation API ile create
│   └── create-validation.test.ts     # Validation edge cases
│
├── read/
│   ├── basic-read.test.ts            # Basit findOne, findMany, findById
│   ├── where-operators.test.ts       # Tüm operatörler ($eq, $gt, $in, etc.)
│   ├── nested-where.test.ts          # Relation üzerinden where
│   ├── populate.test.ts              # Basit ve nested populate
│   ├── complex-populate.test.ts      # Çoklu derinlik, circular relations
│   ├── pagination-sort.test.ts       # limit, offset, orderBy
│   └── count.test.ts                 # Count operasyonları >> her test kategorisi icerisinde sadece ERROR atmasina neden olacak test turleri olmali. atiyorum where icinde type oldugunda throw olacak bunun oldugunu garanti eden etc etc...
│
├── update/
│   ├── single-update.test.ts         # Tekli update
│   ├── multi-update.test.ts          # Where ile çoklu update
│   ├── update-relations.test.ts      # Relation API (connect, set, disconnect)
│   └── update-validation.test.ts     # Validation edge cases
│
├── delete/
│   ├── single-delete.test.ts         # Tekli delete
│   ├── multi-delete.test.ts          # Where ile çoklu delete
│   ├── cascade-delete.test.ts        # Relation cascade davranışları
│   └── delete-validation.test.ts     # Constraint violations
│
├── complex-scenarios/
│   ├── transaction-like.test.ts      # Birden fazla işlem (rollback yok ama)
│   ├── large-data.test.ts            # Performans testleri
│   └── edge-cases.test.ts            # Boş where, null değerler, etc.
│
└── index.ts                          # Tüm testleri export (opsiyonel) >> buna gerek yok
```

---

## 2. Schema Generator Önerisi

Dinamik ve karmaşık schemalar oluşturmak için bir generator:

```typescript
// setup/schemas.ts

import { defineSchema } from "@forja/core"; >> bu definition yanlis. boyle bir paket yok.
import type { SchemaDefinition } from "@forja/core/types";

// Field type factories
const stringField = (opts?: Partial<StringFieldDef>) => ({ >> bunlari yazmadan once hangi tipler kullanilmis kontrol etmelisin
  type: "string" as const,
  maxLength: 255,
  ...opts,
});

const numberField = (opts?: Partial<NumberFieldDef>) => ({
  type: "number" as const,
  ...opts,
});

const emailField = () => ({
  type: "string" as const,
  required: true,
  format: "email",
  maxLength: 255,
});

// Generate N fake fields
function generateFakeFields(count: number): Record<string, FieldDefinition> {
  const fields: Record<string, FieldDefinition> = {};
  const types = ["string", "number", "boolean", "date"] as const;

  for (let i = 0; i < count; i++) {
    const typeIndex = i % types.length;
    const type = types[typeIndex];

    switch (type) {
      case "string":
        fields[`field_str_${i}`] = {
          type: "string",
          maxLength: 100 + (i * 10),
          minLength: i % 5,
        };
        break;
      case "number":
        fields[`field_num_${i}`] = {
          type: "number",
          min: 0,
          max: 1000 * (i + 1),
        };
        break;
      case "boolean":
        fields[`field_bool_${i}`] = {
          type: "boolean",
          default: i % 2 === 0,
        };
        break;
      case "date":
        fields[`field_date_${i}`] = {
          type: "date",
        };
        break;
    }
  }

  return fields;
}

// Schema presets
export function createLargeSchema(
  name: string,
  extraFieldCount: number = 50,
): SchemaDefinition {
  return defineSchema({
    name,
    fields: {
      // Core fields
      title: stringField({ required: true, minLength: 1 }),
      email: emailField(),
      age: numberField({ min: 0, max: 150 }),
      isActive: { type: "boolean", default: true },
      createdAt: { type: "date" }, >> createdAt, id, updatedAt otomatik insert ediliyor. manuel hataya sebeb olur
      metadata: { type: "json" },
      tags: { type: "array", items: { type: "string" } },

      // Generated fake fields
      ...generateFakeFields(extraFieldCount),
    },
  } as const);
}
```

---

## 3. Test Schemalar (Sabit)

Relation testleri için kompleks bir schema seti:

```typescript
// Temel yapı (her türlü relation test edilecek)

// 1. User (merkez entity)
// 2. Profile (1:1 -> User)
// 3. Post (N:1 -> User, N:N -> Tag, N:1 -> Category)
// 4. Comment (N:1 -> Post, N:1 -> User)
// 5. Tag (N:N -> Post)
// 6. Category (1:N -> Post, self-referencing parent)
// 7. Role (N:N -> User)
// 8. Permission (N:N -> Role)
// 9. Organization (1:N -> User)
// 10. Department (N:1 -> Organization, 1:N -> User)

// Self-referencing örneği:
Category -> parentId -> Category (parent-child)

// Circular relation örneği:
User -> Posts -> Comments -> User (yorumu yazan)

// Deep populate test için:
Organization -> Departments -> Users -> Posts -> Comments -> User
```

**Relation türleri:**
- `belongsTo` (N:1)
- `hasMany` (1:N)
- `hasOne` (1:1)
- `manyToMany` (N:N - junction table ile)

---

## 4. Helper Functions

```typescript
// setup/helpers.ts

// Test verisi oluşturma
export async function seedTestData(forja: Forja): Promise<SeedResult> {
  // Categories
  const categories = await forja.createMany("category", [
    { name: "Tech", slug: "tech" },
    { name: "Science", slug: "science", parentId: null },
    { name: "AI", slug: "ai", parentId: 1 }, // Tech altında  >> packages\api\tests\data\schemas.ts bu dosyadan schema tanimlarina bakabilirsin api icindeki tum testler geciyor. foreignId kullanmiyoruz. packages\api\tests\populate-many-to-many.test.ts
  ]);

  // Users
  const users = await forja.createMany("user", [
    { email: "admin@test.com", name: "Admin", roleId: 1 },
    { email: "user1@test.com", name: "User One" },
    // ... daha fazla
  ]);

  return { categories, users, /* ... */ };
}

// Assertion helpers
export function expectToHaveFields<T>( >> T extends ForjaEntry
  obj: T,
  fields: (keyof T)[],
): void {
  for (const field of fields) {
    expect(obj).toHaveProperty(field as string);
  }
}

export function expectRelationPopulated<T>(
  obj: T,
  relationField: keyof T,
): void {
  const relation = obj[relationField];
  expect(relation).not.toBeNull();
  expect(typeof relation).toBe("object");
  expect(relation).toHaveProperty("id");
}

// Bulk data generator
export function generateUsers(count: number): Partial<User>[] {
  return Array.from({ length: count }, (_, i) => ({
    email: `user${i}@test.com`,
    name: `Test User ${i}`,
    age: 20 + (i % 50),
    isActive: i % 3 !== 0,
  }));
}

// Timer helper for performance tests
export async function measureTime<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  return { result, ms };
}
```

---

## 5. Test Kategorileri Detay

### 5.1 CREATE Tests

```typescript
// create/single-create.test.ts
describe("Single Create", () => {
  it("should create a simple record");
  it("should auto-generate id if not provided"); >> ID hic verilmez her zaman auto!
  it("should set default values");
  it("should set createdAt/updatedAt timestamps"); >> buda raw sorgu degilse crud bunun ustune yazar... 
  it("should validate required fields");
  it("should validate field constraints (minLength, max, etc.)");
  it("should validate email format"); >> ozel fieldlar ozel kontrol ile hallediliyor.
  it("should validate unique constraints");
});

// create/bulk-create.test.ts
describe("Bulk Create", () => {
  it("should create multiple records at once");
  it("should return all created records");
  it("should validate each record individually");
  it("should fail entire batch if one fails (veya partial?)");
  it("should handle 100+ records efficiently");
  it("should handle 1000+ records efficiently"); // Performance
});

// create/create-with-relations.test.ts
describe("Create with Relations", () => {
  // belongsTo
  it("should create with existing relation id");
  it("should create with nested relation object (inline create)");

  // hasMany / manyToMany
  it("should create with connect to existing records");
  it("should create with inline create of related records");
  it("should create with mixed connect and create");

  // Edge cases
  it("should fail when relation target does not exist");
  it("should handle circular relations properly");
});
```

### 5.2 READ Tests

```typescript
// read/basic-read.test.ts
describe("Basic Read", () => {
  it("should find record by id");
  it("should return null for non-existent id");
  it("should find one by where clause");
  it("should find many without filters");
  it("should select specific fields only");
});

// read/where-operators.test.ts
describe("Where Operators", () => {
  // Her operatör için ayrı test
  describe("$eq", () => { /* ... */ });
  describe("$ne", () => { /* ... */ });
  describe("$gt / $gte", () => { /* ... */ });
  describe("$lt / $lte", () => { /* ... */ });
  describe("$in / $nin", () => { /* ... */ });
  describe("$contains / $notContains", () => { /* ... */ });
  describe("$startsWith / $endsWith", () => { /* ... */ });
  describe("$like / $ilike", () => { /* ... */ });
  describe("$null / $notNull", () => { /* ... */ });
  describe("$and / $or / $not", () => { /* ... */ });
});

// read/nested-where.test.ts
describe("Nested Relation Where", () => {
  it("should filter by belongsTo relation field");
  it("should filter by hasMany relation field");
  it("should filter by manyToMany relation field");
  it("should support multiple nested levels");
  // Örnek: { author: { organization: { name: "Acme" } } }
  it("should combine nested where with local where");
});

// read/complex-populate.test.ts
describe("Complex Populate", () => {
  it("should populate single relation");
  it("should populate multiple relations");
  it("should populate nested relations (2 level)");
  it("should populate nested relations (3+ level)");
  it("should handle circular populate without infinite loop");
  it("should respect maxPopulateDepth");
  it("should populate with field selection");
  // { populate: { author: { select: ["id", "name"] } } }
  it("should populate with nested where filter");
  // { populate: { posts: { where: { isPublished: true } } } }
});
```

### 5.3 UPDATE Tests

```typescript
// update/single-update.test.ts
describe("Single Update", () => {
  it("should update record by id");
  it("should return updated record");
  it("should update only specified fields");
  it("should update updatedAt timestamp");
  it("should validate updated values");
  it("should fail for non-existent id");
});

// update/multi-update.test.ts
describe("Multi Update", () => {
  it("should update multiple records by where");
  it("should return all updated records");
  it("should support nested where for update");
  // Örnek: Update all posts where author.organization.name = "Acme"
});

// update/update-relations.test.ts
describe("Update Relations", () => {
  describe("connect", () => {
    it("should connect existing record to relation");
    it("should connect multiple records (hasMany)");
  });

  describe("disconnect", () => {
    it("should disconnect record from relation");
    it("should disconnect multiple records");
  });

  describe("set", () => {
    it("should replace all related records");
    it("should set empty array to remove all");
  });

  describe("create", () => {
    it("should create and connect new related record");
  });

  // Senin örneğin:
  describe("Complex Relation Update", () => {
    it("should move records from multiple categories to new category", async () => {
      // where: { category: { $in: [1, 2] } }
      // data: { category: { create: { name: "New Category" } } }
      // Beklenti: Eski category 1,2'deki tüm yazarlar yeni category'e taşınmalı
    });
  });
});
```

### 5.4 DELETE Tests

```typescript
// delete/single-delete.test.ts
describe("Single Delete", () => {
  it("should delete record by id"); >> aklimizda bulunsun relation olan bir item (many to many) silinirse junction table otomatik silinir, bu test edilmeli.
  it("should return deleted record");
  it("should fail for non-existent id");
});

// delete/multi-delete.test.ts
describe("Multi Delete", () => {
  it("should delete multiple records by where");
  it("should return all deleted records");
  it("should support nested where for delete");
});

// delete/cascade-delete.test.ts
describe("Cascade Delete", () => {
  it("should handle SET NULL on related records");
  it("should handle CASCADE delete");
  it("should handle RESTRICT (fail if has relations)");
  // Bu adapter'a bağlı olabilir >> evet.. ancak adapterlerin hepsi standart. yani raw query testi yapmayacagiz. 
});
```

### 5.5 Performance Tests

```typescript
// complex-scenarios/large-data.test.ts
describe("Performance Tests", () => {
  describe("Large Schema (50+ columns)", () => {
    it("should create record in under 100ms");
    it("should read record in under 50ms");
    it("should update record in under 100ms");
  });

  describe("Bulk Operations", () => {
    it("should insert 1000 records in under 5s");
    it("should update 1000 records in under 5s");
    it("should delete 1000 records in under 5s");
  });

  describe("Complex Queries", () => {
    it("should handle 5-level nested populate");
    it("should handle 10+ conditions in where");
    it("should handle large $in array (1000 ids)");
  });
});
```

---

## 6. Sorular / Tartışma Noktaları

### Q1: Transaction davranışı
Bulk create'te bir kayıt fail ederse ne olmalı?
- A) Tümü fail (transaction rollback)
- B) Partial success (başarılı olanlar kaydedilir)  >> acikcasi bazi islemlerin fail durumunda ne yapmasi gerektigi henuz net olmayabilir. sence hangisi olmali ?

### Q2: Adapter seçimi
- Sadece JSON adapter mı test edilecek? >> buradaki testler asil json adapter haric. ancak api icindeki adapter.ts dosyasinda gormussundur, adapter ismi degistirerek testin uygulanacagi yapiyi degistiriyoruz. testleri ozel bir adaptere gore degil crud apideki querylere gore yazacagiz. ama performans kisminda beklentilerimiz json adapter haric..
- Postgres/MySQL da dahil mi?
- `ADAPTER` env variable ile switch mi?

### Q3: Relation cascade davranışları
- Schema'da `onDelete: 'CASCADE' | 'SET_NULL' | 'RESTRICT'` var mı? >> yok
- Adapter seviyesinde mi handle ediliyor? >> hayir, executor junction table icindeki datalari temizliyor.

### Q4: Validation scope
- Tüm validation testleri ayrı dosyada mı? >> buradaki kastini tam anlamadim. acaba benim yukarida yazdigin error testleri ile ayni seyimi kast ediyoruz? email@invalid dedigimizde patlamali? eger oyle ise read testlerini patlatacak testler tek dosyada olmali.
- Her CRUD kategorisinde kendi validation testleri mi?

### Q5: Test isolation
- Her test kendi verisini mi oluşturmalı? >> shared seed derken? normalde her test dosyasi ilk baska tablolari drop yapar. baslarken taze seedler olmali ki islem devam etsin. 
- Yoksa shared seed data mı kullanılmalı?
- beforeEach'te reset mi?

### Q6: Performans thresholds
- 1000 kayıt için max süre ne olmalı? >> bunu makul bir degerle baslayalim test gecsin ama suresini gorelim
- Bu adapter'a göre değişmeli mi?

---

## 7. Öncelik Sırası

Önerim:

1. **setup/** - Config ve helpers (tüm testlerin temeli)
2. **read/** - Okuma testleri (en temel, veri gereksinimi az)
3. **create/** - Oluşturma testleri
4. **update/** - Güncelleme testleri
5. **delete/** - Silme testleri
6. **complex-scenarios/** - İleri seviye testler

---

## 8. Sonraki Adımlar

Bu planda onay/değişiklik sonrası:

1. `setup/` klasörü oluştur
2. Schema generator yaz
3. Seed data helper yaz
4. İlk test dosyasını (basic-read) yaz
5. Iteratif olarak diğer testleri ekle

---

**NOT:** Bu dosya tartışma için draft. Fikirlerini ekle, değişiklikleri yap.
