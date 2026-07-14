# Bir Dosya Sistemini Veritabanı Gibi Davranmaya İkna Etmek: adapter-json'un İçinde

Datrix'in core paketini incelediğim yazıda üç katmanlı sorumluluk modelinden bahsetmiştim:
query builder yapıyı doğrular, executor veriyi doğrular, adapter sadece çeviri yapar — "asla
veri doğrulama" kuralıyla. Bu sefer o kuralın en ilginç test edildiği yere baktım: gerçek bir
veritabanı motoru olmayan, üstüne bir de dosya sistemi kullanan `@datrix/adapter-json`.

Bu paket README'sinde kendini net bir şekilde konumlandırıyor: geliştirme, test, prototipleme,
statik site build-time verisi. Production'da yüksek trafik için değil. Bu dürüstlük iyi bir
başlangıç noktası — çünkü kodun geri kalanı da bu sınırı ciddiye alarak yazılmış.

## Ne yapıyor: bir JSON dosyasını "tablo" gibi davranmaya zorlamak

Her tablo, `{root}/{tableName}.json` altında tek bir dosya. Dosyanın içi basit:

```json
{
  "meta": { "version": 1, "name": "users", "lastInsertId": 3, "updatedAt": "..." },
  "data": [{ "id": 1, "name": "Alice" }, { "id": 2, "name": "Bob" }]
}
```

Bir SELECT geldiğinde adapter dosyayı okur (ya da cache'ten alır), `data` array'ini filtreler,
sıralar, sayfalar, projekte eder — hepsi bellekte, JavaScript ile. Bir INSERT geldiğinde array'e
push eder, dosyayı yeniden yazar. Kavramsal olarak bu bir "veritabanı" değil, bir
"in-memory-array-üzerinde-SQL-benzeri-işlemler-simülatörü + dosyaya senkronizasyon". Bunu
anlamak önemli, çünkü kodun neredeyse her tasarım kararı bu gerçekten türüyor.

Şemanın kendisi de core'un beklediği gibi `_datrix` adlı özel bir tabloda JSON olarak saklanıyor
— bu, core'un migration-diff mekanizmasıyla birebir uyumlu (iki JSON'u karşılaştırmak,
introspection'ın dialect tuhaflıklarına takılmaktan çok daha basit). `adapter-postgres` veya
`adapter-mysql` neyi nasıl sakladığını bir kez öğrenip aynı şemayı burada da bulmak, adapter'lar
arası geçişi gerçekten pratik hale getiriyor.

## WHERE motoru: SQL'i taklit etmek göründüğünden zor

`runner.ts`'deki `match()`/`matchOperators()` fonksiyonları aslında küçük bir sorgu motoru.
`$eq`, `$gt`, `$in`, `$like`, `$regex`, iç içe `$and`/`$or`/`$not`, hatta ilişki alanları
üzerinden nested WHERE (`{ author: { verified: { $eq: true } } }`) — bunların hepsi elle,
regex ve tip coercion ile simüle ediliyor.

Burada gördüğüm en dikkat çekici şey, tip coercion'ın ciddiye alınmış olması: `compareValues` ve
`coerceForComparison`, alanın şema tipine bakıp (`number`, `string`, `date`, `boolean`) değerleri
karşılaştırmadan önce normalize ediyor. Bu, "dosyadan okunan değer string, sorgudan gelen değer
number, ikisi hiç eşleşmiyor" sınıfı hataları — ki JSON tabanlı bir sistemde bu sınıf hata
neredeyse garantidir — mimari düzeyde önlemeye çalışan bir tasarım. `date` alanları özellikle
kırılgan bir nokta: cache'teki taze bir satır `Date` objesi taşıyabilir, diskten yeni okunan
aynı satır ISO string taşır; adapter ikisini de aynı epoch-millis değerine indirip
karşılaştırıyor. Bu ayrım gözden kaçırılırsa (ki kolay kaçırılır) tarih aralığı sorguları
sessizce boş döner — motorun en sinsi hata modlarından biri, çünkü hata fırlatmaz, sadece
yanlış (boş) sonuç döner.

`$like`/`$ilike`, SQL wildcard'larını (`%`, `_`) regex'e çeviren bir yaklaşım kullanıyor.
Burada dikkat edilmesi gereken incelik, kullanıcı pattern'inin regex özel karakterleri (`.`,
`(`, `+`...) içerebileceği ve bunların regex motoruna geçmeden önce escape edilmesi gerektiği.
Aynı hassasiyet `$startsWith`/`$contains` gibi adapter'ın kendisinin `%` eklediği operatörlerde
de gerekli — kullanıcı değerindeki `%` karakteri kelimenin gerçek anlamıyla "wildcard" olarak
yorumlanmamalı. Bu tür detaylar, "SQL'i taklit etmek" işinin göründüğünden çok daha fazla dikkat
gerektirdiğinin küçük ama somut kanıtları.

