# Datrix'in Mutfağına Bakış: Bir TypeScript ORM'inin Core Katmanını Satır Satır Okumak

Bir ORM'i değerlendirmenin iki yolu var: README'sini okumak ya da kaynak kodunu okumak.
Bu yazı ikincisini yaptıktan sonra yazıldı — Datrix'in core paketindeki yaklaşık 13.000 satırı
(query builder, executor, validator, schema registry ve migration sistemi) satır satır inceledim.
Aşağıda ne bulduğumu anlatacağım: mimari fikirleri, gerçekten iyi çalışan tarafları ve henüz
olgunlaşmamış köşeleri.

## Datrix nedir?

Datrix, TypeScript-first bir veritabanı yönetim framework'ü. Kendisini "mevcut projeye takılan
bir plugin" olarak konumlandırıyor: şemalarınızı `defineSchema()` ile tanımlıyorsunuz,
`defineConfig()` ile bir adapter (Postgres, MySQL...) bağlıyorsunuz ve karşılığında tip güvenli
CRUD, otomatik ilişki yönetimi, migration ve — `@datrix/api` paketiyle — otomatik REST endpoint'leri
alıyorsunuz.

```ts
const post = defineSchema({
  name: "Post",
  fields: {
    title: { type: "string", required: true, maxLength: 200 },
    author: { type: "relation", kind: "belongsTo", model: "User" },
    tags: { type: "relation", kind: "manyToMany", model: "Tag" },
  },
});

// id, createdAt, updatedAt otomatik. FK kolonu (authorId) otomatik.
// post_tag junction tablosu otomatik.
await datrix.create("Post", { title: "Merhaba", author: 5, tags: [1, 2, 3] });
```

Strapi'nin şema yaklaşımıyla Prisma'nın kod-içi tanım yaklaşımı arasında bir yerde duruyor;
ama ikisinden farklı olarak şema tanımı düz TypeScript objesi ve çalışma zamanında yaşıyor —
codegen adımı yok.

## Mimarinin omurgası: üç katmanlı sorumluluk modeli

Datrix'in en net tasarım kararı, doğrulama sorumluluğunu üç katmana kesin çizgilerle bölmesi:

```
Query Builder  →  yapısal doğrulama (alan var mı, operatör geçerli mi, tip coercion)
Executor       →  veri doğrulama (required, min/max, pattern, enum) + timestamp + ilişkiler
Adapter        →  SADECE SQL çevirisi (parametrize sorgu, tip dönüşümü)
```

Kritik kural şu: **adapter asla veri doğrulamaz.** Query builder her adapter için ayrı sorgu
üretmez; standart bir `QueryObject` üretir, adapter bu standardı okur. Bu, adapter yazmayı
ciddi biçimde kolaylaştırıyor — adapter'a ulaşan `where` içindeki her değer çoktan tip'ine
çevrilmiş, her alan adı şemaya karşı kontrol edilmiş oluyor. `"5"` string'i number alana
gidiyorsa builder onu `5`'e çevirmiş, `categoryId` diye bir alan yoksa sorgu adapter'ı hiç
görmeden patlamış oluyor.

Bu disiplinin pratik bir sonucu daha var: aynı `QueryObject`'i okuyan her adapter aynı davranışı
verir. ORM'lerde "Postgres'te çalışıyordu, MySQL'de farklı davranıyor" sınıfı hataların ana
kaynağı, doğrulamanın adapter'lara sızmasıdır; Datrix bu kapıyı mimari olarak kapatmış.

## Öne çıkan yetenekler

**İlişki yönetimi gerçekten otomatik.** `belongsTo`, `hasOne`, `hasMany`, `manyToMany` —
dördü de destekleniyor ve FK kolonları ile junction tabloları registry tarafından üretiliyor.
İlişki yazarken kısayollar bol: `author: 5`, `tags: [1, 2, 3]`, ya da Prisma-vari
`{ connect, disconnect, set, create, update, delete }` operasyonları. Nested create bile var:

```ts
await datrix.create("Post", {
  title: "Yeni",
  author: { create: { name: "John", company: { create: { name: "Acme" } } } },
});
```

