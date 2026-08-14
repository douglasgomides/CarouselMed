/* =====================================================================
   CarouselMed — Slide Editor
   Coords: stored in 1080-px space (actual slide dimensions).
   Displayed scaled to fit viewport.
   ===================================================================== */

const SLIDE_W = 1080;
const SLIDE_H = 1350;

/* ══════════════════════════════════════════════════════════════════════
   FONT LOADER — fetches system fonts from /api/fonts and injects
   @font-face rules + populates the font picker dropdown.
   ══════════════════════════════════════════════════════════════════════ */

// Fonts always available (Google Fonts loaded in <head>)
const GOOGLE_FONTS = [
  { family: 'Poppins',          cssValue: 'Poppins, sans-serif' },
  { family: 'Inter',            cssValue: 'Inter, sans-serif' },
  { family: 'Montserrat',       cssValue: 'Montserrat, sans-serif' },
  { family: 'Playfair Display', cssValue: '"Playfair Display", serif' },
  { family: 'Bebas Neue',       cssValue: '"Bebas Neue", sans-serif' },
  { family: 'Georgia',          cssValue: 'Georgia, serif' },
  { family: 'Arial Black',      cssValue: '"Arial Black", sans-serif' },
];

// Will be populated after /api/fonts loads
let localFontFamilies = [];

async function loadSystemFonts() {
  try {
    const res = await fetch('/api/fonts');
    const data = await res.json();
    if (!data.families) return;

    localFontFamilies = data.families;

    // LAZY LOADING: only inject @font-face for priority families now.
    // The rest are injected on-demand via ensureFontLoaded() when selected.
    const PRIORITY = ['sf ui text', 'sfuitext', 'poppins', 'inter', 'montserrat'];
    const priorityFams = data.families.filter(f =>
      PRIORITY.some(p => f.family.toLowerCase().includes(p)));
    priorityFams.forEach(f => injectFontFace(f));

    buildFontPicker(data.families);
    console.log(`✅ ${data.families.length} famílias locais (${priorityFams.length} pré-carregadas, resto sob demanda)`);
  } catch (err) {
    console.warn('Fontes locais não carregadas:', err.message);
  }
}

// Track which families have been injected
const _injectedFonts = new Set();

function injectFontFace(fam) {
  if (_injectedFonts.has(fam.family)) return;
  _injectedFonts.add(fam.family);
  const css = fam.variants.map(v =>
    `@font-face{font-family:'${fam.family}';src:url('${v.url}') format('${v.file.endsWith('.otf') ? 'opentype' : 'truetype'}');font-weight:${v.weight};font-style:${v.italic ? 'italic' : 'normal'};font-display:swap;}`
  ).join('\n');
  const styleEl = document.getElementById('localFontFaces');
  styleEl.textContent += '\n' + css;
}