## Populate: N tane küçük JOIN, elle yazılmış

Postgres adapter'ı populate için üç strateji sunuyordu (JSON aggregation, LATERAL join, batched
IN); burada tek bir strateji var çünkü SQL yok — her ilişki türü için ayrı bir eşleme mantığı
elle yazılmış. `belongsTo` bir Map ile FK→kayıt eşlemesi kuruyor, `hasMany`/`hasOne` kaynak
ID'lerine göre gruplama yapıyor, `manyToMany` junction tablosunu okuyup iki taraflı bir mapping
inşa ediyor.

Burada karşılaşılan asıl mühendislik sorunu SQL'de bedava gelen şeyleri elle yeniden inşa etmek:
populate seviyesinde bir `where`/`orderBy`/`limit` istendiğinde, adapter'ın **ilişkili tablonun
alt kümesini** filtrelemesi gerekiyor — SQL'de bu bir JOIN + WHERE, burada ilişkili satırları
tekrar bir `JsonQueryRunner`'a sarıp aynı filtreleme/sıralama mantığını ikinci kez çalıştırmak
demek. Bunu N kere (her aday satır için) yapmakla, bir kere toplu yapıp sonucu bir Set'e
indirgemek arasındaki fark performans açısından ciddi — küçük bir tabloda fark edilmez, birkaç
bin satırlık bir ilişkide fark yaratır. Kodun bu tür yerlerde "doğru ama naif" ile "doğru ve
verimli" arasında gidip gelen bir karakteri var; ilişki türüne göre olgunluk seviyesi
homojen değil.

## Kilitleme ve transaction: dosya sistemiyle ACID'i taklit etmek

Burası paketin en dürüst olmayı zorlandığı yer, çünkü "transaction" kelimesi kullanıcıda gerçek
bir veritabanının çağrışımını yapıyor ama burada transaction, tek bir process içinde tek bir
global kilidin arkasında sıraya girmek anlamına geliyor.

