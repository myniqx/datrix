# API Plugin - QueryContext Implementation TODO

## 🎯 Amaç

API Plugin'in `onAfterQuery` hook'unda query bilgisine erişebilmesi için core'da QueryContext implementasyonu gerekiyor.

---

## 📋 Core'da Yapılması Gerekenler

### 1. Type Definitions (`packages/types/src/plugin.ts`)

```typescript
/**
 * Query context for hooks
 */
export interface QueryContext {
  readonly operation: 'select' | 'insert' | 'update' | 'delete' | 'count';
  readonly modelName: string;
  readonly user?: {
    readonly id: string;
    readonly role: string;
    readonly [key: string]: unknown;
  };
  readonly metadata: Map<string, unknown>;
}

/**
 * Query result context for after query hook
 */
export interface QueryResultContext extends QueryContext {
  readonly originalQuery: QueryObject;
  readonly executionTime?: number; // ms
}
```

**ForjaPlugin interface güncellemesi:**
```typescript
export interface ForjaPlugin<TOptions = Record<string, unknown>> {
  // ... existing

  // Güncelle:
  onBeforeQuery?(query: QueryObject, context?: QueryContext): Promise<QueryObject>;
  onAfterQuery?<TResult>(result: TResult, context?: QueryResultContext): Promise<TResult>;
}
```

---

### 2. Dispatcher Implementation (`packages/core/src/dispatcher.ts`)

#### 2.1 dispatchBeforeQuery (optional - future enhancement)

```typescript
async dispatchBeforeQuery(
  query: QueryObject,
  context?: QueryContext // optional
): Promise<QueryObject> {
  let currentQuery = { ...query };

  for (const plugin of this.registry.getAll()) {
    try {
      if (plugin.onBeforeQuery) {
        // Context varsa geç, yoksa undefined
        const modifiedQuery = await plugin.onBeforeQuery(currentQuery, context);
        currentQuery = modifiedQuery;
      }
    } catch (error) {
      console.error(`[Dispatcher] Error in plugin '${plugin.name}' onBeforeQuery:`, error);
      throw error;
    }
  }

  return currentQuery;
}
```

#### 2.2 dispatchAfterQuery (CRITICAL - gerekli)

```typescript
async dispatchAfterQuery<TResult>(
  result: TResult,
  context: QueryResultContext // ZORUNLU
): Promise<TResult> {
  let currentResult = result;

  for (const plugin of this.registry.getAll()) {
    try {
      if (plugin.onAfterQuery) {
        currentResult = await plugin.onAfterQuery(currentResult, context);
      }
    } catch (error) {
      console.error(`[Dispatcher] Error in plugin '${plugin.name}' onAfterQuery:`, error);
    }
  }

  return currentResult;
}
```

---

### 3. Adapter/CRUD Integration

**QueryResultContext'i nerede oluşturacağız?**

Adapter `executeQuery` sonrasında dispatcher çağrısı yapılırken:

```typescript
// packages/core/src/mixins/crud.ts (veya adapter içinde)
async findOne<T>(model: string, where: WhereClause, options?) {
  const query: QueryObject = {
    type: 'select',
    table: model,
    where,
    select: options?.select,
    populate: options?.populate,
    limit: 1,
  };

  // Execute
  const startTime = Date.now();
  const result = await this.adapter.executeQuery<T[]>(query);
  const executionTime = Date.now() - startTime;

  // Dispatch after query with context
  const context: QueryResultContext = {
    operation: query.type,
    modelName: model,
    originalQuery: query,
    executionTime,
    user: undefined, // TODO: Auth plugin entegrasyonu sonrası
    metadata: new Map(),
  };

  const processedResult = await dispatcher.dispatchAfterQuery(result, context);
  return processedResult[0] ?? null;
}
```

**KRİTİK:** Her CRUD operasyonu sonrasında `dispatchAfterQuery` çağrılmalı:
- `findOne`
- `findMany`
- `create`
- `update`
- `delete`
- `count`

---

## 🔧 API Plugin'de Kullanım

QueryResultContext implementasyonu tamamlandığında:

```typescript
async onAfterQuery<TResult>(
  result: TResult,
  context?: QueryResultContext
): Promise<TResult> {
  if (!context || !this.authConfig?.enabled) {
    return result;
  }

  // User create → Authentication create
  if (
    context.originalQuery.type === 'insert' &&
    context.originalQuery.table === this.userSchemaName &&
    result
  ) {
    const user = result as any;
    await this.createAuthenticationRecord(user);
  }

  // User email update → Authentication email sync
  if (
    context.originalQuery.type === 'update' &&
    context.originalQuery.table === this.userSchemaName &&
    context.originalQuery.data?.email
  ) {
    const user = result as any;
    await this.syncAuthenticationEmail(user.id, context.originalQuery.data.email);
  }

  // User delete → Authentication cascade delete
  if (
    context.originalQuery.type === 'delete' &&
    context.originalQuery.table === this.userSchemaName &&
    context.originalQuery.where?.id
  ) {
    await this.deleteAuthenticationRecord(context.originalQuery.where.id);
  }

  return result;
}
```

---

## ✅ Implementation Checklist

### Phase 1: Type Definitions
- [ ] `packages/types/src/plugin.ts` - QueryContext interface ekle
- [ ] `packages/types/src/plugin.ts` - QueryResultContext interface ekle
- [ ] `packages/types/src/plugin.ts` - ForjaPlugin interface güncelle (onBeforeQuery, onAfterQuery)
- [ ] `packages/core/src/plugin/plugin.ts` - BasePlugin güncelle

### Phase 2: Dispatcher
- [ ] `packages/core/src/dispatcher.ts` - dispatchAfterQuery signature değiştir (context ekle)
- [ ] `packages/core/src/dispatcher.ts` - dispatchBeforeQuery context support (optional)

### Phase 3: CRUD Integration
- [ ] `packages/core/src/mixins/crud.ts` - Her CRUD operasyonunda QueryResultContext oluştur
- [ ] CRUD operasyonlarında `dispatchAfterQuery(result, context)` çağrısı ekle:
  - [ ] findOne
  - [ ] findMany
  - [ ] create
  - [ ] update
  - [ ] delete
  - [ ] count

### Phase 4: API Plugin Activation
- [ ] `packages/api/src/plugin/api-plugin.ts` - onAfterQuery commented code'u aktif et
- [ ] Test: User create → authentication record create
- [ ] Test: User email update → authentication email sync
- [ ] Test: User delete → authentication cascade delete

---

## 🎯 Öncelik

**HIGH PRIORITY** - API Plugin şu an workaround ile çalışıyor (`_apiPlugin_*` flag'leri) ama QueryResultContext olmadan tam fonksiyonel değil.

---

## 📝 Notlar

- `user` field auth plugin entegrasyonu sonrası doldurulacak
- `metadata` Map, plugin'lerin birbirleriyle veri paylaşımı için kullanılabilir
- `executionTime` optional - performans monitoring için
- Backward compatibility: Context parametresi optional olduğu için mevcut plugin'ler break etmeyecek
