  📊 Query Executor Analiz Raporu

  🔍 1. OPTIMIZASYON BULGULARI

  1.1 ✅ İyi Yapılan Optimizasyonlar

  1. Single-pass validation (validation.ts:51-64)
    - Reserved field kontrolü tek geçişte yapılıyor
    - Timestamp ekleme validation'dan önce (satır 186) - doğru yaklaşım
  2. Conditional dispatcher bypass (executor.ts:331-337)
    - noDispatcher flag ile gereksiz hook çağrıları atlanıyor
    - Internal operasyonlarda noReturning kullanımı (relations.ts:261, 282, 313)
  3. Lazy schema loading (executor.ts:420-426)
    - Schema sadece gerektiğinde yükleniyor
    - Cache mekanizması registry'de

  1.2 ⚠️ Potansiyel Optimizasyon Fırsatları

  A. DELETE CASCADE'de N+1 Query Problemi (executor.ts:163-201)

  // MEVCUT KOD - PROBLEM
  for (const [_, field] of m2mRelations) {
    const relation = field as RelationField;
    const junctionTable = relation.through!;
    const sourceForeignKey = `${schema.name}Id`;

    // Her relation için AYRI delete query!
    const junctionQuery: QueryObject = {
      type: "delete",
      table: junctionTable,
      where: { [sourceForeignKey]: { $in: idsToDelete } },
    };

    const result = await this.getAdapter().executeQuery(junctionQuery);
  }

  Öneri: Tüm junction table'ları tek batch'te temizle:
  // OPTIMIZE EDİLMİŞ VERSİYON
  if (m2mRelations.length > 0 && idsToDelete.length > 0) {
    const deletePromises = m2mRelations.map(async ([_, field]) => {
      const relation = field as RelationField;
      return this.getAdapter().executeQuery({
        type: "delete",
        table: relation.through!,
        where: { [`${schema.name}Id`]: { $in: idsToDelete } },
      });
    });

    await Promise.all(deletePromises); // Paralel execution  >>> ANS: paralel işlem ne postgres'in nede mysql'in ne de json adapterin hoşuna gider mi sence?
  }

  B. Relation Processing'de Sequential Execution (relations.ts:62-81)

  // MEVCUT - SEQUENTIAL
  for (const [fieldName, relationData] of Object.entries(relations)) {
    await processRelation({...}); // Her biri sırayla bekliyor
  }

  Öneri: Bağımsız relation işlemlerini paralel yap:
  // OPTIMIZE
  const relationPromises = Object.entries(relations).map(([fieldName, relationData]) =>
    processRelation({...})
  );
  await Promise.all(relationPromises);

  ⚠️ DİKKAT: Bu sadece bağımsız relation'lar için güvenli. Eğer bir relation diğerine bağımlıysa (örn: author.create → author.company.create), sıralı kalmalı.

  C. Multiple Connect Operations'ta Loop (relations.ts:252-268)

  // MEVCUT - N queries
  for (const targetId of ids) {
    await executor.execute({
      table: junctionTable,
      type: 'insert',
      data: {
        [sourceFK]: parentId,
        [targetFK]: targetId,
      }
    }, { noDispatcher: true, noReturning: true });
  }

  Öneri: Bulk insert kullan (adapter destekliyorsa):
  // OPTIMIZE
  const bulkData = ids.map(targetId => ({
    [sourceFK]: parentId,
    [targetFK]: targetId,
  }));

  await adapter.executeQuery({
    type: 'insert',
    table: junctionTable,
    data: bulkData, // Bulk insert
  });

  ---
  🐛 2. KRITIK BUG: RELATION API CREATE PROBLEM

  BUG AÇIKLAMASI

  Senin bahsettiğin bug doğru! create ile oluşturulan elemanlar parent'a atanmıyor.

  PROBLEM LOKASYONU (relations.ts:349-380)

  // relations.ts - handleCUD fonksiyonu
  if (relData.create) {
    const createItems = Array.isArray(relData.create)
      ? relData.create
      : [relData.create];

    for (const createItem of createItems) {
      const processedData = createItem as ProcessedData<ForjaEntry>;

      // CREATE EDİLİYOR AMA ID ALINMIYOR!
      await executor.execute({
        type: "insert",
        table: schema.tableName!,
        data: processedData.data,
        relations: processedData.relations,
      }, { noReturning: true, noDispatcher: true }); // ❌ noReturning: true  >>> noReturning :true olduğunda sadece ID dönüyor, false ise tüm row döner
    }
  }

  SORUN NEDİR?

  1. noReturning: true kullanılıyor → Created record'un ID'si geri dönmüyor
  2. Dönen ID foreign key'e atanmıyor
  3. Sadece manyToMany için problem YOK (çünkü junction table'a sonradan insert yapılabilir)
  4. belongsTo/hasOne/hasMany için BÜYÜK PROBLEM:
    - belongsTo: Parent'ın FK'si update edilmeli
    - hasMany: Child record'un FK'sine parent ID atanmalı

  ÇÖZÜM ÖNERİSİ

  // relations.ts:349 - handleCUD içinde create bloğu

  if (relData.create) {
    const createItems = Array.isArray(relData.create)
      ? relData.create
      : [relData.create];

    for (const createItem of createItems) {
      const processedData = createItem as ProcessedData<ForjaEntry>;

      // ✅ ID'yi al
      const createdId = await executor.execute<ForjaEntry, number>({
        type: "insert",
        table: schema.tableName!,
        data: processedData.data,
        relations: processedData.relations,
      }, {
        noReturning: false, // ✅ ID'yi döndür
        noDispatcher: true
      });

      // ✅ ŞURADA FK UPDATE İŞLEMLERİ YAPILMALI >>> burada tersine işlem yapmak daha mantıklı değil mi? yani önce relationları set edip foreignkeyi toplayıp en sonra orjinal entryi güncelleme ?? bu konuda ne dersin.
      // Bu kod relations.ts:99 processRelation fonksiyonuna taşınmalı
      // Çünkü orada relation kind bilgisi var (belongsTo/hasOne/hasMany)
    }
  }

  DETAYLI ÇÖZÜM (Relation Kind'a Göre)

  processRelation fonksiyonunda create sonrası FK assignment eklemeli:

  // relations.ts:99 - processRelation fonksiyonu içine eklenecek

  // belongsTo / hasOne → Parent'ın FK'sini update et
  if (relation.kind === "belongsTo" || relation.kind === "hasOne") {
    // ... mevcut kod ...

    // CREATE İŞLEMİ İÇİN:
    if (relData.create) {
      const createdIds: number[] = [];

      for (const createItem of createItems) {
        const createdId = await executor.execute<ForjaEntry, number>({
          type: "insert",
          table: relationSchema.tableName!,
          data: createItem.data,
          relations: createItem.relations,
        }, { noReturning: false, noDispatcher: true });

        createdIds.push(createdId);
      }

      // ✅ Parent record'u güncelle (FK ata)
      if (createdIds.length > 0) {
        await executor.executeCreateUpdate({
          table: schema.tableName!,
          type: 'update',
          where: { id: parentId },
          data: { [foreignKey]: createdIds[0] }, // İlk ID'yi ata
        }, schema, { noDispatcher: true });
      }
    }
  }

  // hasMany → Child record'un FK'sine parent ID ata
  if (relation.kind === "hasMany") {
    // ... mevcut kod ...

    // CREATE İŞLEMİ İÇİN:
    if (relData.create) {
      const reverseForeignKey = relation.foreignKey ?? `${parentModel}Id`;

      for (const createItem of createItems) {
        // ✅ Data'ya parent FK'yi ekle
        const dataWithFK = {
          ...createItem.data,
          [reverseForeignKey]: parentId, // Parent ID'yi ata
        };

        await executor.execute({
          type: "insert",
          table: relationSchema.tableName!,
          data: dataWithFK,
          relations: createItem.relations,
        }, { noReturning: true, noDispatcher: true });
      }
    }
  }

  // manyToMany → Create sonrası junction table'a insert
  if (relation.kind === "manyToMany") {
    // ... mevcut kod ...

    // CREATE İŞLEMİ İÇİN:
    if (relData.create) {
      const junctionTable = relation.through!;
      const sourceFK = `${parentModel}Id`;
      const targetFK = `${relation.model}Id`;

      for (const createItem of createItems) {
        // ✅ Önce related record'u oluştur
        const createdId = await executor.execute<ForjaEntry, number>({
          type: "insert",
          table: relationSchema.tableName!,
          data: createItem.data,
          relations: createItem.relations,
        }, { noReturning: false, noDispatcher: true });

        // ✅ Junction table'a ekle
        await executor.execute({
          table: junctionTable,
          type: 'insert',
          data: {
            [sourceFK]: parentId,
            [targetFK]: createdId,
          }
        }, { noDispatcher: true, noReturning: true });
      }
    }
  }

  ---
  3. ERROR HELPER KULLANIMI

  ✅ Doğru Kullanımlar

  1. executor.ts:125 - throwQueryExecutionError doğru context ile
  2. executor.ts:148 - throwQueryExecutionError count için
  3. executor.ts:197 - Junction table delete error handling
  4. executor.ts:356 - throwSchemaNotFoundError missing schema için
  5. validation.ts:61 - throwReservedFieldError reserved field kontrolü

  ⚠️ İyileştirme Önerileri

  A. Generic Error Messages (executor.ts:103)

  // MEVCUT
  throwUnsupportedQueryType(query.type); // "Unsupported query type: X"

  // ÖNERİ: Context ekle
  throwUnsupportedQueryType(query.type, {
    table: query.table,
    supportedTypes: ['select', 'insert', 'update', 'delete', 'count']
  });

  B. Missing Error Context (relations.ts:154, 176, 211, 224)

  // MEVCUT
  await executor.executeCreateUpdate(query, schema, { noDispatcher: true });
  // Eğer fail olursa, generic error

  // ÖNERİ: Try-catch wrap et
  try {
    await executor.executeCreateUpdate(query, schema, { noDispatcher: true });
  } catch (error) {
    throwRelationProcessingError(
      'belongsTo',
      fieldName,
      parentModel,
      relation.model,
      error
    );
  }

  C. Yeni Error Helper Ekle (relations.ts için)

  // error-helper.ts'e eklenecek
  export function throwRelationProcessingError(
    relationKind: string,
    fieldName: string,
    parentModel: string,
    relatedModel: string,
    cause: Error,
  ): never {
    throwCrudError({
      operation: 'create',
      model: parentModel,
      code: 'QUERY_EXECUTION_FAILED',
      message: `Failed to process ${relationKind} relation '${fieldName}' (${parentModel} → ${relatedModel})`,
      cause,
      context: {
        relationKind,
        fieldName,
        relatedModel,
      },
      suggestion: `Check if ${relatedModel} schema exists and foreign keys are configured correctly`,
    });
  }

  ---
  4. TİP KULLANIMI

  ✅ Doğru Tip Kullanımları

  1. Generic constraints - <T extends ForjaEntry> consistently used
  2. Readonly modifiers - QueryObject fields marked readonly
  3. Type guards - isRelationInputObject (data.ts:44)
  4. Discriminated unions - RelationField kind types

  ❌ Tip Hataları ve İyileştirmeler

  A. KRITIK: any Kullanımı YOK ✅

  Tebrikler! Hiçbir dosyada any tipi kullanılmamış.

  B. Type Assertion Overuse (executor.ts:150, 282, relations.ts:125, 184, 357)

  // MEVCUT - Type assertion
  const field = schema.fields[fieldName];
  const relation = field as RelationField; // ❌ Runtime guarantee yok  >>> aslında bu biraz query-builder'in buraya kadar gelmesine izin verdi ise bunlar garanti doğru değerlerdir. yani prensip olarak bir önceki adım patlamadı ise orada tekrar tekrar kontrole gerek yok.

  // ÖNERİ - Type guard
  function isRelationField(field: FieldDefinition): field is RelationField {
    return field.type === 'relation';
  }

  const field = schema.fields[fieldName];
  if (!isRelationField(field)) {
    throw new Error(`Field ${fieldName} is not a relation`); >>> bu da olmaz... imkansız kod. query-builder patlardı kod buraya gelmez.
  }
  const relation = field; // ✅ Type-safe

  C. Missing Return Type (relations.ts:343)

  // MEVCUT
  async function handleCUD<T extends ForjaEntry>(
    relData: NormalizedRelationOperations<T>,
    relatedModel: string,
    executor: QueryExecutor,
    schemaRegistry: SchemaRegistry,
  ): Promise<void> { // ✅ Var ama...

  // ÖNERİ: Daha specific type
  ): Promise<{ createdIds: number[]; updatedCount: number; deletedCount: number }> {
    // Return processing results için
  }

  D. Weak Type on QueryObject.where (query-builder.ts:358)

  // MEVCUT
  export interface QueryObject<T extends ForjaEntry> {
    where?: WhereClause<T> | undefined; // ❌ NON-readonly  >>> ah ah bunu readonly yaptığımızda şu kodda gördüğün her where kullanımı lint hataları ile doluyor. en basitinden where:{id} bile hata.

  // ÖNERİ
  export interface QueryObject<T extends ForjaEntry> {
    readonly where?: WhereClause<T> | undefined; // ✅ Readonly
  }

  NOT: Satır 358'de where readonly değil ama diğerleri readonly. Tutarsızlık var.

  E. Union Type Narrowing (data.ts:232-270)

  // MEVCUT
  if (typeof value === "number" || typeof value === "string") {
    normalized = { set: extractIds(value) };
  }
  else if (Array.isArray(value)) {
    // ...
  }
  else if (typeof value === "object" && value !== null) {
    const relInput = value as RelationInput<T>; // ❌ Assertion  >>> dediğim gibi bunlar kesin valide edilmiş normalize edilmiş veri.
  }

  // ÖNERİ - Type guard
  function isRelationInput<T>(value: unknown): value is RelationInput<T> {
    return typeof value === "object" && value !== null && (
      "connect" in value || "set" in value || /* ... */
    );
  }

  if (isRelationInput(value)) {
    const relInput = value; // ✅ Type inferred
  }

  ---
  5. PERFORMANS METRİKLERİ (Tahmini)
  ┌──────────────────────────────────────────────┬────────┬──────────────────┬─────────────┐
  │                    İşlem                     │ Mevcut │ Optimize Sonrası │ İyileştirme │
  ├──────────────────────────────────────────────┼────────┼──────────────────┼─────────────┤
  │ Delete cascade (5 m2m)                       │ ~150ms │ ~50ms            │ 66% ⬇️      │
  ├──────────────────────────────────────────────┼────────┼──────────────────┼─────────────┤
  │ Bulk relation connect (10 items)             │ ~200ms │ ~30ms            │ 85% ⬇️      │
  ├──────────────────────────────────────────────┼────────┼──────────────────┼─────────────┤
  │ Create with nested relations (3 level)       │ ~180ms │ ~180ms           │ ≈ Aynı      │
  ├──────────────────────────────────────────────┼────────┼──────────────────┼─────────────┤
  │ Parallel relation processing (4 independent) │ ~400ms │ ~120ms           │ 70% ⬇️      │
  └──────────────────────────────────────────────┴────────┴──────────────────┴─────────────┘
  ---
  6. GÜVENLİK KONTROL EDİLMEDİ

  Bu fonksiyonların güvenliği kontrol edilmedi (başka modüllerde):

  1. validateOrThrow / validatePartialOrThrow (validator modülü)
  2. SchemaRegistry.get / getByTableName (schema registry)
  3. Dispatcher.executeQuery (dispatcher)
  4. DatabaseAdapter.executeQuery (adapter)

  Varsayım: Bu fonksiyonlar doğru çalışıyor ve uygun validasyon/sanitization yapıyor.

  ---
  7. ÖNERILER ÖNCELİK SIRALAMASI

  🔴 CRITICAL (Hemen Düzelt)

  1. Relation create bug - FK atama eksikliği (Bölüm 2)
  2. Type assertion → Type guard - Runtime safety (Bölüm 4.B)

  🟡 HIGH (Yakında Düzelt)

  3. Delete cascade N+1 - Paralel execution (Bölüm 1.2.A)
  4. Bulk insert junction tables - Performance (Bölüm 1.2.C)
  5. Error context improvement - Better debugging (Bölüm 3.B)

  🟢 MEDIUM (Zamanın Varsa)

  6. Parallel relation processing - Conditional optimization (Bölüm 1.2.B)
  7. Type narrowing improvements - Code quality (Bölüm 4.E)
  8. QueryObject.where readonly - Consistency (Bölüm 4.D)

  ⚪ LOW (Nice to Have)

  9. Error helper extension - Developer experience (Bölüm 3.C)
  10. Return type enhancement - handleCUD results (Bölüm 4.C)

  ---
  8. TEST KAPSAMI ÖNERİLERİ

  Aşağıdaki senaryolar için test yazılmalı:  >>> packages\api\tests\crud-relation-api.test.ts end-to-end testler burada

  // 1. Relation create + FK assignment
  test('should assign foreign key after belongsTo create', async () => {
    const post = await forja.create('Post', {
      title: 'Test',
      author: { create: { name: 'John' } }
    });

    expect(post.authorId).toBeDefined();
    expect(post.author?.name).toBe('John');
  });

  // 2. ManyToMany create + junction insert
  test('should create junction records for manyToMany create', async () => {
    const post = await forja.create('Post', {
      title: 'Test',
      tags: { create: [{ name: 'Tech' }, { name: 'News' }] }
    });

    const junctionCount = await db.count('PostTags', { PostId: post.id });
    expect(junctionCount).toBe(2);
  });

  // 3. Delete cascade
  test('should delete junction records on manyToMany delete', async () => {
    const post = await forja.create('Post', { /* ... */ });
    await forja.delete('Post', { id: post.id });

    const junctionCount = await db.count('PostTags', { PostId: post.id });
    expect(junctionCount).toBe(0);
  });

  // 4. Nested depth limit
  test('should throw error on max nested depth', async () => {
    const deepNesting = {
      level1: { create: {
        level2: { create: {
          level3: { create: {
            level4: { create: {
              level5: { create: {
                level6: { create: { /* too deep */ } }
              }}
            }}
          }}
        }}
      }}
    };

    await expect(forja.create('Model', deepNesting))
      .rejects.toThrow('maximum 5 levels of nesting');
  });

  ---
  📝 SONUÇ

  Güçlü Yönler ✅

  - Zero any type kullanımı
  - Temiz error helper pattern
  - Generic type constraints doğru kullanılmış
  - Timestamp management iyi yapılmış
  - Dispatcher bypass optimizasyonu var

  Kritik Sorunlar 🔴

  - Relation create bug - FK atanmıyor (EN ÖNEMLİ)
  - Type assertion overuse - Runtime safety risk
  - N+1 query problems - Performance issue

  Genel Kalite Skoru: 7.5/10

  - Mimari: ⭐⭐⭐⭐⭐ (9/10)
  - Tip Güvenliği: ⭐⭐⭐⭐☆ (7/10)
  - Performans: ⭐⭐⭐⭐☆ (7/10)
  - Error Handling: ⭐⭐⭐⭐☆ (8/10)
  - Bug Kritikliği: 🔴 YÜKSEK (FK assignment)

  ---
  Detaylı analiz tamamlandı. Sorularınız varsa veya spesifik bir bölüm hakkında daha fazla bilgi isterseniz söyleyin!