`SimpleLock`, dosya sistemi üzerinde `wx` flag'iyle (dosya varsa fail et) atomik bir kilit
dosyası oluşturuyor — Node'un tek gerçek "atomic create" primitifi bu, ve doğru kullanılmış.
Kilidin kendi kimliğini taşıması (hangi process/hangi acquire'ın kilidi bu) ve düzenli aralıklarla
tazelenmesi, "kilit tutan process yavaş ama canlı" ile "kilit tutan process çökmüş" ayrımını
yapabilmek için gerekli — bu ayrım yapılmazsa ya uzun süren bir işlem ortasında kilidi
kaybeder ya da çökmüş bir process sonsuza kadar herkesi bloke eder. İkisi de kullanıcıya çok
kötü hissettirir; biri "rastgele veri bozulması", diğeri "adapter donuyor" olarak görünür.

Transaction tarafında ilginç olan, tek bir process içinde "hangi çağrının transaction'a ait
olduğu" bilgisinin nasıl taşındığı. Naif bir yaklaşım her fonksiyona bir flag paslamak olurdu —
ama bu paket onlarca çağrı noktasından geçen (runner → populate → table-utils → adapter) bir
zincir, ve flag'i her yerde elle taşımak "bir yerde unutulursa sessizce yanlış cache'i okur"
riskini kalıcı hale getirirdi. Bunun yerine çağrı bağlamının kendisi (JavaScript'in async
call stack'i) "bu ben miyim" sorusuna cevap veriyor. Bu, "parametre ekle" ile "context'i taşı"
arasındaki klasik mühendislik tercihinin küçük ölçekte iyi bir örneği — az kod, ama anlaşılması
biraz daha soyut.

Asıl felsefi soru şu kalıyor: bir process içinde transaction'lar birbirini bekleyerek
serileştirilebilir, ama bu paket birden fazla process'i (birden fazla Node instance'ını)
aynı dosyaya yazarken koordine ediyor. Dosya kilidi bunu process'ler arası da çözüyor, ama commit
işlemi kendisi atomik değil — birden fazla tablo değiştiren bir transaction, N. tabloyu yazarken
başarısız olursa 1'den N-1'e kadar olan tablolar zaten diske yazılmış olur, geri alınamaz. Bu,
"gerçek ACID" ile "ACID'e benzeyen davranış" arasındaki farkın somutlaştığı yer — tek tablo
işlemleri için fark yok, çok tablolu bir işlemin ortasında kesinti olursa fark var.

## Kalıcılık: "yazdım" ile "yazdığımdan eminim" arasındaki fark

Bir dosyaya `write` çağırmak ile bir dosyayı **güvenle** değiştirmek aynı şey değil. Bir process
yazma ortasında çökerse, ya da varsayılan ayarlarla kilitsiz bir okuma yazma ile aynı ana denk
gelirse, dosyanın yarısı eski içerik yarısı yeni içerik olabilir — bu durumda `JSON.parse` ya
patlar ya da sessizce anlamsız bir obje üretir. "Önce geçici bir dosyaya yaz, sonra hedefin
üzerine taşı" deseni (rename işlemi aynı dosya sisteminde atomik kabul edilir) bu riski ortadan
kaldırıyor — okuyan taraf ya tamamen eski içeriği ya tamamen yeni içeriği görür, asla ikisinin
karışımını görmez.

Import/export akışı da benzer bir mantıkla düşünülmüş: tüm veriyi önce ayrı bir staging
dizinine yazıp, ancak HER ŞEY başarıyla yazıldıktan sonra gerçek dizine taşımak. Naif yaklaşım
(önce mevcut tabloları sil, sonra yeni veriyi yaz) teknik olarak daha az kod gerektirir ama
riski açık: import ortasında herhangi bir hata, önceki tüm veriyi kalıcı olarak kaybettirir.
Staging yaklaşımı biraz daha fazla disk I/O'su ve biraz daha fazla kod ister, ama "hata olursa
en kötü ihtimalle hiçbir şey değişmez" garantisini satın alır. Bir veri taşıma aracında bu
takas neredeyse her zaman doğru yöndedir.

## Cache: hız ile doğruluk arasında ince bir çizgi

mtime tabanlı cache mekanizması basit ve etkili: dosyanın son değiştirilme zamanı değişmediyse
belleğe alınmış parse edilmiş içerik geçerlidir. Ama bir array/obje referansını cache'te
tutmanın gizli bir tehlikesi var: eğer o referansı doğrudan çağırana verirseniz ve çağıran
(ya da adapter'ın kendi populate mantığı) o objenin üzerine yeni alanlar yazarsa, bu değişiklik
artık cache'in kendisinde yaşıyor demektir — sonraki bir yazma işlemi bu "kirlenmiş" veriyi
sessizce diske kalıcı hale getirebilir. Bu tür bir hata özellikle sinsi, çünkü hiçbir yerde
hata fırlatmaz; sadece bir süre sonra dosyada olmaması gereken alanlar belirir.

Çözüm kavramsal olarak basit ama disiplin ister: bir satırı ya da tabloyu mutasyona açık hale
getirmeden önce onu kopyalamak, ve bir yazma işleminde diske yazım başarılı olana kadar cache'in
orijinal haline dokunmamak. "Kopyala, sonra değiştir" ile "değiştir, sonra umut et" arasındaki
fark, bir yazma başarısız olduğunda cache'in tutarlı kalıp kalmayacağını belirliyor.

## Kim için mantıklı, kim beklemeli

README kendi sınırlarını zaten net çiziyor ve kod bu sınırları ciddiye almış durumda: küçük
veri setleri, düşük eşzamanlı yazma, geliştirme/test/prototipleme, statik site build-time
verisi. Bu senaryolarda adapter'ın verdiği söz (SQL adapter'larla aynı `QueryObject`
sözleşmesi, aynı ilişki davranışı, aynı hata tipleri) gerçekten tutuluyor — bir Postgres
adapter'ından JSON adapter'ına geçip testlerin aynı şekilde çalışması, üç katmanlı mimarinin
somut bir kanıtı.

Ama bazı gerçekler değişmiyor: bu, tüm tabloyu belleğe alıp JavaScript ile filtreleyen bir
motor. Satır sayısı arttıkça doğrusal olmayan bir yavaşlama değil ama kesinlikle doğrusal bir
maliyet var — binlerce satırlık bir tabloda her sorgu tüm satırları tarıyor. Çok tablolu
transaction'lar tam ACID garantisi vermiyor. Ve dosya kilidi, tek makine üstünde birden fazla
process'i koordine edebilir ama dağıtık bir sistemde (birden fazla makine, paylaşılan dosya
sistemi olmadan) hiçbir işe yaramaz.

Bu adapter'ı seçen birinin sorması gereken soru "bu production'da çalışır mı" değil —
zaten cevap README'de yazılı. Asıl soru: geliştirme döngünüzde, test suite'inizde, ya da
küçük bir statik projede, gerçek bir veritabanı kurmanın getirdiği operasyonel yükü almadan,
production'daki adapter'la (davranışsal olarak) aynı sözleşmeyi konuşan bir şeye ihtiyacınız
var mı? Cevap evetse, burada gördüğüm kod o sözü tutmak için gerçekten uğraşmış.
