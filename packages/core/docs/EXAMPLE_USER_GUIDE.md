# Field Types

> **Hedef Kitle:** Forja kullanıcıları (schema tanımlayan developerlar)

Bu dokümanda Forja Core'un desteklediği 9 field type'ı detaylı örneklerle açıklıyoruz.

---

## String Field

Email, isim, açıklama gibi metin verileri için kullanılır.

### Temel Kullanım

```typescript
const userSchema = {
  name: 'User',
  fields: {
    email: {
      type: 'string',
      required: true
    }
  }
}
```

### Tüm Parametreler

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|-----------|----------|
| `type` | `'string'` | - | **Zorunlu.** Field tipi |
| `required` | `boolean` | `false` | Alan zorunlu mu? |
| `default` | `string` | `undefined` | Varsayılan değer |
| `minLength` | `number` | - | Minimum karakter sayısı |
| `maxLength` | `number` | - | Maximum karakter sayısı |
| `pattern` | `RegExp` | - | Regex pattern (email, telefon vb için) |
| `unique` | `boolean` | `false` | Unique constraint (database level) |
| `description` | `string` | - | Alan açıklaması |

### Örnekler

#### Email Alanı

```typescript
email: {
  type: 'string',
  required: true,
  unique: true,
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  description: 'Kullanıcı email adresi'
}
```

**Geçerli değerler:**
- ✅ `"user@example.com"`
- ✅ `"john.doe@company.co.uk"`
- ❌ `"invalid-email"` → Pattern hatası
- ❌ `""` → Required hatası
- ❌ `null` → Required hatası

#### Kullanıcı Adı

```typescript
username: {
  type: 'string',
  required: true,
  unique: true,
  minLength: 3,
  maxLength: 20,
  pattern: /^[a-zA-Z0-9_]+$/,
  description: 'Kullanıcı adı (alfanumerik ve _ karakteri)'
}
```

**Geçerli değerler:**
- ✅ `"john_doe"`
- ✅ `"user123"`
- ❌ `"ab"` → minLength hatası (minimum 3)
- ❌ `"john-doe"` → Pattern hatası (tire karakteri yok)
- ❌ `"a".repeat(21)` → maxLength hatası (maximum 20)

#### Açıklama/Bio

```typescript
bio: {
  type: 'string',
  required: false,
  maxLength: 500,
  default: '',
  description: 'Kullanıcı biyografisi'
}
```

**Geçerli değerler:**
- ✅ `"Developer from Istanbul"`
- ✅ `""` → Opsiyonel, boş olabilir
- ✅ `undefined` → Default değer kullanılır: `""`
- ❌ `"x".repeat(501)` → maxLength hatası

#### URL Alanı

```typescript
website: {
  type: 'string',
  required: false,
  pattern: /^https?:\/\/.+/,
  description: 'Kullanıcı web sitesi'
}
```

**Geçerli değerler:**
- ✅ `"https://example.com"`
- ✅ `"http://blog.example.com/posts"`
- ❌ `"example.com"` → Pattern hatası (http/https yok)
- ❌ `"ftp://example.com"` → Pattern hatası

### Validasyon

```typescript
import { validateField } from '@forja/core';

// Email validasyonu
const emailField = {
  type: 'string',
  required: true,
  pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
};

const result = validateField('user@example.com', emailField, 'email');

if (result.success) {
  console.log('Valid email:', result.data);
} else {
  console.log('Errors:', result.error);
  // [{ field: 'email', code: 'PATTERN', message: '...' }]
}
```

### Sık Kullanılan Pattern'ler

```typescript
// Email
pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Telefon (TR)
pattern: /^(\+90|0)?[0-9]{10}$/

// URL
pattern: /^https?:\/\/.+/

// Slug (URL-friendly)
pattern: /^[a-z0-9-]+$/

// Alfanumerik
pattern: /^[a-zA-Z0-9]+$/

// Sadece harfler
pattern: /^[a-zA-Z\s]+$/

// UUID
pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
```

