import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;
const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const TRIES_PER_MODEL = 3;
const dir = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/manifest.json': ['manifest.json', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'application/javascript'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};

if (!KEY) {
  console.error('No GEMINI_API_KEY set.');
  process.exit(1);
}

async function askModel(model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: 'You are Kel, a helpful voice assistant. Answer in short, natural spoken sentences with no markdown, lists, or symbols.' }] },
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = await res.text();
    throw err;
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}

async function askKel(prompt) {
  let lastError;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= TRIES_PER_MODEL; attempt++) {
      try {
        const text = await askModel(model, prompt);
        if (text) return text;
        throw new Error('Empty reply');
      } catch (err) {
        lastError = err;
        const busy = err.status === 503 || err.status === 429 || err.status === 500;
        console.log(`[${model}] try ${attempt} failed: ${err.message}`);
        if (!busy) break;
        await sleep(1000 * attempt * attempt);
      }
    }
  }
  throw lastError;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && FILES[url.pathname]) {
    const [name, type] = FILES[url.pathname];
    const file = path.join(dir, name);
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': type });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404);
    return res.end(`${name} not found next to server.mjs`);
  }

  if (req.method === 'POST' && url.pathname === '/chat') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { message } = JSON.parse(body || '{}');
      if (!message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No message sent' }));
      }
      const reply = await askKel(message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ reply }));
    } catch (err) {
      console.error('Chat failed:', err.status || '', err.body || err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Kel is busy right now. Try again in a minute.' }));
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Kel is running on port ${PORT}`));
