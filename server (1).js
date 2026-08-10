/**
 * Link Önizleme / Tıklama Takip Servisi (v2)
 * ---------------------------------------
 * Artık User-Agent tahminine değil, GERÇEK DAVRANIŞA dayanıyor:
 *
 *   GET /r/:code            -> görünmez "ara sayfa" (HTML) döner.
 *                              Bu sayfanın <head>'inde bir og:image etiketi var
 *                              ve JavaScript'i çalıştığında /confirm'e bir sinyal
 *                              gönderip ASIL hedefe yönlendiriyor.
 *
 *   GET /px/:code/:vid.png   -> 1x1 şeffaf görsel. Önizleme oluşturan uygulamalar
 *                              (WhatsApp, Telegram, iMessage "Tap to Load Preview" vb.)
 *                              JavaScript ÇALIŞTIRMADAN sadece bu görseli çeker.
 *                              Bu istek geldiyse ve /confirm gelmediyse -> ÖNİZLEME.
 *
 *   POST /confirm/:code/:vid -> Sadece gerçek bir tarayıcı JavaScript çalıştırıp
 *                               buraya istek atabilir. Bu geldiyse -> GERÇEK TIKLAMA.
 *
 * Çalıştırma:
 *   npm install
 *   npm start
 *
 * Ortam değişkeni:
 *   PORT (varsayılan 3000)
 *   BASE_URL (örn: https://smartsmsenis.onrender.com)
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

// 1x1 şeffaf PNG (önizleme görseli olarak kullanılıyor)
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

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

function generateCode() {
  return crypto.randomBytes(4).toString("hex");
}

function generateVid() {
  return crypto.randomBytes(6).toString("hex");
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress;
}

function logEvent(db, code, entry) {
  const link = db.links[code];
  if (!link) return;
  link.events.push(entry);
  saveDb(db);
}

// ---------- API: Yeni takip linki oluştur ----------
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
    events: [], // {timestamp, ip, userAgent, type, vid}
  };
  saveDb(db);

  res.json({
    code,
    trackingUrl: `${BASE_URL}/r/${code}`,
    reportUrl: `${BASE_URL}/api/report/${code}`,
  });
});

// ---------- Tüm linkleri özet halinde listele ----------
function summarize(link) {
  const byVid = {};
  for (const e of link.events) {
    if (!e.vid) continue;
    byVid[e.vid] = byVid[e.vid] || {};
    byVid[e.vid][e.type] = true;
    byVid[e.vid].lastTs = e.timestamp;
  }

  let onizleme = 0;
  let tiklama = 0;
  let belirsiz = 0;
  let ilkOnizleme = null;
  let ilkTiklama = null;

  for (const vid of Object.keys(byVid)) {
    const flags = byVid[vid];
    if (flags.tiklama_onay) {
      tiklama++;
      if (!ilkTiklama || flags.lastTs < ilkTiklama) ilkTiklama = flags.lastTs;
    } else if (flags.onizleme_gorsel) {
      onizleme++;
      if (!ilkOnizleme || flags.lastTs < ilkOnizleme) ilkOnizleme = flags.lastTs;
    } else {
      belirsiz++;
    }
  }

  return { onizleme, tiklama, belirsiz, ilkOnizleme, ilkTiklama };
}

app.get("/api/links", (req, res) => {
  const db = loadDb();
  const list = Object.values(db.links).map((l) => {
    const s = summarize(l);
    return {
      code: l.code,
      destination: l.destination,
      customer: l.customer,
      campaign: l.campaign,
      createdAt: l.createdAt,
      onizlemeSayisi: s.onizleme,
      tiklamaSayisi: s.tiklama,
    };
  });
  res.json(list);
});

// ---------- SMS/WhatsApp'a konacak asıl link: görünmez ara sayfa ----------
app.get("/r/:code", (req, res) => {
  const db = loadDb();
  const link = db.links[req.params.code];
  if (!link) return res.status(404).send("Link bulunamadı.");

  const vid = generateVid();
  const code = req.params.code;

  logEvent(db, code, {
    timestamp: new Date().toISOString(),
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"] || "",
    type: "sayfa_istegi",
    vid,
  });

  const pixelUrl = `${BASE_URL}/px/${code}/${vid}.png`;
  const destJson = JSON.stringify(link.destination);
  const destAttr = link.destination.replace(/"/g, "&quot;");

  res.set("Cache-Control", "no-store");
  res.send(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta property="og:title" content="Yönlendiriliyor..." />
<meta property="og:image" content="${pixelUrl}" />
<noscript><meta http-equiv="refresh" content="0;url=${destAttr}" /></noscript>
</head>
<body>
<script>
(function () {
  var dest = ${destJson};
  try {
    fetch("/confirm/${code}/${vid}", { method: "POST", keepalive: true }).catch(function () {});
  } catch (e) {}
  window.location.replace(dest);
})();
</script>
</body>
</html>`);
});

// ---------- Önizleme görseli (bot/uygulama tarafından JS çalışmadan çekilir) ----------
app.get("/px/:code/:vid.png", (req, res) => {
  const db = loadDb();
  const { code, vid } = req.params;

  logEvent(db, code, {
    timestamp: new Date().toISOString(),
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"] || "",
    type: "onizleme_gorsel",
    vid,
  });

  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store");
  res.send(PIXEL_PNG);
});

// ---------- Gerçek tıklama onayı (sadece JS çalıştıran gerçek tarayıcı buraya gelir) ----------
app.post("/confirm/:code/:vid", (req, res) => {
  const db = loadDb();
  const { code, vid } = req.params;

  logEvent(db, code, {
    timestamp: new Date().toISOString(),
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"] || "",
    type: "tiklama_onay",
    vid,
  });

  res.sendStatus(204);
});

// ---------- Tek bir linkin raporu ----------
app.get("/api/report/:code", (req, res) => {
  const db = loadDb();
  const link = db.links[req.params.code];
  if (!link) return res.status(404).json({ error: "Link bulunamadı." });

  const s = summarize(link);

  res.json({
    code: link.code,
    destination: link.destination,
    customer: link.customer,
    campaign: link.campaign,
    createdAt: link.createdAt,
    ozet: {
      onizlemeSayisi: s.onizleme,
      tiklamaSayisi: s.tiklama,
      belirsizSayisi: s.belirsiz,
      ilkOnizlemeZamani: s.ilkOnizleme,
      ilkTiklamaZamani: s.ilkTiklama,
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