### Dikkat Edilmesi Gerekenler

⚠️ **Pattern her zaman test edilmeli:**
```typescript
// ❌ Yanlış - başta/sonda anchor yok
pattern: /test/  // "testtest" geçerli olur

// ✅ Doğru - tam eşleşme
pattern: /^test$/  // Sadece "test" geçerli
```

⚠️ **minLength/maxLength boş string'i kontrol etmez:**
```typescript
bio: {
  type: 'string',
  minLength: 10
}

// "" (boş string) geçerlidir!
// Eğer boş olmasın istiyorsanız:
bio: {
  type: 'string',
  required: true,  // ← Bunu ekleyin
  minLength: 10
}
```

⚠️ **Unique constraint sadece database seviyesinde:**
```typescript
email: {
  type: 'string',
  unique: true  // Database'de unique index oluşturur
}

// Forja validator unique kontrolü YAPMAZ
// Database insert/update sırasında hata alırsınız
```

---

## Number Field

Yaş, fiyat, miktar gibi sayısal veriler için kullanılır.

### Temel Kullanım

```typescript
age: {
  type: 'number',
  required: true
}
```

### Tüm Parametreler

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|-----------|----------|
| `type` | `'number'` | - | **Zorunlu.** Field tipi |
| `required` | `boolean` | `false` | Alan zorunlu mu? |
| `default` | `number` | `undefined` | Varsayılan değer |
| `min` | `number` | - | Minimum değer (dahil) |
| `max` | `number` | - | Maximum değer (dahil) |
| `integer` | `boolean` | `false` | Sadece tam sayı mı? |
| `description` | `string` | - | Alan açıklaması |

### Örnekler

#### Yaş Alanı

```typescript
age: {
  type: 'number',
  required: true,
  min: 18,
  max: 120,
  integer: true,
  description: 'Kullanıcı yaşı'
}
```

**Geçerli değerler:**
- ✅ `18` → Minimum değer
- ✅ `25`
- ✅ `120` → Maximum değer
- ❌ `17` → min hatası
- ❌ `121` → max hatası
- ❌ `25.5` → integer hatası
- ❌ `"25"` → Type hatası (string)

#### Fiyat Alanı

```typescript
price: {
  type: 'number',
  required: true,
  min: 0,
  description: 'Ürün fiyatı (TL)'
}
```

**Geçerli değerler:**
- ✅ `99.99` → Ondalıklı sayılar OK
- ✅ `0` → Minimum değer
- ✅ `1000000`
- ❌ `-10` → min hatası
- ❌ `null` → required hatası

#### Rating/Puan

```typescript
rating: {
  type: 'number',
  required: false,
  min: 1,
  max: 5,
  default: 0,
  description: 'Kullanıcı puanı (1-5 arası)'
}
```

**Geçerli değerler:**
- ✅ `1` → Minimum
- ✅ `3.5` → Ondalıklı OK
- ✅ `5` → Maximum
- ✅ `undefined` → Default kullanılır: `0`
- ❌ `0` → min hatası
- ❌ `6` → max hatası

#### Stok Miktarı

```typescript
stock: {
  type: 'number',
  required: true,
  min: 0,
  integer: true,
  default: 0,
  description: 'Stok adedi'
}
```

**Geçerli değerler:**
- ✅ `0`
- ✅ `100`
- ❌ `50.5` → integer hatası
- ❌ `-5` → min hatası

### Validasyon

```typescript
import { validateField } from '@forja/core';

const ageField = {
  type: 'number',
  required: true,
  min: 18,
  max: 120,
  integer: true
};

// Geçerli
validateField(25, ageField, 'age');
// { success: true, data: 25 }

// Geçersiz - çok düşük
validateField(17, ageField, 'age');
// { success: false, error: [{ field: 'age', code: 'MIN_VALUE', ... }] }

// Geçersiz - ondalıklı
validateField(25.5, ageField, 'age');
// { success: false, error: [{ field: 'age', code: 'TYPE_MISMATCH', ... }] }
```

