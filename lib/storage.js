/**
 * storage.js — guarda imagens, designs e exports.
 *
 * Dois modos, escolhidos automaticamente:
 *   • Supabase Storage — quando existem SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *     (obrigatório na Vercel, onde o disco é somente leitura e some a cada request)
 *   • Disco local — quando não existem (rodando com `node server.js` no seu PC,
 *     igual ao LEIA-ME de sempre)
 *
 * No modo Supabase os caminhos devolvidos são URLs https absolutas; o front trata
 * os dois jeitos igual, porque só usa como `src` / `background-image`.
 */
const fs = require('fs');
const path = require('path');

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'carouselmed';
const REMOTE = !!(SUPA_URL && SUPA_KEY);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const DESIGNS_DIR = path.join(DATA_DIR, 'designs');

let bucket = null;
if (REMOTE) {
  const { createClient } = require('@supabase/supabase-js');
  bucket = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } }).storage.from(BUCKET);
} else {
  [UPLOADS_DIR, OUTPUT_DIR, DESIGNS_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));
}

const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
const PUBLIC_PREFIX = REMOTE ? `${SUPA_URL}/storage/v1/object/public/${BUCKET}/` : '/';

function contentTypeOf(name) {
  const e = path.extname(name).toLowerCase();
  return e === '.png' ? 'image/png'
    : e === '.webp' ? 'image/webp'
    : e === '.gif' ? 'image/gif'
    : e === '.zip' ? 'application/zip'
    : e === '.json' ? 'application/json'
    : 'image/jpeg';
}

/** URL pública → chave interna ("uploads/foto.jpg"). Aceita já a chave. */
function keyOf(p) {
  if (!p) return '';
  const i = p.indexOf(PUBLIC_PREFIX);
  if (REMOTE && i >= 0) return p.slice(i + PUBLIC_PREFIX.length).split('?')[0];
  return String(p).replace(/^\/+/, '');
}

/** Grava um binário. `key` relativo, ex: "uploads/foto.jpg". Devolve a URL pública. */
async function putFile(key, buffer, contentType) {
  const ct = contentType || contentTypeOf(key);
  if (!REMOTE) {
    const full = path.join(DATA_DIR, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buffer);
    return '/' + key.replace(/\\/g, '/');
  }
  const { error } = await bucket.upload(key, buffer, { contentType: ct, upsert: true });
  if (error) throw new Error(`storage: ${error.message}`);
  return PUBLIC_PREFIX + key;
}

/** Lista as imagens da galeria, mais recentes primeiro. */
async function listImages() {
  if (!REMOTE) {
    try {
      return fs.readdirSync(UPLOADS_DIR)
        .filter((f) => IMG_RE.test(f))
        .map((f) => ({ path: '/uploads/' + f, mtime: fs.statSync(path.join(UPLOADS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    } catch { return []; }
  }
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await bucket.list('uploads', {
      limit: 100, offset, sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error || !data?.length) break;
    for (const o of data) {
      if (!IMG_RE.test(o.name)) continue;
      out.push({
        path: PUBLIC_PREFIX + 'uploads/' + o.name,
        mtime: new Date(o.created_at || o.updated_at || 0).getTime(),
      });
    }
    if (data.length < 100) break;
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Apaga uma imagem da galeria (aceita URL pública ou /uploads/x.jpg). */
async function removeImage(p) {
  if (!p) return;
  if (!REMOTE) {
    const full = path.join(UPLOADS_DIR, path.basename(p));
    if (full.startsWith(UPLOADS_DIR) && fs.existsSync(full)) fs.unlinkSync(full);
    return;
  }
  const key = keyOf(p);
  if (!key.startsWith('uploads/')) return; // só a galeria pode ser apagada por aqui
  const { error } = await bucket.remove([key]);
  if (error) throw new Error(`storage: ${error.message}`);
}

async function putJSON(key, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  if (!REMOTE) {
    const full = path.join(DATA_DIR, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
    return '/' + key;
  }
  const { error } = await bucket.upload(key, buf, {
    contentType: 'application/json', upsert: true, cacheControl: '0',
  });
  if (error) throw new Error(`storage: ${error.message}`);
  return PUBLIC_PREFIX + key;
}

async function getJSON(key) {
  if (!REMOTE) {
    const full = path.join(DATA_DIR, key);
    if (!fs.existsSync(full)) return null;
    try { return JSON.parse(fs.readFileSync(full, 'utf8')); } catch { return null; }
  }
  const { data, error } = await bucket.download(key);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}

module.exports = {
  isRemote: REMOTE, BUCKET, PUBLIC_PREFIX,
  DATA_DIR, UPLOADS_DIR, OUTPUT_DIR, DESIGNS_DIR,
  putFile, listImages, removeImage, putJSON, getJSON, contentTypeOf, keyOf,
};