// Called when a font family is chosen — ensures its files are loaded
function ensureFontLoaded(familyValue) {
  if (!familyValue) return;
  // Extract bare family name (strip quotes / fallback list)
  const name = familyValue.replace(/['"]/g, '').split(',')[0].trim();
  const fam = (localFontFamilies || []).find(f => f.family === name);
  if (fam) injectFontFace(fam);
}

function buildFontPicker(localFamilies) {
  const select = document.getElementById('propFont');
  if (!select) return;

  // Priority families shown at top
  const PRIORITY = ['SF UI Text', 'SFUIText', 'Poppins', 'Inter', 'Montserrat'];

  // Gather all families: priority locals first, then rest of locals, then Google
  const localNames = new Set(localFamilies.map(f => f.family));
  const googleOnly = GOOGLE_FONTS.filter(g => !localNames.has(g.family));

  const priorityLocal = localFamilies.filter(f =>
    PRIORITY.some(p => f.family.toLowerCase().includes(p.toLowerCase()))
  );
  const otherLocal = localFamilies.filter(f =>
    !PRIORITY.some(p => f.family.toLowerCase().includes(p.toLowerCase()))
  );

  // Build option groups
  let html = '';

  if (priorityLocal.length) {
    html += `<optgroup label="── Suas fontes (favoritas) ──">`;
    html += priorityLocal.map(f =>
      `<option value="${f.family}" style="font-family:'${f.family}'">${f.family}</option>`
    ).join('');
    html += `</optgroup>`;
  }

  html += `<optgroup label="── Google Fonts ──">`;
  html += GOOGLE_FONTS.map(g =>
    `<option value="${g.cssValue}" style="font-family:${g.cssValue}">${g.family}</option>`
  ).join('');
  html += `</optgroup>`;

  if (otherLocal.length) {
    html += `<optgroup label="── Outras fontes do PC ──">`;
    html += otherLocal.map(f =>
      `<option value="${f.family}" style="font-family:'${f.family}'">${f.family}</option>`
    ).join('');
    html += `</optgroup>`;
  }

  select.innerHTML = html;
}

// Load fonts on page ready
document.addEventListener('DOMContentLoaded', loadSystemFonts);

const Ed = {
  open: false,
  carouselIdx: null,
  slideIdx: 0,
  // Per-slide element snapshots: Ed.slides[slideIdx] = [...elements]
  slides: [],
  // Undo/redo per slide
  history: [],      // history[slideIdx] = [state, state, ...]
  histoIdx: [],     // history[slideIdx] current position
  selectedId: null,
  scale: 1,
  // Drag state
  drag: null,       // { id, startX, startY, origX, origY }
  resize: null,     // { id, startX, startY, origW, origH }
};

/* ── helpers ── */
function edCarousel() { return carousels[Ed.carouselIdx]; }
function edSlide()    { return Ed.slides[Ed.slideIdx]; }
function edScale()    { return Ed.scale; }

/* ── open / close ── */
function openEditor() {
  const ci = carousels.indexOf(activeCarousel);
  Ed.carouselIdx = ci;
  Ed.slideIdx = activeSlideIndex;
  Ed.open = true;

  // Build per-slide element lists from carousel data
  const c = edCarousel();
  Ed.slides = c.slides.map((s, si) => buildDefaultElements(s, c.style));
  Ed.history = Ed.slides.map(els => [JSON.stringify(els)]);
  Ed.histoIdx = Ed.slides.map(() => 0);

  document.getElementById('editorOverlay').style.display = 'flex';
  document.getElementById('slideModal').style.display = 'none';

  window.addEventListener('mousemove', edMouseMove);
  window.addEventListener('mouseup', edMouseUp);
  window.addEventListener('keydown', edKeyDown);

  edRender();
}

function cancelEditor() {
  edClose();
  document.getElementById('slideModal').style.display = 'flex';
}

function saveEditor() {
  // Write edited elements back to carousel slide data
  const c = edCarousel();
  Ed.slides.forEach((els, si) => {
    // Rebuild blocks from text elements (keeps copy/sharing in sync)
    const textEls = els.filter(e => e.type === 'text');
    c.slides[si].blocks = textEls.map(e => ({
      id: 'b' + Math.random().toString(36).slice(2, 9),
      text: e.text, kind: e.bold ? 'title' : 'body',
      size: e.fontSize, color: e.color, align: e.align,
    }));
    c.slides[si].title = textEls[0] ? textEls[0].text : '';
    c.slides[si].subtitle = textEls.slice(1).map(e => e.text).join('\n');
    // Store full elements + mark slide as free-positioned (absolute mode)
    c.slides[si]._elements = JSON.parse(JSON.stringify(els));
    c.slides[si]._freePos = true;
  });

  edClose();
  renderCarousels();
  document.getElementById('slideModal').style.display = 'flex';
  activeSlideIndex = Ed.slideIdx;
  renderSlidePreview();
  renderThumbStrip();
  showToast('✅ Alterações salvas!');
}

function edClose() {
  Ed.open = false;
  Ed.selectedId = null;
  document.getElementById('editorOverlay').style.display = 'none';
  window.removeEventListener('mousemove', edMouseMove);
  window.removeEventListener('mouseup', edMouseUp);
  window.removeEventListener('keydown', edKeyDown);
}

/* ── box + text color presets (white boxes by default) ── */
const BOX_PRESETS = {
  medico:   { box:'#ffffff', boxOp:100, title:'#111111', subtitle:'#444444', shadow:true,  align:'center' },
  default:  { box:'#ffffff', boxOp:95,  title:'#1a1a2e', subtitle:'#333333', shadow:false, align:'left' },
  dark:     { box:'#0a0a0a', boxOp:88,  title:'#ffffff', subtitle:'#dddddd', shadow:false, align:'left' },
  feminine: { box:'#f8f5f2', boxOp:94,  title:'#3d2b1f', subtitle:'#5a3e30', shadow:false, align:'left' },
  punk:     { box:'#111111', boxOp:92,  title:'#ffffff', subtitle:'#bbbbbb', shadow:false, align:'left' },
};

/* ── build absolute elements from slide data + fmt ──
   Used when entering the advanced (free-position) editor.
   Reads per-slide fmt so the editor starts from what the preview shows. */
function buildDefaultElements(slide, styleName) {
  if (slide._elements && slide._freePos) return JSON.parse(JSON.stringify(slide._elements));

  // Merge style defaults + per-slide fmt + auto-fit (via SharedRender if present)
  const base = (typeof SharedRender !== 'undefined' ? SharedRender.FMT[styleName] : null)
            || BOX_PRESETS[styleName] || BOX_PRESETS.medico;
  const eff = (typeof SharedRender !== 'undefined')
            ? SharedRender.getFmt(slide, styleName)
            : Object.assign({}, base, slide.fmt || {});

  const box = eff.box !== undefined ? eff.box : base.box;
  const boxOp = eff.boxOp != null ? eff.boxOp : base.boxOp;
  const align = eff.align || base.align || 'center';
  const font = eff.font || 'Inter, sans-serif';
  const offY = (slide.fmt && slide.fmt.offsetY) || 0;
  const gap = (slide.fmt && slide.fmt.gap != null) ? slide.fmt.gap : base.gap || 24;

  // One element per text block (flexible 1/2/3+ boxes)
  const blocks = (typeof SharedRender !== 'undefined')
    ? SharedRender.normalizeBlocks(slide, styleName)
    : [{ text: slide.title || '', size: eff.titleSize, color: '#111', bold: true, align }];

  const isMedico = styleName === 'medico';
  let y = (isMedico ? 480 : 940) + offY;

  return blocks.map((bl, i) => {
    const lines = Math.max(1, Math.ceil((bl.text || '').length / 26));
    const h = Math.round(lines * bl.size * 1.32 + 48);
    const el = {
      id: 'blk' + i, role: i === 0 ? 'title' : (i === 1 ? 'subtitle' : 'extra' + i), type: 'text',
      text: bl.text, x: 70, y, w: SLIDE_W - 140, h: 140,
      fontSize: bl.size, fontFamily: font, color: bl.color,
      bold: bl.bold, italic: false, align: bl.align || align,
      bgColor: box, bgOpacity: boxOp, shadow: eff.shadow, boxRadius: 16,
    };
    y += h + gap;
    return el;
  });
}

/* ── compute canvas scale ── */
function computeScale() {
  const wrapper = document.querySelector('.editor-canvas-wrapper');
  if (!wrapper) return 0.4;
  const maxH = wrapper.clientHeight - 16;
  const maxW = wrapper.clientWidth - 16;
  return Math.min(maxW / SLIDE_W, maxH / SLIDE_H);
}

/* ── render full canvas ── */
function edRender() {
  const scale = computeScale();
  Ed.scale = scale;

  const canvas = document.getElementById('editorCanvas');
  canvas.style.width  = (SLIDE_W * scale) + 'px';
  canvas.style.height = (SLIDE_H * scale) + 'px';

  // Label
  document.getElementById('editorSlideLabel').textContent =
    `Slide ${Ed.slideIdx + 1}/${Ed.slides.length}`;

  // Background — per-slide bg overrides default; medico style = solid bg, no overlay
  const c = edCarousel();
  const slideData = c.slides[Ed.slideIdx];
  const photo = (slideData && slideData.bg) || c.photo || window.uploadedPhotoPath || '';
  const isMedico = c.style === 'medico';

  let html;
  if (isMedico && !photo) {
    html = `<div class="ed-bg" style="background:${c.medicoBg || '#eceef2'};"></div>`;
  } else if (photo) {
    html = `<div class="ed-bg" style="background-image:url('${photo}');background-size:cover;background-position:center;"></div>
            <div class="ed-overlay"></div>`;
  } else {
    html = `<div class="ed-bg" style="background:#1a2040;"></div>`;
  }

  const els = edSlide();
  els.forEach(el => { html += renderEl(el, scale); });

  canvas.innerHTML = html;

  // Re-attach dblclick for text elements
  els.forEach(el => {
    if (el.type !== 'text') return;
    const inner = canvas.querySelector(`#inner-${el.id}`);
    if (inner) {
      inner.addEventListener('dblclick', e => { e.stopPropagation(); startEdit(el.id); });
    }
    const resize = canvas.querySelector(`#resize-${el.id}`);
    if (resize) {
      resize.addEventListener('mousedown', e => { e.stopPropagation(); startResize(e, el.id); });
    }
  });

  updateToolbar();
}

function renderEl(el, scale) {
  const sel = el.id === Ed.selectedId;
  const sc  = v => (v * scale);

  if (el.type === 'accent') {
    return `<div class="ed-accent${sel?' selected':''}"
      id="el-${el.id}"
      style="left:${sc(el.x)}px;top:${sc(el.y)}px;width:${sc(el.w)}px;height:${sc(el.h)}px;
             background:${el.color};"
      onmousedown="elMouseDown(event,'${el.id}')"></div>`;
  }

  if (el.type === 'card') {
    const bg = el.bgColor || 'rgba(255,255,255,0.92)';
    return `<div class="ed-accent${sel?' selected':''}"
      id="el-${el.id}"
      style="left:${sc(el.x)}px;top:${sc(el.y)}px;width:${sc(el.w)}px;height:${sc(el.h)}px;
             background:${bg};border-radius:${sc(el.borderRadius||0)}px;"
      onmousedown="elMouseDown(event,'${el.id}')"></div>`;
  }

  if (el.type === 'text') {
    const hasBox = el.bgColor && el.bgOpacity > 0;
    const bg = hasBox ? hexToRgba(el.bgColor, el.bgOpacity / 100) : 'transparent';
    const fw = el.bold ? '700' : '400';
    const fs = el.italic ? 'italic' : 'normal';
    const pad = hasBox ? `${sc(22)}px ${sc(32)}px` : '4px 6px';
    const shadow = (hasBox && el.shadow) ? `box-shadow:0 ${sc(12)}px ${sc(45)}px rgba(0,0,0,0.16);` : '';
    const radius = el.boxRadius != null ? sc(el.boxRadius) : 4;
    const align = el.align || 'left';
    return `
    <div class="ed-el${sel?' selected':''}" id="el-${el.id}"
      style="left:${sc(el.x)}px;top:${sc(el.y)}px;width:${sc(el.w)}px;min-height:${sc(Math.max(el.h,40))}px;text-align:${align};"
      onmousedown="elMouseDown(event,'${el.id}')">
      <div class="ed-el-inner" id="inner-${el.id}"
        contenteditable="false"
        spellcheck="false"
        style="display:inline-block;width:auto;max-width:100%;
               font-size:${sc(el.fontSize)}px;
               font-family:${el.fontFamily};
               color:${el.color};
               font-weight:${fw};
               font-style:${fs};
               text-align:${align};
               background:${bg};
               border-radius:${radius}px;
               padding:${pad};
               box-decoration-break:clone;-webkit-box-decoration-break:clone;
               ${shadow}"
      >${escHtml(el.text)}</div>
      <div class="ed-resize" id="resize-${el.id}"></div>
    </div>`;
  }
  return '';
}

/* ── select ── */
function selectEl(id) {
  Ed.selectedId = id;
  edRender();
}

function canvasClick(e) {
  if (e.target.id === 'editorCanvas' || e.target.classList.contains('ed-bg') || e.target.classList.contains('ed-overlay')) {
    Ed.selectedId = null;
    edRender();
  }
}

function canvasMouseDown(e) {
  // deselect if clicking canvas bg
  if (e.target.id === 'editorCanvas') {
    Ed.selectedId = null;
    edRender();
  }
}

/* ── drag ── */
function elMouseDown(e, id) {
  e.stopPropagation();
  if (Ed.selectedId !== id) { selectEl(id); }

  Ed.drag = {
    id,
    startX: e.clientX,
    startY: e.clientY,
    origX: getEl(id).x,
    origY: getEl(id).y,
  };
}

function startResize(e, id) {
  const el = getEl(id);
  Ed.resize = {
    id,
    startX: e.clientX,
    startY: e.clientY,
    origW: el.w,
    origH: el.h,
  };
}

function edMouseMove(e) {
  if (Ed.drag) {
    const dx = (e.clientX - Ed.drag.startX) / Ed.scale;
    const dy = (e.clientY - Ed.drag.startY) / Ed.scale;
    const el = getEl(Ed.drag.id);
    el.x = Math.round(Ed.drag.origX + dx);
    el.y = Math.round(Ed.drag.origY + dy);
    edRenderFast();
  }
  if (Ed.resize) {
    const dx = (e.clientX - Ed.resize.startX) / Ed.scale;
    const dy = (e.clientY - Ed.resize.startY) / Ed.scale;
    const el = getEl(Ed.resize.id);
    el.w = Math.max(80, Math.round(Ed.resize.origW + dx));
    el.h = Math.max(40, Math.round(Ed.resize.origH + dy));
    edRenderFast();
  }
}

function edMouseUp() {
  if (Ed.drag || Ed.resize) {
    pushHistory();
  }
  Ed.drag = null;
  Ed.resize = null;
}

/* Fast re-render: just update positions without full rebuild */
function edRenderFast() {
  const scale = Ed.scale;
  const els = edSlide();
  els.forEach(el => {
    const node = document.getElementById('el-' + el.id);
    if (!node) return;
    node.style.left   = (el.x * scale) + 'px';
    node.style.top    = (el.y * scale) + 'px';
    if (el.type === 'text') {
      node.style.width  = (el.w * scale) + 'px';
      node.style.minHeight = (Math.max(el.h, 40) * scale) + 'px';
    } else {
      node.style.width  = (el.w * scale) + 'px';
      node.style.height = (el.h * scale) + 'px';
    }
  });
}

/* ── inline text edit ── */
function startEdit(id) {
  const inner = document.getElementById('inner-' + id);
  if (!inner) return;
  inner.contentEditable = 'true';
  inner.focus();
  // Move cursor to end
  const range = document.createRange();
  range.selectNodeContents(inner);
  range.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  inner.addEventListener('blur', () => finishEdit(id, inner), { once: true });
}

function finishEdit(id, inner) {
  inner.contentEditable = 'false';
  const el = getEl(id);
  if (el) {
    el.text = inner.innerText;
    pushHistory();
  }
}

/* ── properties ── */
function applyProp(prop, value) {
  if (!Ed.selectedId) return;
  const el = getEl(Ed.selectedId);
  if (!el) return;
  if (prop === 'fontFamily') ensureFontLoaded(value);
  el[prop] = value;
  pushHistory();
  edRender();
}

function toggleProp(prop) {
  if (!Ed.selectedId) return;
  const el = getEl(Ed.selectedId);
  if (!el) return;
  el[prop] = !el[prop];
  pushHistory();
  edRender();
}

function nudgeFontSize(delta) {
  if (!Ed.selectedId) return;
  const el = getEl(Ed.selectedId);
  if (!el || el.type !== 'text') return;
  el.fontSize = Math.max(8, (el.fontSize || 40) + delta);
  document.getElementById('propSize').value = el.fontSize;
  pushHistory();
  edRender();
}

/* ── add / delete ── */
function addTextEl() {
  const els = edSlide();
  const id = 'text_' + Date.now();
  els.push({
    id, role: 'extra', type: 'text',
    text: 'Novo texto',
    x: 100, y: 400,
    w: 800, h: 100,
    fontSize: 48,
    fontFamily: 'Inter, sans-serif',
    color: '#ffffff',
    bold: false,
    italic: false,
    align: 'left',
    bgColor: null,
    bgOpacity: 0,
  });
  Ed.selectedId = id;
  pushHistory();
  edRender();
  setTimeout(() => startEdit(id), 100);
}

function deleteSelected() {
  if (!Ed.selectedId) return;
  const els = edSlide();
  const idx = els.findIndex(e => e.id === Ed.selectedId);
  if (idx > -1) {
    els.splice(idx, 1);
    Ed.selectedId = null;
    pushHistory();
    edRender();
  }
}

/* ── slide navigation ── */
function editorNavSlide(delta) {
  const total = Ed.slides.length;
  Ed.slideIdx = Math.max(0, Math.min(total - 1, Ed.slideIdx + delta));
  Ed.selectedId = null;
  edRender();
}

/* ── undo / redo ── */
function pushHistory() {
  const si = Ed.slideIdx;
  // Truncate forward history
  Ed.history[si] = Ed.history[si].slice(0, Ed.histoIdx[si] + 1);
  Ed.history[si].push(JSON.stringify(edSlide()));
  Ed.histoIdx[si] = Ed.history[si].length - 1;
  updateUndoRedoBtns();
}

function editorUndo() {
  const si = Ed.slideIdx;
  if (Ed.histoIdx[si] <= 0) return;
  Ed.histoIdx[si]--;
  Ed.slides[si] = JSON.parse(Ed.history[si][Ed.histoIdx[si]]);
  Ed.selectedId = null;
  edRender();
}

function editorRedo() {
  const si = Ed.slideIdx;
  if (Ed.histoIdx[si] >= Ed.history[si].length - 1) return;
  Ed.histoIdx[si]++;
  Ed.slides[si] = JSON.parse(Ed.history[si][Ed.histoIdx[si]]);
  Ed.selectedId = null;
  edRender();
}

function updateUndoRedoBtns() {
  const si = Ed.slideIdx;
  document.getElementById('undoBtn').disabled = Ed.histoIdx[si] <= 0;
  document.getElementById('redoBtn').disabled = Ed.histoIdx[si] >= Ed.history[si].length - 1;
}

/* ── keyboard shortcuts ── */
function edKeyDown(e) {
  if (!Ed.open) return;
  const tag = document.activeElement.tagName;
  const isEditing = document.activeElement.contentEditable === 'true';

  // Ctrl+Z
  if (e.ctrlKey && !e.shiftKey && e.key === 'z') { e.preventDefault(); editorUndo(); return; }
  // Ctrl+Y or Ctrl+Shift+Z
  if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) { e.preventDefault(); editorRedo(); return; }
  // Ctrl+B
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); toggleProp('bold'); return; }
  // Ctrl+I
  if (e.ctrlKey && e.key === 'i') { e.preventDefault(); toggleProp('italic'); return; }
  // Ctrl+C / Ctrl+V (copy/paste text element)
  if (e.ctrlKey && e.key === 'c' && !isEditing && Ed.selectedId) { editorCopy(); return; }
  if (e.ctrlKey && e.key === 'v' && !isEditing) { editorPaste(); return; }
  // Delete / Backspace
  if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditing && Ed.selectedId) {
    e.preventDefault();
    deleteSelected();
    return;
  }
  // Arrow keys to nudge (hold Shift for 10px)
  if (!isEditing && Ed.selectedId) {
    const step = e.shiftKey ? 10 : 1;
    const el = getEl(Ed.selectedId);
    if (!el) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); el.x -= step; edRenderFast(); pushHistory(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); el.x += step; edRenderFast(); pushHistory(); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); el.y -= step; edRenderFast(); pushHistory(); }
    if (e.key === 'ArrowDown')  { e.preventDefault(); el.y += step; edRenderFast(); pushHistory(); }
  }
  // Escape = deselect
  if (e.key === 'Escape' && !isEditing) { Ed.selectedId = null; edRender(); }
}

