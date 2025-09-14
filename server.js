// server.js
const fs = require('fs');
const path = require('path');
const express = require('express');

const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR  = process.env.DATA_DIR  || path.join(__dirname, 'data');
const LOG_FILE  = process.env.LOG_FILE  || path.join(DATA_DIR, 'events.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '');

app.use(express.json({ limit: '1mb' }));

// simpele CORS-ontharder (mag blijven staan, schaadt niet)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Append-only log
app.post('/api/log', (req, res) => {
  const now = Date.now();
  const ip  = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  const rec = {
    ...((typeof req.body === 'object' && req.body) || {}),
    server_ts: now,
    ip
  };
  fs.appendFile(LOG_FILE, JSON.stringify(rec) + '\n', (err) => {
    if (err) return res.status(500).json({ ok:false, error: String(err) });
    res.json({ ok:true });
  });
});

// Ophalen laatste events
// GET /api/log?limit=8000
app.get('/api/log', (req, res) => {
  const limit = Math.max(1, Math.min(50000, parseInt(req.query.limit || '2000', 10)));

  fs.readFile(LOG_FILE, 'utf8', (err, text) => {
    if (err) return res.status(500).json({ ok:false, error: String(err) });

    // Neem alleen de laatste 'limit' regels (efficiënt bij grote files)
    const lines = text.trim() ? text.trim().split('\n') : [];
    const tail  = lines.slice(-limit);
    const items = [];
    for (const ln of tail) {
      try { items.push(JSON.parse(ln)); } catch(_) {}
    }
    res.json({ items });
  });
});

// Statische files (plaats je html hier)
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'], // /statsgame resolveert naar statsgame.html
  maxAge: 0
}));

app.listen(PORT, () => {
  console.log(`OK: http://localhost:${PORT}`);
});
