const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { scanFonts } = require('./font-scanner');
const SR = require('./public/shared-render');
const store = require('./lib/storage');

// Serverless (Vercel) não tem navegador instalado: usa o Chromium empacotado do
// @sparticuz/chromium com puppeteer-core. No PC, usa o puppeteer completo de sempre.
const SERVERLESS = store.isRemote;
const puppeteer = SERVERLESS ? require('puppeteer-core') : require('puppeteer');
const chromium = SERVERLESS ? require('@sparticuz/chromium') : null;

const SLIDE_W = 1080;
const SLIDE_H = 1350;
const PX = v => v + 'px';   // unit function for export (real pixels)

// Cache local font map (family|weight|italic -> base64 dataURI)
let _fontIndex = null;
async function getFontIndex() {
  if (_fontIndex) return _fontIndex;
  _fontIndex = {};
  try {
    const fonts = await scanFonts();
    for (const f of fonts) {
      const key = f.family.toLowerCase();
      if (!_fontIndex[key]) _fontIndex[key] = [];
      _fontIndex[key].push(f);
    }
  } catch { /* ignore */ }
  return _fontIndex;
}

/** Build @font-face CSS (base64) for every local family referenced by elements */
async function buildFontFaces(families) {
  const index = await getFontIndex();
  let css = '';
  for (const fam of families) {
    const variants = index[fam.toLowerCase()];
    if (!variants) continue;
    for (const v of variants) {
      try {
        const buf = fs.readFileSync(v.fullPath);
        const b64 = buf.toString('base64');
        const fmt = v.file.toLowerCase().endsWith('.otf') ? 'opentype' : 'truetype';
        css += `@font-face{font-family:'${fam}';src:url(data:font/ttf;base64,${b64}) format('${fmt}');font-weight:${v.weight};font-style:${v.italic ? 'italic' : 'normal'};}\n`;
      } catch { /* skip */ }
    }
  }
  return css;
}

// Serialize exports: only one Puppeteer browser at a time (avoids memory/crash issues)
let _exportLock = Promise.resolve();

async function exportCarousel(carousel, opts = {}) {
  // Queue: wait for any previous export to finish before starting
  const prev = _exportLock;
  let unlock;
  _exportLock = new Promise(r => { unlock = r; });
  await prev;

  const TIMEOUT_MS = Number(process.env.EXPORT_TIMEOUT_MS) || (SERVERLESS ? 55_000 : 90_000);
  let browser = null;

  try {
    const result = await Promise.race([
      _doExport(carousel, opts, b => { browser = b; }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Export timeout (90s)')), TIMEOUT_MS)),
    ]);
    return result;
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
      // Kill any orphaned chrome processes spawned by this browser
      try { browser.process()?.kill('SIGKILL'); } catch {}
    }
    unlock();
  }
}

