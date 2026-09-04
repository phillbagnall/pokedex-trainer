#!/usr/bin/env node
/*
 * Pokedex Trainer sync server: a tiny, dependency-free HTTP API that lets
 * study progress follow Beatrix across devices via a short code - no
 * accounts, no passwords. This is deliberately lightweight: progress is
 * just quiz stats (nothing sensitive), and whoever has the code can read
 * or overwrite it, the same way a shared link would work.
 *
 * Storage is a single JSON file on disk - no database server to run,
 * back it up by copying one file. Self-host this next to (or behind the
 * same reverse proxy as) the static site, and point js/sync.js's
 * API_BASE at wherever it ends up.
 *
 *   node server/index.mjs
 *
 * Env vars (all optional):
 *   PORT       default 8791
 *   DATA_DIR   default ./data (relative to this file)
 */

import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8791;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const MAX_BODY_BYTES = 256 * 1024; // generous headroom over a full 1025-entry progress blob
const CODE_RE = /^[A-Z2-9]{6,12}$/; // no 0/O/1/I - unambiguous if written down

let store = {}; // code -> { progress, updatedAt }
let saveTimer = null;

async function loadStore() {
  try {
    const text = await readFile(STORE_FILE, 'utf8');
    store = JSON.parse(text);
  } catch (e) {
    store = {};
  }
}

function saveStoreSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STORE_FILE, JSON.stringify(store), 'utf8');
  }, 200);
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    send(res, 400, { error: 'bad request' });
    return;
  }

  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/progress') {
    const code = (url.searchParams.get('code') || '').toUpperCase();
    if (!CODE_RE.test(code)) { send(res, 400, { error: 'invalid code' }); return; }
    const entry = store[code];
    if (!entry) { send(res, 404, { error: 'not found' }); return; }
    send(res, 200, entry);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/progress') {
    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      send(res, 413, { error: 'too large' });
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      send(res, 400, { error: 'bad json' });
      return;
    }
    const code = String(data.code || '').toUpperCase();
    if (!CODE_RE.test(code)) { send(res, 400, { error: 'invalid code' }); return; }
    if (typeof data.progress !== 'object' || data.progress === null) {
      send(res, 400, { error: 'missing progress' });
      return;
    }
    store[code] = { progress: data.progress, updatedAt: new Date().toISOString() };
    saveStoreSoon();
    send(res, 200, { ok: true, updatedAt: store[code].updatedAt });
    return;
  }

  send(res, 404, { error: 'not found' });
});

loadStore().then(() => {
  server.listen(PORT, () => {
    console.log(`Pokedex sync server listening on :${PORT}`);
  });
});
