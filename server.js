/**
 * Link Önizleme / Tıklama Takip Servisi
 * ---------------------------------------
 * KVKK onaylı müşterilere kısa mesajla gönderilen linklerin
 * "önizleme" (mesajlaşma uygulaması tarafından otomatik çekilen)
 * mi yoksa "gerçek tıklama" mı olduğunu ayırt edip raporlar.
 *
 * Çalıştırma:
 *   npm install
 *   npm start
 *
 * Ortam değişkeni:
 *   PORT (varsayılan 3000)
 *   BASE_URL (örn: https://linktakip.sizinalanadiniz.com)
 */

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, "db.json");

// ---------- Basit JSON veritabanı ----------
function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ links: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ---------- Önizleme (bot) tespiti ----------
// Mesajlaşma / sosyal platformların link önizlemesi oluşturmak için
// kendi sunucularından attığı isteklerin User-Agent imzaları.
const PREVIEW_BOT_PATTERNS = [
  /WhatsApp/i,
  /facebookexternalhit/i,
  /Facebot/i,
  /TelegramBot/i,
  /Slackbot/i,
  /Slack-ImgProxy/i,
  /Twitterbot/i,
  /SkypeUriPreview/i,
  /Discordbot/i,
  /LinkedInBot/i,
  /vkShare/i,
  /Google-InspectionTool/i,
  /GoogleImageProxy/i,
  /Applebot/i,
  /Bitly/i,
  /Iframely/i,
  /Embedly/i,
  /redditbot/i,
  /viber/i,
];

// Gerçek bir mobil tarayıcıdan geldiğini gösteren tipik imzalar
const REAL_BROWSER_PATTERNS = [
  /Mobile Safari/i,
  /CriOS/i, // Chrome iOS
  /FxiOS/i, // Firefox iOS
  /Version\/.*Mobile/i,
  /Android.*Chrome/i,
  /SamsungBrowser/i,
];

function classifyRequest(userAgent = "") {
  const ua = userAgent || "";
  if (PREVIEW_BOT_PATTERNS.some((re) => re.test(ua))) return "onizleme";
  if (REAL_BROWSER_PATTERNS.some((re) => re.test(ua))) return "tiklama";
  return "belirsiz";
}

function generateCode() {
  return crypto.randomBytes(4).toString("hex"); // 8 karakterlik kısa kod
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress;
}

// ---------- API: Yeni takip linki oluştur ----------
// body: { destination: "https://...", customer: "Ad Soyad (opsiyonel)", campaign: "opsiyonel etiket" }
app.post("/api/links", (req, res) => {
  const { destination, customer, campaign } = req.body || {};
  if (!destination || !/^https?:\/\//i.test(destination)) {
    return res.status(400).json({ error: "Geçerli bir 'destination' URL'si gerekli." });
  }

  const db = loadDb();
  const code = generateCode();

  db.links[code] = {
    code,
    destination,
    customer: customer || null,
    campaign: campaign || null,
    createdAt: new Date().toISOString(),
    events: [],
  };
  saveDb(db);

  res.json({
    code,
    trackingUrl: `${BASE_URL}/r/${code}`,
    reportUrl: `${BASE_URL}/api/report/${code}`,
  });
});

// ---------- Tüm linkleri listele ----------
app.get("/api/links", (req, res) => {
  const db = loadDb();
  const list = Object.values(db.links).map((l) => ({
    code: l.code,
    destination: l.destination,
    customer: l.customer,
    campaign: l.campaign,
    createdAt: l.createdAt,
    onizlemeSayisi: l.events.filter((e) => e.type === "onizleme").length,
    tiklamaSayisi: l.events.filter((e) => e.type === "tiklama").length,
  }));
  res.json(list);
});

// ---------- Müşteriye gönderilecek asıl link ----------
// Bu URL SMS içine konur. İstek geldiğinde loglanır ve hedefe yönlendirilir.
app.get("/r/:code", (req, res) => {
  const db = loadDb();
  const link = db.links[req.params.code];

  if (!link) {
    return res.status(404).send("Link bulunamadı.");
  }

  const userAgent = req.headers["user-agent"] || "";
  const type = classifyRequest(userAgent);

  link.events.push({
    timestamp: new Date().toISOString(),
    ip: getClientIp(req),
    userAgent,
    type, // "onizleme" | "tiklama" | "belirsiz"
    method: req.method,
  });
  saveDb(db);

  res.redirect(302, link.destination);
});

