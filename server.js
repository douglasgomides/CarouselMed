require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const { exportCarousel } = require('./generate');
const { scanFonts, groupByFamily, FONT_DIRS } = require('./font-scanner');
const { buildSystemPrompt, buildLevelSuggestionPrompt } = require('./skill-prompt');
const SR = require('./public/shared-render');
const store = require('./lib/storage');
const sessao = require('./lib/sessao');

// Safety net: never let a single bad request crash the whole server
process.on('uncaughtException', (err) => console.error('⚠️ uncaughtException:', err.message));
process.on('unhandledRejection', (err) => console.error('⚠️ unhandledRejection:', err && err.message));

const app = express();
const PORT = process.env.PORT || 3001;

// Onde ficam uploads/output/designs. Em modo remoto (Supabase Storage) nada
// é gravado em disco — obrigatório na Vercel, onde o disco é somente leitura.
const { UPLOADS_DIR, OUTPUT_DIR, DATA_DIR } = store;

app.use(express.json({ limit: '20mb' }));

// ── Login ───────────────────────────────────────────────────────────
// A tela é /login (public/login.html); o middleware da borda barra o resto
// até existir um cookie de sessão válido.
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  // autenticar() consulta o Supabase e cai no PANEL_USERS se o banco não
  // responder — uma falha lá não pode trancar a equipe do lado de fora.
  const conta = await sessao.autenticar(username, password);
  if (!conta) {
    return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
  }
  res.setHeader('Set-Cookie', sessao.criarCookie(conta.usuario, sessao.segredo()));
  res.json({ ok: true, usuario: conta.usuario });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', sessao.cookieDeSaida());
  res.json({ ok: true });
});
app.use(express.static(path.join(__dirname, 'public')));
if (store.isRemote) {
  // Designs antigos guardam caminhos relativos ("/uploads/foto.jpg"); redireciona
  // para o arquivo equivalente no Storage para eles continuarem abrindo.
  app.get(['/uploads/:name', '/output/*'], (req, res) => {
    const key = req.path.replace(/^\//, '');
    res.redirect(302, store.PUBLIC_PREFIX + key);
  });
} else {
  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/output', express.static(OUTPUT_DIR));
}

// ── Font cache ──────────────────────────────────────────────────────
let _fontCache = null;
async function getFonts() {
  if (!_fontCache) {
    console.log('🔍 Escaneando fontes do sistema...');
    const flat = await scanFonts();
    _fontCache = groupByFamily(flat);
    console.log(`✅ ${flat.length} variações em ${_fontCache.length} famílias encontradas`);
  }
  return _fontCache;
}

// ── Uploads (multi-image gallery) ───────────────────────────────────
// Arquivo chega em memória e vai direto pro storage (disco pode ser só leitura).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const safeName = (original) =>
  Date.now() + '_' + String(original || 'img').replace(/[^a-zA-Z0-9.\-]/g, '_');

// ── Gemini ──────────────────────────────────────────────────────────
function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'cole-sua-chave-aqui') {
    throw new Error('GEMINI_API_KEY não configurada. Abra o arquivo .env e adicione sua chave.');
  }
  return new GoogleGenerativeAI(key);
}

function extractJSON(text) {
  const t = text.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}') + 1;
  return JSON.parse(t.slice(start, end));
}