async function _doExport(carousel, opts, onBrowser) {
  const format = opts.format === 'jpg' || opts.format === 'jpeg' ? 'jpeg' : 'png';
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const launchOpts = {
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-extensions', '--single-process',
      '--no-zygote', '--disable-background-networking',
    ],
    protocolTimeout: 60_000,
  };
  if (SERVERLESS) {
    // Chromium empacotado, descompactado em /tmp pela lib
    launchOpts.args = chromium.args;
    launchOpts.defaultViewport = chromium.defaultViewport;
    launchOpts.executablePath = await chromium.executablePath();
    launchOpts.headless = chromium.headless;
  } else if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await puppeteer.launch(launchOpts);
  onBrowser(browser);   // expose so the caller can close on timeout
  const page = await browser.newPage();
  await page.setViewport({ width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: 1 });


  // Collect all font families used across slides (from fmt + free elements)
  const famSet = new Set();
  for (const slide of carousel.slides) {
    const f = (slide.fmt && slide.fmt.font) || (SR.FMT[carousel.style] || SR.FMT.medico).font;
    famSet.add(f.replace(/['"]/g, '').split(',')[0].trim());
    for (const el of (slide._elements || [])) {
      if (el.fontFamily) famSet.add(el.fontFamily.replace(/['"]/g, '').split(',')[0].trim());
    }
  }
  const fontFaces = await buildFontFaces([...famSet]);

  const files = [];
  const buffers = [];
  for (let i = 0; i < carousel.slides.length; i++) {
    const slide = carousel.slides[i];
    const html = buildSlideHTML(slide, carousel, i + 1, carousel.slides.length, fontFaces);

    // setContent em vez de arquivo em disco: as imagens de fundo agora são URLs
    // https (Storage), então esperamos a rede sossegar antes do print.
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20_000 });
    await page.evaluateHandle('document.fonts.ready');
    await new Promise(r => setTimeout(r, 250));

    const shotOpts = { type: format };
    if (format === 'jpeg') shotOpts.quality = 95;
    const buf = await page.screenshot(shotOpts);
    const key = `output/${carousel.id}/slide${i + 1}.${ext}`;
    buffers.push({ name: `slide${i + 1}.${ext}`, buf });
    files.push(await store.putFile(key, buf));
  }

  await browser.close();
  onBrowser(null);   // clear ref so finally doesn't double-close

  // Build a ZIP with all the images for one-click download
  const zip = new AdmZip();
  buffers.forEach(({ name, buf }) => zip.addFile(name, buf));
  const zipUrl = await store.putFile(
    `output/${carousel.id}/carrossel.zip`, zip.toBuffer(), 'application/zip');

  return { files, zip: zipUrl };
}

// Fundo do slide: URL absoluta passa direto; caminho relativo vira URL do Storage
// (modo remoto) ou file:/// do disco (modo local).
function bgUrl(p) {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  if (store.isRemote) return store.PUBLIC_PREFIX + String(p).replace(/^\/+/, '');
  const abs = p.startsWith('/')
    ? path.join(__dirname, p).replace(/\\/g, '/')
    : p.replace(/\\/g, '/');
  return 'file:///' + abs;
}

function buildSlideHTML(slide, carousel, index, total, fontFaces) {
  const style = carousel.style || 'medico';

  // Slide 1 (capa) uses _capa variant if one exists — mirrors app.js preview logic
  let effectiveCarousel = carousel;
  if (index === 1) {
    const capaKey = style + '_capa';
    if (SR.FMT[capaKey]) effectiveCarousel = Object.assign({}, carousel, { style: capaKey });
  }

  // Background (file:/// urls for puppeteer)
  const bgLayer = SR.bgLayer(slide, effectiveCarousel, bgUrl);

  // Inner content (flex-centered boxes, or absolute if free-positioned)
  const inner = SR.buildInner(slide, effectiveCarousel, PX);

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:ital,wght@0,100;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&family=Montserrat:ital,wght@0,400;0,700;1,400&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Poppins:ital,wght@0,100;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400&display=swap');
${fontFaces}
*{margin:0;padding:0;box-sizing:border-box;}
body{width:${SLIDE_W}px;height:${SLIDE_H}px;overflow:hidden;font-family:'Inter',Arial,sans-serif;position:relative;}
</style></head><body>
${bgLayer}
${inner}
</body></html>`;
}

function renderElExport(el) {
  const base = `position:absolute;left:${el.x}px;top:${el.y}px;`;

  if (el.type === 'accent') {
    return `<div class="el" style="${base}width:${el.w}px;height:${el.h}px;background:${el.color};border-radius:${el.borderRadius || 4}px;"></div>`;
  }
  if (el.type === 'card') {
    return `<div class="el" style="${base}width:${el.w}px;height:${el.h}px;background:${el.bgColor || 'rgba(255,255,255,0.92)'};border-radius:${el.borderRadius || 16}px;"></div>`;
  }
  if (el.type === 'text') {
    const hasBox = el.bgColor && el.bgOpacity > 0;
    const bg = hasBox ? hexToRgba(el.bgColor, el.bgOpacity / 100) : 'transparent';
    const pad = hasBox ? '22px 32px' : '0';
    const fw = el.bold ? '700' : '400';
    const fs = el.italic ? 'italic' : 'normal';
    const shadow = (hasBox && el.shadow) ? 'box-shadow:0 12px 45px rgba(0,0,0,0.16);' : '';
    const radius = el.boxRadius != null ? el.boxRadius : 14;
    const align = el.align || 'left';
    const inner = `<span style="display:inline-block;background:${bg};border-radius:${radius}px;padding:${pad};${shadow}
      font-size:${el.fontSize}px;font-family:${el.fontFamily};color:${el.color};
      font-weight:${fw};font-style:${fs};text-align:${align};line-height:1.32;
      white-space:pre-wrap;word-break:break-word;
      box-decoration-break:clone;-webkit-box-decoration-break:clone;">${escapeHtml(el.text)}</span>`;
    return `<div class="el el-text" style="${base}width:${el.w}px;text-align:${align};">${inner}</div>`;
  }
  return '';
}

// ── Style presets (mirror of editor's getPreviewStyle) ──────────────
const STYLE_PRESETS = {
  medico:   { cardBg:'rgba(255,255,255,0)',    titleColor:'#111111', subtitleColor:'#444444', accentColor:'#2563eb', titleFont:'Inter, sans-serif', noBg:true },
  default:  { cardBg:'rgba(255,255,255,0.92)', titleColor:'#1a1a2e', subtitleColor:'#333333', accentColor:'#2563eb', titleFont:'Inter, sans-serif' },
  dark:     { cardBg:'rgba(10,10,10,0.88)',    titleColor:'#ffffff', subtitleColor:'#cccccc', accentColor:'#FF6A00', titleFont:'Inter, sans-serif' },
  feminine: { cardBg:'rgba(248,245,242,0.93)', titleColor:'#3d2b1f', subtitleColor:'#5a3e30', accentColor:'#D4A373', titleFont:'Georgia, serif' },
  punk:     { cardBg:'rgba(17,17,17,0.90)',    titleColor:'#ffffff', subtitleColor:'#bbbbbb', accentColor:'#FF0000', titleFont:'"Arial Black", sans-serif' },
};

function medicoBg(carousel) {
  return carousel.medicoBg || '#eceef2';
}

// Box + text color presets per style (white boxes by default)
const BOX_PRESETS = {
  medico:   { box:'#ffffff', boxOp:100, title:'#111111', subtitle:'#444444', shadow:true,  align:'center' },
  default:  { box:'#ffffff', boxOp:95,  title:'#1a1a2e', subtitle:'#333333', shadow:false, align:'left' },
  dark:     { box:'#0a0a0a', boxOp:88,  title:'#ffffff', subtitle:'#dddddd', shadow:false, align:'left' },
  feminine: { box:'#f8f5f2', boxOp:94,  title:'#3d2b1f', subtitle:'#5a3e30', shadow:false, align:'left' },
  punk:     { box:'#111111', boxOp:92,  title:'#ffffff', subtitle:'#bbbbbb', shadow:false, align:'left' },
};

// ── Default element layout (when slide not edited) ──────────────────
function defaultElements(slide, style) {
  const p = BOX_PRESETS[style] || BOX_PRESETS.medico;

  if (style === 'medico') {
    // Centered white boxes, title big+bold, content smaller+regular
    return [
      { id:'title', role:'title', type:'text', text:slide.title || '', x:90, y:430, w:900, h:240,
        fontSize:70, fontFamily:'Inter, sans-serif', color:p.title, bold:true, italic:false,
        align:'center', bgColor:p.box, bgOpacity:p.boxOp, shadow:p.shadow, boxRadius:16 },
      { id:'subtitle', role:'subtitle', type:'text', text:slide.subtitle || '', x:150, y:730, w:780, h:160,
        fontSize:40, fontFamily:'Inter, sans-serif', color:p.subtitle, bold:false, italic:false,
        align:'center', bgColor:p.box, bgOpacity:p.boxOp, shadow:p.shadow, boxRadius:14 },
    ];
  }

  // Photo styles: separate white boxes at bottom (like reference)
  return [
    { id:'title', role:'title', type:'text', text:slide.title || '', x:70, y:960, w:SLIDE_W-140, h:180,
      fontSize:64, fontFamily:'Inter, sans-serif', color:p.title, bold:true, italic:false,
      align:p.align, bgColor:p.box, bgOpacity:p.boxOp, shadow:false, boxRadius:14 },
    { id:'subtitle', role:'subtitle', type:'text', text:slide.subtitle || '', x:70, y:1170, w:SLIDE_W-140, h:120,
      fontSize:36, fontFamily:'Inter, sans-serif', color:p.subtitle, bold:false, italic:false,
      align:p.align, bgColor:p.box, bgOpacity:Math.max(80, p.boxOp-12), shadow:false, boxRadius:12 },
  ];
}

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return hex;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

module.exports = { exportCarousel, defaultElements, STYLE_PRESETS, SLIDE_W, SLIDE_H };