let _clipboard = null;
function editorCopy() {
  const el = getEl(Ed.selectedId);
  if (el) _clipboard = JSON.parse(JSON.stringify(el));
}
function editorPaste() {
  if (!_clipboard) return;
  const el = JSON.parse(JSON.stringify(_clipboard));
  el.id = 'text_' + Date.now();
  el.x += 20; el.y += 20;
  edSlide().push(el);
  Ed.selectedId = el.id;
  pushHistory();
  edRender();
}

/* ── toolbar sync ── */
function updateToolbar() {
  const el = Ed.selectedId ? getEl(Ed.selectedId) : null;
  const props = document.getElementById('textProps');
  props.style.display = (el && el.type === 'text') ? 'flex' : 'none';

  if (el && el.type === 'text') {
    document.getElementById('propFont').value  = el.fontFamily;
    document.getElementById('propSize').value  = el.fontSize;
    document.getElementById('propColor').value = rgbToHex(el.color);
    document.getElementById('btnBold').classList.toggle('active', !!el.bold);
    document.getElementById('btnItalic').classList.toggle('active', !!el.italic);
    if (el.bgColor) {
      document.getElementById('propBgColor').value = rgbToHex(el.bgColor);
      document.getElementById('propOpacity').value = el.bgOpacity || 0;
    }
  }
  updateUndoRedoBtns();
}

/* ── utils ── */
function getEl(id) {
  return edSlide().find(e => e.id === id);
}

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return hex;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbToHex(color) {
  if (!color) return '#000000';
  if (color.startsWith('#')) return color;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#1a1a2e';
  return '#' + [m[1],m[2],m[3]].map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
}

function escHtml(str) {
  return String(str||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ── re-render on resize ── */
window.addEventListener('resize', () => { if (Ed.open) edRender(); });

/* ── expose for generate.js (export with custom elements) ── */
window.Ed = Ed;
window.SLIDE_W = SLIDE_W;
window.SLIDE_H = SLIDE_H;
