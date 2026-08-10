# Link Önizleme / Tıklama Takip Servisi

SMS içine koyduğunuz linkin, müşteri tıklamadan **önizlemesinin yapılıp yapılmadığını**
ve ayrıca gerçekten **tıklanıp tıklanmadığını** ayrı ayrı raporlayan basit bir servis.

## Nasıl çalışır?

WhatsApp, Telegram, iMessage gibi uygulamaların çoğu, gelen bir mesajdaki linkin
önizleme kartını (başlık/görsel) oluşturmak için **kendi sunucularından** o linke
otomatik bir istek atar — kullanıcı linke dokunmadan. Bu istek genelde farklı bir
`User-Agent` ile gelir (örn. `WhatsApp/2.x`, `TelegramBot`, `facebookexternalhit`).

Bu servis:
1. Sizin için kısa bir takip linki üretir (SMS'e bunu koyarsınız).
2. Bu linke gelen her isteğin User-Agent'ına bakarak "önizleme" mi "gerçek tıklama" mı
   olduğunu sınıflandırır.
3. Kullanıcıyı asıl hedef sayfaya yönlendirir.
4. Panel/API üzerinden kaç önizleme, kaç tıklama olduğunu gösterir.

⚠️ **Sınırlama:** Bu yöntem çoğu popüler uygulama için güvenilir çalışır, ama
%100 garanti değildir — bazı istemciler önizlemeyi cihaz üzerinde, sunucuya hiç
istek göndermeden oluşturabilir. Ayrıca User-Agent tabanlı sınıflandırma zamanla
güncellenmesi gereken bir listeye dayanır (`server.js` içindeki
`PREVIEW_BOT_PATTERNS`).

## Kurulum

```bash
npm install
npm start
```

Servis varsayılan olarak `http://localhost:3000` üzerinde çalışır.
Gerçek kullanımda bunu kendi sunucunuza/hostinginize deploy edip
`BASE_URL` ortam değişkenini kendi alan adınızla ayarlamanız gerekir:

```bash
BASE_URL=https://linktakip.sizinalanadiniz.com PORT=3000 npm start
```

Not: Bu linkin müşteriye SMS ile ulaşabilmesi için servisin **internete açık**
bir adreste (kendi sunucunuz, VPS, Render/Railway/Vercel vb.) çalışması gerekir.

## Kullanım

### 1. Panel üzerinden
`http://localhost:3000/dashboard` adresine gidin, hedef URL'yi (müşteriye
göndermek istediğiniz gerçek sayfa/ürün linki) girip "Yeni Takip Linki Oluştur"a
basın. Size verilen kısa linki SMS içine koyun.

### 2. API üzerinden
```bash
curl -X POST http://localhost:3000/api/links \
  -H "Content-Type: application/json" \
  -d '{"destination":"https://siteniz.com/urun/123","customer":"Ayşe Y.","campaign":"agustos-kampanya"}'
```

Yanıt:
```json
{
  "code": "a1b2c3d4",
  "trackingUrl": "http://localhost:3000/r/a1b2c3d4",
  "reportUrl": "http://localhost:3000/api/report/a1b2c3d4"
}
```

`trackingUrl` değerini SMS metnine koyun.

### 3. Raporu görüntüleme
```bash
curl http://localhost:3000/api/report/a1b2c3d4
```

Örnek yanıt:
```json
{
  "code": "a1b2c3d4",
  "ozet": {
    "onizlemeSayisi": 1,
    "tiklamaSayisi": 0,
    "ilkOnizlemeZamani": "2026-08-10T09:12:00.000Z",
    "ilkTiklamaZamani": null
  },
  "events": [ ... ]
}
```

Bu durum "müşteri mesajı açtı/önizledi ama linke henüz tıklamadı" anlamına gelir.

## KVKK ile ilgili not

Bu servis IP adresi ve User-Agent gibi verileri kaydeder; bunlar KVKK kapsamında
kişisel veri sayılabilir. Müşterinize gönderdiğiniz aydınlatma metninde, gönderilen
linklerin etkileşim/analiz amacıyla takip edildiğini de belirtmeniz önerilir.