// ── Generate carousel(s) with C0/C1/C2/C3 copy intelligence ─────────
app.post('/api/generate', async (req, res) => {
  const { topic, quantity = 1, style = 'medico', level = 'C1', bio = '' } = req.body;
  if (!topic) return res.status(400).json({ error: 'Tema obrigatório' });

  let genAI;
  try { genAI = getGeminiClient(); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const system = buildSystemPrompt({ level, bio });
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-lite-latest',
    systemInstruction: system,
    generationConfig: { temperature: 0.85, maxOutputTokens: 2048 }
  });

  try {
    const results = [];
    for (let i = 0; i < quantity; i++) {
      const angle = quantity > 1
        ? `Esta é a variação ${i + 1} de ${quantity}. Aborde um ângulo claramente diferente do tema, com gancho e enfoque distintos das outras variações.`
        : '';
      const prompt = `Crie um carrossel de 7 a 9 slides sobre: "${topic}". ${angle}`;
      const result = await model.generateContent(prompt);
      const carousel = extractJSON(result.response.text());
      // Clean copy: strip CAPA/Slide labels + travessões
      (carousel.slides || []).forEach(s => {
        s.title = SR.sanitizeCopy(s.title);
        s.subtitle = SR.sanitizeCopy(s.subtitle);
      });
      if (carousel.caption) carousel.caption = SR.sanitizeCopy(carousel.caption);
      carousel.id = `carousel_${Date.now()}_${i}`;
      carousel.style = style;
      carousel.level = level;
      results.push(carousel);
    }
    res.json({ carousels: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Falha na geração: ' + err.message });
  }
});

// ── Suggest funnel level for a topic ────────────────────────────────
app.post('/api/suggest-level', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'Tema obrigatório' });

  let genAI;
  try { genAI = getGeminiClient(); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
    const result = await model.generateContent(buildLevelSuggestionPrompt(topic));
    res.json(extractJSON(result.response.text()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Export PNGs ─────────────────────────────────────────────────────
app.post('/api/export', async (req, res) => {
  const { carousel, format } = req.body;
  if (!carousel || !carousel.slides) return res.status(400).json({ error: 'carousel inválido' });
  // Inject any custom template FMTs so server-side rendering can find them
  const customFmts = carousel._customTemplates || {};
  for (const [id, fmt] of Object.entries(customFmts)) {
    SR.FMT[id] = fmt;
  }
  console.log(`📸 Export: "${carousel.topic || carousel.id}" (${carousel.slides.length} slides, ${format || 'png'})`);
  try {
    const result = await exportCarousel(carousel, { format });
    console.log(`✅ Export concluído: ${result.files.length} slides`);
    res.json(result);
  } catch (err) {
    console.error('❌ Export falhou:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Shareable designs (Canva-style edit links) ──────────────────────

function safeId(s) { return String(s || '').replace(/[^a-z0-9]/gi, '').slice(0, 32); }

// Create or update a shared design
app.post('/api/share', async (req, res) => {
  const { carousel, id } = req.body;
  if (!carousel) return res.status(400).json({ error: 'carousel obrigatório' });
  const designId = safeId(id) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  try {
    await store.putJSON(`designs/${designId}.json`, { carousel, updatedAt: Date.now() });
    res.json({ id: designId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Load a shared design
app.get('/api/design/:id', async (req, res) => {
  try {
    const data = await store.getJSON(`designs/${safeId(req.params.id)}.json`);
    if (!data) return res.status(404).json({ error: 'Design não encontrado' });
    res.json({ carousel: data.carousel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI image generation (Free: Pollinations · Pro: Nano Banana/Gemini) ─
app.post('/api/generate-image', async (req, res) => {
  let { prompt, provider } = req.body;
  const { slideText, isCover } = req.body;

  // If slideText provided, use Claude to generate a proper visual prompt
  if (slideText && slideText.trim()) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey && anthropicKey !== 'cole-sua-chave-aqui') {
      try {
        const client = new Anthropic({ apiKey: anthropicKey });
        const sceneType = isCover
          ? 'cover image (portrait of a person relevant to the topic, professional photo, dramatic lighting)'
          : 'supporting editorial photo (lifestyle or clinical scene relevant to the topic, soft natural light)';
        const resp = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 120,
          messages: [{ role: 'user', content:
            `You are an art director for a medical Instagram account. Convert this slide text into a concise English image generation prompt for a ${sceneType}.\n\nRules:\n- Describe a real photographic scene, NOT clipart or cartoons\n- No text, logos or watermarks in the image\n- Suitable for a professional medical/health Instagram\n- Vertical 4:5 format, high quality photography\n- 30-60 words max, return ONLY the prompt\n\nSlide text: "${slideText.slice(0, 400)}"`
          }]
        });
        prompt = resp.content[0].text.trim().replace(/^["']|["']$/g, '');
        console.log(`🖼 Visual prompt gerado: ${prompt}`);
      } catch (e) {
        console.warn('Claude prompt generation failed, using raw text:', e.message);
        prompt = prompt || slideText;
      }
    } else {
      prompt = prompt || slideText;
    }
  }

  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt obrigatório' });

  try {
    let buffer, ext = 'jpg';

    if (provider === 'pro') {
      const key = process.env.GEMINI_API_KEY;
      if (!key || key === 'cole-sua-chave-aqui') return res.status(400).json({ error: 'GEMINI_API_KEY não configurada.' });
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const j = await r.json();
      if (j.error) {
        if (j.error.code === 429) return res.status(402).json({ error: 'O Nano Banana (Pro) precisa de faturamento ativado na sua chave Gemini. Ative em aistudio.google.com (Billing) ou use o gerador Free.' });
        return res.status(500).json({ error: j.error.message || 'Erro Gemini' });
      }
      const part = (j.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
      if (!part) return res.status(500).json({ error: 'Nenhuma imagem retornada pelo Nano Banana.' });
      buffer = Buffer.from(part.inlineData.data, 'base64');
      ext = (part.inlineData.mimeType || 'image/png').includes('png') ? 'png' : 'jpg';

    } else {
      // Free: Pollinations.ai (needs a free token from enter.pollinations.ai)
      const token = (req.body.token || process.env.POLLINATIONS_TOKEN || '').trim();
      const seed = Math.floor(Math.random() * 1e6);
      let url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1080&height=1350&nologo=true&model=flux&seed=${seed}`;
      if (token) url += `&token=${encodeURIComponent(token)}`;
      const headers = { 'Referer': 'https://pollinations.github.io/' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const r = await fetch(url, { headers });
      if (!r.ok) {
        if (r.status === 402 || r.status === 401) {
          return res.status(402).json({ error: 'O gerador grátis (Pollinations) pede um token grátis. Crie em enter.pollinations.ai (login Google, 1 min) e cole no campo "Token grátis".' });
        }
        return res.status(500).json({ error: 'Falha no gerador gratuito (' + r.status + '). Tente de novo.' });
      }
      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) {
        return res.status(402).json({ error: 'O gerador grátis pediu token. Crie um grátis em enter.pollinations.ai e cole no campo "Token grátis".' });
      }
      buffer = Buffer.from(await r.arrayBuffer());
      ext = 'jpg';
    }

    const fname = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const url = await store.putFile('uploads/' + fname, buffer);
    res.json({ path: url });
  } catch (err) {
    console.error('generate-image:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Drafts persistence (survives PC restart / browser / cache clear) ─
const DRAFTS_KEY = 'designs/_drafts.json';

app.post('/api/drafts', async (req, res) => {
  try {
    await store.putJSON(DRAFTS_KEY, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/drafts', async (req, res) => {
  try {
    res.json((await store.getJSON(DRAFTS_KEY)) || { carousels: [], folders: [] });
  } catch {
    res.json({ carousels: [], folders: [] });
  }
});

// ── Image gallery: upload multiple ──────────────────────────────────
// ── Templates compartilhados ──────────────────────────────────────────
// Ficam num JSON no mesmo Storage do resto. Antes disto cada template vivia
// só no localStorage de quem criou, então ninguém mais no time enxergava.
const TEMPLATES_KEY = 'templates.json';

async function lerTemplates() {
  return (await store.getJSON(TEMPLATES_KEY)) || [];
}

app.get('/api/templates', async (req, res) => {
  try {
    res.json({ templates: await lerTemplates() });
  } catch (err) {
    console.error('templates:get:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/templates', async (req, res) => {
  try {
    const { id, name, fmt, fmtCapa, previewGradient } = req.body || {};
    if (!id || !name || !fmt) {
      return res.status(400).json({ error: 'id, name e fmt são obrigatórios.' });
    }
    const lista = await lerTemplates();
    const i = lista.findIndex((t) => t.id === id);
    const item = {
      id, name, fmt,
      fmtCapa: fmtCapa || null,
      previewGradient: previewGradient || null,
      atualizadoEm: new Date().toISOString(),
    };
    if (i >= 0) lista[i] = { ...lista[i], ...item };
    else lista.push({ ...item, criadoEm: item.atualizadoEm });
    await store.putJSON(TEMPLATES_KEY, lista);
    res.json({ ok: true, templates: lista });
  } catch (err) {
    console.error('templates:post:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/templates/:id', async (req, res) => {
  try {
    const lista = await lerTemplates();
    const restante = lista.filter((t) => t.id !== req.params.id);
    if (restante.length === lista.length) {
      return res.status(404).json({ error: 'Template não encontrado.' });
    }
    await store.putJSON(TEMPLATES_KEY, restante);
    res.json({ ok: true, templates: restante });
  } catch (err) {
    console.error('templates:delete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-photo', upload.array('photos', 30), async (req, res) => {
  try {
    const files = [];
    for (const f of req.files || []) {
      files.push(await store.putFile('uploads/' + safeName(f.originalname), f.buffer, f.mimetype));
    }
    res.json({ paths: files, path: files[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Image gallery: delete an image ──────────────────────────────────
app.post('/api/gallery/delete', async (req, res) => {
  try {
    await store.removeImage(req.body.path || '');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Image gallery: list previously uploaded ─────────────────────────
app.get('/api/gallery', async (req, res) => {
  try {
    res.json({ images: await store.listImages() });
  } catch {
    res.json({ images: [] });
  }
});

// ── Font endpoints ──────────────────────────────────────────────────
app.get('/api/fonts', async (req, res) => {
  try { res.json({ families: await getFonts() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/fonts/refresh', async (req, res) => {
  _fontCache = null;
  res.json({ families: await getFonts() });
});

app.get('/api/font-file/:filename', (req, res) => {
  const { filename } = req.params;
  const dir = req.query.dir;
  if (!dir) return res.status(400).send('dir required');
  const fullPath = path.join(dir, decodeURIComponent(filename));
  if (!FONT_DIRS.some(d => d && fullPath.startsWith(d))) return res.status(403).send('Not allowed');
  if (!fs.existsSync(fullPath)) return res.status(404).send('Font not found');
  const ext = path.extname(filename).toLowerCase();
  res.setHeader('Content-Type', ext === '.ttf' ? 'font/ttf' : 'font/otf');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(fullPath);
});

// ── Calendar integration (Doctor Creator) ──────────────────────────
const CAL_URL = process.env.CALENDAR_API_URL;
const CAL_KEY = process.env.CALENDAR_API_KEY;

app.get('/api/calendar/doctors', async (req, res) => {
  if (!CAL_URL || !CAL_KEY) return res.status(500).json({ error: 'CALENDAR_API_URL / CALENDAR_API_KEY não configurados no .env' });
  try {
    const r = await fetch(CAL_URL, { headers: { 'x-api-key': CAL_KEY } });
    const data = await r.json();
    res.json({ doctors: data.doctors || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calendar/content', async (req, res) => {
  if (!CAL_URL || !CAL_KEY) return res.status(500).json({ error: 'API do calendário não configurada' });
  const { doctor_id, from, to, status } = req.query;
  try {
    let url = CAL_URL + '?';
    if (doctor_id) url += `doctor_id=${encodeURIComponent(doctor_id)}&`;
    if (from) url += `from=${encodeURIComponent(from)}&`;
    if (to) url += `to=${encodeURIComponent(to)}&`;
    if (status) url += `status=${encodeURIComponent(status)}&`;
    const r = await fetch(url, { headers: { 'x-api-key': CAL_KEY } });
    const data = await r.json();
    const items = (data.calendar || []).filter(c => c.type === 'carrossel');
    res.json({ items, doctors: data.doctors || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full calendar summary: all items with doctor info + status counts
app.get('/api/calendar/summary', async (req, res) => {
  if (!CAL_URL || !CAL_KEY) return res.status(500).json({ error: 'API do calendário não configurada' });
  try {
    // Fetch a wide window: past 30 days + next 90 days so all producao items are visible
    const from = new Date(); from.setDate(from.getDate() - 30);
    const to   = new Date(); to.setDate(to.getDate() + 90);
    const fmt = d => d.toISOString().slice(0,10);
    const url = `${CAL_URL}?from=${fmt(from)}&to=${fmt(to)}`;
    const r = await fetch(url, { headers: { 'x-api-key': CAL_KEY } });
    const data = await r.json();
    const all = (data.calendar || []).filter(c => c.type === 'carrossel');

    // Per-doctor stats
    const byDoctor = {};
    for (const item of all) {
      const did = item.doctor_id;
      if (!byDoctor[did]) byDoctor[did] = { name: item.doctor_name, total: 0, producao: 0, aprovado: 0, agendado: 0, other: 0 };
      byDoctor[did].total++;
      if (item.status === 'producao') byDoctor[did].producao++;
      else if (item.status === 'aprovado' || item.status === 'publicado') byDoctor[did].aprovado++;
      else if (item.status === 'agendado') byDoctor[did].agendado++;
      else byDoctor[did].other++;
    }

    // All carousel items (frontend filters out already-imported ones)
    res.json({ doctors: data.doctors || [], byDoctor, allItems: all, total: all.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preenche o que faltou e aplica as regras de coerencia de cada tipo de fundo.
// Vale para a capa e para o miolo, por isso virou funcao.
function normalizarFmt(fmt) {
  const defaults = SR.FMT.medico;
  const required = ['titleSize','subSize','titleColor','subColor','box','boxOp','shadow','align','justify','gap','font','padX','padTop','padBottom'];
  for (const k of required) {
    if (fmt[k] === undefined || fmt[k] === null) fmt[k] = defaults[k];
  }
  // Medidas precisam ser positivas. Quando a referencia tem pouco texto o
  // modelo as vezes devolve 0, e um titulo de 0px simplesmente nao aparece.
  for (const k of ['titleSize','subSize','gap','padX','padTop','padBottom']) {
    if (!(Number(fmt[k]) > 0)) fmt[k] = defaults[k];
  }
  if (fmt.bgSplitRatio !== null && fmt.bgSplitRatio !== undefined
      && !(Number(fmt.bgSplitRatio) > 0 && Number(fmt.bgSplitRatio) < 1)) {
    fmt.bgSplitRatio = 0.45;
  }
  if (fmt.bgType === 'image') { fmt.bgColor = null; fmt.bgGradient = null; fmt.bgSplitRatio = null; }
  if (fmt.bgType === 'split') { fmt.bgGradient = null; }
  if (fmt.bgType === 'solid' || fmt.bgType === 'gradient') { fmt.bgSplitRatio = null; }
  if (fmt.bgType === 'split') {
    const ratio = fmt.bgSplitRatio || 0.45;
    const minPadTop = Math.round(1350 * ratio) + 40;
    if (!fmt.padTop || fmt.padTop < minPadTop) fmt.padTop = minPadTop;
    fmt.boxOp = 0; // no split o texto fica sempre direto sobre a area solida
  }
  if (fmt.bgType === 'image' && fmt.boxOp === 0 && !fmt.textShadow) {
    fmt.textShadow = { x: 0, y: 2, blur: 8, color: 'rgba(0,0,0,0.7)' };
  }
  return fmt;
}

// ── Analyze reference image → extract template style with Claude Vision ─
app.post('/api/analyze-template', async (req, res) => {
  // Aceita uma imagem (formato antigo) ou varias telas do mesmo carrossel.
  const { imageBase64, mimeType } = req.body;
  const enviadas = Array.isArray(req.body.imagens) && req.body.imagens.length
    ? req.body.imagens
    : (imageBase64 && mimeType ? [{ imageBase64, mimeType }] : []);
  const telas = enviadas.filter((i) => i && i.imageBase64 && i.mimeType).slice(0, 4);
  if (!telas.length) {
    return res.status(400).json({ error: 'Envie ao menos uma imagem: imagens[] ou imageBase64 + mimeType.' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || anthropicKey === 'cole-sua-chave-aqui') {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY não configurada. Adicione sua chave em .env (obtenha em console.anthropic.com).' });
  }

  const prompt = `Você é um especialista em design de slides para Instagram. Analise esta imagem com precisão cirúrgica e extraia o estilo visual para replicação fiel.

PASSO 1 — Identifique o tipo de fundo/layout:
A) "image" — foto/imagem ocupa TODO o fundo do slide
B) "solid" — cor sólida única ocupa TODO o fundo (sem foto)
C) "gradient" — degradê ocupa TODO o fundo (sem foto)
D) "split" — slide dividido: FOTO na parte SUPERIOR + COR SÓLIDA na parte INFERIOR com texto sobre a cor

Use "split" quando: vê uma foto claramente limitada ao topo do slide e abaixo dela há uma área de cor sólida (branca, creme, bege, cinza, etc.) onde o texto aparece.

PASSO 2 — Identifique se o texto tem caixa:
- boxOp=0: texto direto sobre o fundo, SEM retângulo colorido por baixo
- boxOp=50-100: há um retângulo colorido visível ATRÁS do texto

Retorne APENAS este JSON (sem explicações, sem markdown):

{
  "bgType": "image" | "solid" | "gradient" | "split",
  "bgColor": cor hex do fundo sólido ou da área inferior do split, ex: "#f5f0eb" — null se bgType for "image" ou "gradient",
  "bgGradient": CSS do degradê, ex: "linear-gradient(135deg,#0f2027,#2c5364)" — null se não for gradient,
  "bgSplitRatio": fração 0.0-1.0 da altura do slide ocupada pela foto (ex: 0.45) — null se não for split,
  "titleSize": px do título (base 1080px largura, tipicamente 52-90),
  "subSize": px do corpo/subtítulo (tipicamente 30-55),
  "titleColor": cor hex EXATA do texto principal,
  "subColor": cor hex EXATA do texto secundário,
  "box": cor hex da caixa de texto — se não há caixa use "#ffffff",
  "boxOp": 0 (sem caixa) ou 50-100 (caixa visível),
  "shadow": true se há sombra ou contorno no texto,
  "align": "left" | "center" | "right",
  "justify": "flex-start" se texto no topo, "center" se no meio, "flex-end" se na base,
  "gap": px entre blocos de texto (12-40),
  "font": "Inter, sans-serif" | "Montserrat, sans-serif" | "Georgia, serif" | "Playfair Display, serif",
  "padX": margem lateral px (escala 1080px),
  "padTop": margem superior px — para "split" deve ser próximo à altura da foto (ex: 600 se foto ocupa 45% de 1350px),
  "padBottom": margem inferior px
}

REGRAS CRÍTICAS:
- Layout com foto no topo e texto em área clara abaixo → bgType="split", bgColor=cor da área inferior, bgSplitRatio=proporção da foto
- Texto direto no fundo SEM retângulo próprio → boxOp=0
- Para "split": padTop deve refletir onde o texto começa (abaixo da foto), padBottom deve ter margem suficiente para créditos`;

  const varias = telas.length > 1;
  const instrucao = varias ? `

SAO ${telas.length} TELAS DO MESMO CARROSSEL, na ordem em que aparecem.
A PRIMEIRA e a capa. As demais sao o miolo.
Capa e miolo quase sempre tem layouts diferentes: a capa costuma ter titulo
maior, foto de fundo, ou o texto em outra posicao.
Descreva os dois e devolva APENAS este JSON, sem markdown:

{"capa": { ...os campos acima... }, "miolo": { ...os campos acima... }}

O "miolo" deve descrever o PADRAO COMUM das telas internas, nao uma delas em
particular. Se todas as telas tiverem o mesmo layout, repita o mesmo objeto.` : '';

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const conteudo = telas.map((t) => ({
      type: 'image', source: { type: 'base64', media_type: t.mimeType, data: t.imageBase64 },
    }));
    conteudo.push({ type: 'text', text: prompt + instrucao });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: varias ? 2048 : 1024,
      messages: [{ role: 'user', content: conteudo }],
    });
    const bruto = extractJSON(response.content[0].text);

    if (varias && (bruto.capa || bruto.miolo)) {
      const fmt = normalizarFmt(bruto.miolo || bruto.capa);
      const fmtCapa = normalizarFmt(bruto.capa || bruto.miolo);
      console.log(`🎨 Template de ${telas.length} telas: capa bgType=${fmtCapa.bgType}, miolo bgType=${fmt.bgType}`);
      return res.json({ fmt, fmtCapa });
    }

    const fmt = normalizarFmt(bruto);
    console.log(`🎨 Template analisado: bgType=${fmt.bgType}, boxOp=${fmt.boxOp}, align=${fmt.align}`);
    res.json({ fmt });
  } catch (err) {
    console.error('analyze-template:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Na Vercel o app vira uma função serverless (api/index.js faz o require e
// exporta este `app`). Rodando direto no PC (`node server.js`), sobe o servidor.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✅ CarouselMed rodando em http://localhost:${PORT}\n`);
  });
}

module.exports = app;