Executor bunu "resolve-then-link" stratejisiyle işliyor: önce create/update/delete işlemleri
**bir kez** çalışıyor, üretilen ID'ler connect listelerine ekleniyor, sonra her kayıt için
sadece ID bazlı bağlama yapılıyor. Bu, "N kayıt güncellerken nested create N kez çalışıp
duplicate üretti" felaketini tasarım düzeyinde engelleme girişimi.

**Bulk-first felsefe.** Datrix'in az konuşulan ama kodda net hissedilen bir duruşu var:
core, döngü içinde N sorgu atmayı reddediyor. Bulk insert'te ilişkiler tüm kayıtlara aynı
şekilde uygulanıyor ("bu 5 ürün, hepsi şu kategoride") — kayıt başına farklı ilişki isteyen,
kendi döngüsünü kendisi yazıyor. Bu bir eksiklik değil, bilinçli bir sınır: ORM'in size sessizce
N+1 sorgu ürettiği dünyada, "ben bunu yapmam, sen yap" diyen bir framework dürüst bir framework'tür.
(Tek eleştirim: bu sözleşme henüz dokümantasyonda yeterince bağırmıyor.)

**Populate esnekliği.** `populate('*')`, `populate(['author.company'])` (dot notation),
nested `{ select, where, limit, orderBy }` opsiyonları — hepsi normalize edilip adapter'a tek
formatta iniyor. Postgres adapter'ı üç strateji destekliyor: JSON aggregation, LATERAL join,
batched IN. Hidden alanlar (FK kolonları) wildcard'lardan otomatik ayıklanıyor.

**Migration sistemi sürprizli derecede iddialı.** Çoğu genç ORM migration'ı "diff al, DDL üret"
düzeyinde bırakır. Datrix bir adım öteye gidip **belirsizlik tespiti** yapıyor: bir kolon silinip
benzer bir kolon eklendiyse "bu bir rename mi, drop+add mi?" diye soruyor ve cevaba göre veri
kaybını önlüyor. Daha da ilginci, ilişki tipi değişimlerini tanıyor: `belongsTo`'yu `manyToMany`'ye
çevirdiğinizde "mevcut FK değerlerini junction tablosuna taşıyayım mı?" diye sorup gerçekten
taşıyan bir data-transfer adımı enjekte ediyor. Runner üç fazlı çalışıyor (createTable →
transaction içinde DML/alter → commit sonrası dropTable), bu sayede başarısız bir migration
veri kaybettirmeden geri alınabiliyor. Şemanın kendisi de veritabanında JSON olarak saklandığı
için diff işlemi iki JSON'u karşılaştırmaya indirgeniyor — introspection'ın dialect
tuhaflıklarına takılmıyor.

**Plugin sistemi ve hook zinciri.** `onBeforeQuery`/`onAfterQuery` plugin hook'ları ile şema
düzeyinde `beforeCreate`/`afterFind` lifecycle hook'ları var; plugin'ler sorguyu zincirleme
değiştirebiliyor. `datrix.raw` ile hook'ları tamamen atlayan bir kaçış kapısı da düşünülmüş —
migration history gibi iç işlemler bu yoldan gidiyor.

**Sıfır bağımlılıklı validator.** Zod/Joi yerine kendi field-validator'ı var: min/max, pattern,
enum, array kısıtları (minItems/unique), custom validator, derinlik limitli recursive array
doğrulama. Hata modeli de düzgün: `abortEarly` kapalıyken tüm hatalar tek seferde,
alan/kod/beklenen-değer yapısında toplanıyor.

## Zayıf yanlar ve olgunlaşma alanları

Kodu detaylı okumanın bedeli, kusurları da detaylı görmek. Dürüst olalım:

**Doğrulama kalkanında delikler var.** Katman modeli `where` ve `select` için kusursuz işliyor
ama `orderBy`, `groupBy` ve `having` şu an bu kalkanın dışında — alan adları şemaya karşı
doğrulanmadan adapter'a iniyor. Aynı şekilde populate içindeki `where` da normalize edilmiyor.
Adapter'lar identifier'ları escape ettiği için bu bir güvenlik felaketi değil, ama "core'un
yakaladığını adapter tekrar kontrol etmez" sözleşmesinin ihlali ve şu an bilinen en önemli açık.