// ---------- Tek bir linkin raporu ----------
app.get("/api/report/:code", (req, res) => {
  const db = loadDb();
  const link = db.links[req.params.code];
  if (!link) return res.status(404).json({ error: "Link bulunamadı." });

  const previews = link.events.filter((e) => e.type === "onizleme");
  const clicks = link.events.filter((e) => e.type === "tiklama");

  res.json({
    code: link.code,
    destination: link.destination,
    customer: link.customer,
    campaign: link.campaign,
    createdAt: link.createdAt,
    ozet: {
      onizlemeSayisi: previews.length,
      tiklamaSayisi: clicks.length,
      belirsizSayisi: link.events.length - previews.length - clicks.length,
      ilkOnizlemeZamani: previews[0]?.timestamp || null,
      ilkTiklamaZamani: clicks[0]?.timestamp || null,
    },
    events: link.events,
  });
});

// ---------- Basit görsel panel ----------
app.get("/dashboard", (req, res) => {
  res.send(`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>Link Takip Paneli</title>
<style>
  body { font-family: system-ui, Arial, sans-serif; background:#f5f5f7; margin:0; padding:24px; color:#1d1d1f; }
  h1 { font-size: 20px; }
  table { width:100%; border-collapse: collapse; background:#fff; border-radius:8px; overflow:hidden; }
  th, td { text-align:left; padding:10px 12px; font-size:14px; border-bottom:1px solid #eee; }
  th { background:#fafafa; }
  .badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:12px; }
  .onizleme { background:#fff3cd; color:#8a6d00; }
  .tiklama { background:#d4edda; color:#1e7e34; }
  form { margin-bottom: 20px; display:flex; gap:8px; flex-wrap:wrap; }
  input { padding:8px; border:1px solid #ccc; border-radius:6px; font-size:14px; }
  button { padding:8px 14px; border:none; background:#0071e3; color:#fff; border-radius:6px; cursor:pointer; }
  #result { margin-top:10px; font-size:13px; word-break:break-all; }
</style>
</head>
<body>
  <h1>Link Takip Paneli</h1>

  <form id="createForm">
    <input id="destination" placeholder="Hedef URL (https://...)" style="flex:2;" required />
    <input id="customer" placeholder="Müşteri adı (opsiyonel)" style="flex:1;" />
    <input id="campaign" placeholder="Kampanya etiketi (opsiyonel)" style="flex:1;" />
    <button type="submit">Yeni Takip Linki Oluştur</button>
  </form>
  <div id="result"></div>

  <table>
    <thead>
      <tr><th>Kod</th><th>Hedef</th><th>Müşteri</th><th>Oluşturulma</th><th>Önizleme</th><th>Tıklama</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

<script>
async function loadLinks() {
  const res = await fetch('/api/links');
  const data = await res.json();
  const rows = document.getElementById('rows');
  rows.innerHTML = data.map(l => \`
    <tr>
      <td>\${l.code}</td>
      <td>\${l.destination}</td>
      <td>\${l.customer || '-'}</td>
      <td>\${new Date(l.createdAt).toLocaleString('tr-TR')}</td>
      <td><span class="badge onizleme">\${l.onizlemeSayisi}</span></td>
      <td><span class="badge tiklama">\${l.tiklamaSayisi}</span></td>
    </tr>
  \`).join('');
}

document.getElementById('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const destination = document.getElementById('destination').value;
  const customer = document.getElementById('customer').value;
  const campaign = document.getElementById('campaign').value;

  const res = await fetch('/api/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination, customer, campaign })
  });
  const data = await res.json();
  document.getElementById('result').innerText = 'SMS\\'e koyulacak link: ' + data.trackingUrl;
  loadLinks();
});

loadLinks();
</script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Link takip servisi çalışıyor: ${BASE_URL}`);
  console.log(`Panel: ${BASE_URL}/dashboard`);
});