### Dikkat Edilmesi Gerekenler

⚠️ **min/max değerler dahil (inclusive):**
```typescript
age: { type: 'number', min: 18, max: 65 }

// ✅ 18 geçerli
// ✅ 65 geçerli
// ❌ 17 geçersiz
// ❌ 66 geçersiz
```

⚠️ **integer kontrolü strict:**
```typescript
count: { type: 'number', integer: true }

// ✅ 10 geçerli
// ❌ 10.0 geçersiz (JavaScript'te 10.0 === 10 ama yine de kontrol edilir)
// ❌ 10.5 geçersiz
```

⚠️ **String → Number dönüşümü otomatik YAPILMAZ:**
```typescript
age: { type: 'number' }

// ❌ "25" geçersiz - manuel parse etmelisiniz
// ✅ Number("25") veya parseInt("25")
```

⚠️ **Infinity ve NaN geçersizdir:**
```typescript
// ❌ Infinity
// ❌ -Infinity
// ❌ NaN
```

---

## Enum Field

Sabit/sınırlı seçenekler için kullanılır (durum, rol, kategori vb).

### Temel Kullanım

```typescript
status: {
  type: 'enum',
  values: ['draft', 'published', 'archived']
}
```

### Tüm Parametreler

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|-----------|----------|
| `type` | `'enum'` | - | **Zorunlu.** Field tipi |
| `values` | `string[]` | - | **Zorunlu.** İzin verilen değerler |
| `required` | `boolean` | `false` | Alan zorunlu mu? |
| `default` | `string` | `undefined` | Varsayılan değer (values içinde olmalı) |
| `description` | `string` | - | Alan açıklaması |

### Örnekler

#### Durum (Status)

```typescript
status: {
  type: 'enum',
  values: ['draft', 'published', 'archived'],
  default: 'draft',
  required: true,
  description: 'Gönderi durumu'
}
```

**Geçerli değerler:**
- ✅ `'draft'`
- ✅ `'published'`
- ✅ `'archived'`
- ✅ `undefined` → Default kullanılır: `'draft'`
- ❌ `'pending'` → values içinde yok
- ❌ `'Draft'` → Case-sensitive, büyük D geçersiz
- ❌ `null` → required hatası

#### Kullanıcı Rolü

```typescript
role: {
  type: 'enum',
  values: ['user', 'admin', 'moderator'],
  default: 'user',
  required: true,
  description: 'Kullanıcı rolü'
}
```

**Geçerli değerler:**
- ✅ `'user'`
- ✅ `'admin'`
- ✅ `'moderator'`
- ❌ `'superadmin'` → values içinde yok

#### Öncelik Seviyesi

```typescript
priority: {
  type: 'enum',
  values: ['low', 'medium', 'high', 'urgent'],
  required: false,
  description: 'Görev önceliği'
}
```

**Geçerli değerler:**
- ✅ `'low'`
- ✅ `'medium'`
- ✅ `'high'`
- ✅ `'urgent'`
- ✅ `undefined` → Opsiyonel, boş olabilir

#### Dil Seçimi

```typescript
language: {
  type: 'enum',
  values: ['tr', 'en', 'de', 'fr'],
  default: 'tr',
  description: 'Kullanıcı dili'
}
```

### TypeScript Type Safety

```typescript
// ✅ as const kullanarak type inference
const USER_ROLES = ['user', 'admin', 'moderator'] as const;

role: {
  type: 'enum',
  values: USER_ROLES,  // TypeScript type olarak da kullanılabilir
  default: 'user'
}

// Type:
type UserRole = typeof USER_ROLES[number]; // 'user' | 'admin' | 'moderator'
```

### Validasyon

```typescript
import { validateField } from '@forja/core';

const roleField = {
  type: 'enum',
  values: ['user', 'admin', 'moderator'],
  required: true
};

// Geçerli
validateField('admin', roleField, 'role');
// { success: true, data: 'admin' }

// Geçersiz
validateField('superadmin', roleField, 'role');
// { success: false, error: [{ field: 'role', code: 'INVALID_ENUM', ... }] }
```