**Sessizlik en büyük düşman.** İncelemede bulduğum hataların ortak deseni hata fırlatmak yerine
sessiz kalmak: geçersiz bir ID `NaN`'a dönüşüp sorguya karışabiliyor, desteklenmeyen bir ilişki
formatı sessizce yutulabiliyor, `populate: { rel: false }` yanlışlıkla `true` gibi davranıyor.
Bunların hiçbiri mimari kusur değil — hepsi "throw eklenecek yer" — ama bir ORM'de sessiz veri
bozulması, gürültülü çökmekten çok daha tehlikelidir.

**Self-referential ilişkiler henüz güvenilir değil.** `Category → parent Category` gibi kendine
dönen hasMany'de FK kaydı kaybolabiliyor; self manyToMany'de (arkadaşlık tablosu senaryosu)
kaynak ve hedef FK aynı ada düşüp çakışıyor. Ağaç yapısı veya graf modelleyecekseniz bugün
Datrix'i zorlarsınız.

**ID politikası: sadece number.** Bilinçli bir karar — bazı hedef adapter'lar string PK
desteklemiyor — ama UUID tabanlı mimarilerle çalışanlar için elenme sebebi. Otomatik artan
numeric `id` her şemada zorunlu ve rezerve.

**Migration diff'inde false-positive riski.** Diff mekanizması `pattern` (RegExp) ve `default`
gibi alanları referans karşılaştırmasıyla ölçüyor; DB'den JSON olarak yüklenen eski şemayla
bellek içi tanım hiçbir zaman referans-eşit olamayacağı için bu alanlar "sürekli değişmiş"
görünebiliyor. Auto-migration açıkken bu, gereksiz belirsizlik sorularına ve init kilitlenmesine
dönüşebiliyor.

**Test kapsamı her yere yetişmemiş.** 86 test dosyası ve %80 coverage eşiği var; ama plugin'lerin
şema genişletme yolu (`extendSchemas`) gibi bazı özellikler, mevcut haliyle çalışamayacak durumda
olmasına rağmen testlerden yakalanmamış. Coverage yüzdesi yüksek olsa da kritik yolların bazıları
hiç egzersiz edilmemiş.

Bu maddelerin tamamı proje içinde ayrıntılı bir issue listesinde takip ediliyor ve çoğu
"mekanik düzeltme" sınıfında — mimariyi değiştirmeden, tarif edilmiş fix'lerle kapanabilir durumda.

## Kim kullanmalı, kim beklemeli?

**Bugün mantıklı olduğu yer:** TypeScript monorepo'sunda, şeması kod içinde yaşayan, ilişki
yönetimini ve REST API üretimini otomatikleştirmek isteyen, numeric ID'lerle mutlu, yeni
projeler. Katman modeli sayesinde ileride adapter değiştirmek gerçekçi bir opsiyon.

**Beklemesi gerekenler:** UUID/string PK zorunluluğu olanlar, self-referential ilişki (ağaç,
graf, arkadaşlık) modelleyecekler ve production'da auto-migration'a yaslanmak isteyenler.
Bu üç alan da yol haritasında ama bugün orada değil.

## Kapanış

Datrix'in kodunu okuduktan sonra aklımda kalan cümle şu: **doğru omurga, eksik kas.**
Üç katmanlı sorumluluk modeli, standart QueryObject sözleşmesi, resolve-then-link ilişki
stratejisi ve belirsizlik-farkındalıklı migration sistemi — bunlar sonradan eklenemeyen,
baştan doğru kurulması gereken şeyler ve Datrix'te baştan doğru kurulmuşlar. Eksikler ise
büyük oranda kenar durumlarında hata fırlatmayı unutmuş kod yolları; sıkıcı ama tarifli işler.

Genç bir ORM'de tercih edeceğiniz kombinasyon tam olarak bu: mimari borç yok, mühendislik
borcu var. İlki ödenmez, ikincisi ödenir.