### Dikkat Edilmesi Gerekenler

⚠️ **Case-sensitive:**
```typescript
status: { type: 'enum', values: ['draft', 'published'] }

// ✅ 'draft'
// ❌ 'Draft' → Geçersiz
// ❌ 'DRAFT' → Geçersiz
```

⚠️ **default değer values içinde olmalı:**
```typescript
// ❌ YANLIŞ
status: {
  type: 'enum',
  values: ['draft', 'published'],
  default: 'pending'  // ← values içinde yok!
}

// ✅ DOĞRU
status: {
  type: 'enum',
  values: ['draft', 'published'],
  default: 'draft'  // ← values içinde
}
```

⚠️ **Sadece string değerler:**
```typescript
// ❌ Number enum desteklenmiyor
priority: {
  type: 'enum',
  values: [1, 2, 3]  // HATA!
}

// ✅ String kullanın
priority: {
  type: 'enum',
  values: ['1', '2', '3']
}
```

---

## Boolean Field

Evet/hayır, aktif/pasif gibi iki değerli alanlar için.

### Temel Kullanım

```typescript
isActive: {
  type: 'boolean',
  default: true
}
```

### Tüm Parametreler

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|-----------|----------|
| `type` | `'boolean'` | - | **Zorunlu.** Field tipi |
| `required` | `boolean` | `false` | Alan zorunlu mu? |
| `default` | `boolean` | `undefined` | Varsayılan değer |
| `description` | `string` | - | Alan açıklaması |

### Örnekler

#### Aktif/Pasif

```typescript
isActive: {
  type: 'boolean',
  default: true,
  description: 'Kullanıcı aktif mi?'
}
```

**Geçerli değerler:**
- ✅ `true`
- ✅ `false`
- ✅ `undefined` → Default kullanılır: `true`
- ❌ `1` → Type hatası
- ❌ `0` → Type hatası
- ❌ `"true"` → Type hatası

#### Email Doğrulandı

```typescript
emailVerified: {
  type: 'boolean',
  required: true,
  default: false,
  description: 'Email doğrulandı mı?'
}
```

#### Haber Bülteni

```typescript
newsletter: {
  type: 'boolean',
  required: false,
  default: false,
  description: 'Haber bülteni almak istiyor mu?'
}
```

### Validasyon

```typescript
import { validateField } from '@forja/core';

const activeField = {
  type: 'boolean',
  required: true
};

// Geçerli
validateField(true, activeField, 'isActive');
// { success: true, data: true }

validateField(false, activeField, 'isActive');
// { success: true, data: false }

// Geçersiz
validateField(1, activeField, 'isActive');
// { success: false, error: [...] }
```

### Dikkat Edilmesi Gerekenler

⚠️ **Truthy/Falsy değerler otomatik dönüştürülmez:**
```typescript
isActive: { type: 'boolean' }

// ❌ 1 geçersiz (JavaScript'te truthy ama boolean değil)
// ❌ 0 geçersiz
// ❌ "true" geçersiz
// ❌ "" geçersiz
// ✅ true geçerli
// ✅ false geçerli
```

⚠️ **null ve undefined farklıdır:**
```typescript
newsletter: { type: 'boolean', required: false }

// ✅ undefined → Opsiyonel, boş olabilir
// ❌ null → Type hatası
```

---

## Özet

Bu dokümanda **5 temel field type'ı** detaylı inceledik:
- ✅ String - Email, username, bio vb
- ✅ Number - Yaş, fiyat, stok vb
- ✅ Enum - Durum, rol, kategori vb
- ✅ Boolean - Aktif/pasif, doğru/yanlış vb
- ⏭️ Sonraki: Date, JSON, Array, Relation, File

**Not:** Kalan 4 field type (Date, JSON, Array, Relation, File) ayrı dokümanda detaylandırılacak.
