// ── State ───────────────────────────────────────────────────────────
let mode = 'ai';            // 'ai' | 'paste'
let qty = 1;
let currentStyle = 'medico';
let _customTemplates = [];   // kept for backwards compat with saved carousels
const CUSTOM_TMPL_KEY = 'carouselmed_custom_templates';
let currentLevel = 'C1';
let galleryImages = [];      // [path,...]
let carousels = [];
let activeCarousel = null;
let activeSlideIndex = 0;
window.uploadedPhotoPath = null;  // default bg for all (used by editor)

const LEVEL_HINTS = {
  auto: 'Auto — a IA escolhe o nível ideal e explica.',
  C0: 'C0 — Sem consciência. CTA sutil: seguir/comentar.',
  C1: 'C1 — Percebeu a dor. CTA de salvar/comentar.',
  C2: 'C2 — Busca solução. CTA de link na bio/agendar.',
  C3: 'C3 — Decisão final. CTA de oferta direta/urgência.',
};

// ── Mode ────────────────────────────────────────────────────────────
let pasteView = 'notes';                 // 'notes' | 'results'
let noteBlocks = [{ id: 'n' + Date.now(), text: '' }];

function setMode(m) {
  mode = m;
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === m));
  document.getElementById('topbarAI').style.display    = m === 'ai' ? 'block' : 'none';
  document.getElementById('topbarPaste').style.display = m === 'paste' ? 'flex' : 'none';
  document.getElementById('levelPanel').style.opacity  = m === 'ai' ? '1' : '0.4';
  document.getElementById('qtyPanel').style.opacity    = m === 'ai' ? '1' : '0.4';

  if (m === 'ai') {
    document.getElementById('emptyText').innerHTML = 'Digite um tema médico e clique em Gerar.<br/>Os carrosséis aparecem aqui para revisar, editar e exportar.';
    updateMainView();
  } else {
    setPasteView('notes');
  }
}

function setPasteView(v) {
  pasteView = v;
  document.getElementById('tabNotes').classList.toggle('active', v === 'notes');
  document.getElementById('tabResults').classList.toggle('active', v === 'results');
  if (v === 'notes') renderNotes();
  if (v === 'results' && !carousels.length) {
    document.getElementById('emptyText').innerHTML = 'Nenhum carrossel ainda.<br/>Adicione notas e clique em "Criar carrosséis em lote".';
  }
  updateMainView();
}

// ── Notes (batch copy blocks) ───────────────────────────────────────
function renderNotes() {
  const grid = document.getElementById('notesGrid');
  grid.innerHTML = noteBlocks.map((b, i) => `
    <div class="note-card">
      <div class="note-head">
        <span class="note-label">Carrossel ${i + 1}</span>
        <button class="note-remove" title="Remover" onclick="removeNote('${b.id}')" ${noteBlocks.length === 1 ? 'style="display:none"' : ''}>✕</button>
      </div>
      <textarea class="note-text" placeholder="Cole aqui a copy pronta deste carrossel.

Aceita:
• SLIDE 1 / Título: ... / Texto: ...
• Blocos separados por linha em branco ou ---"
        oninput="updateNote('${b.id}', this.value)">${escHtml(b.text)}</textarea>
      <div class="note-foot">${countSlidesPreview(b.text)} slides detectados</div>
    </div>
  `).join('') + `
    <button class="note-add" onclick="addNote()">
      <span class="note-add-plus">＋</span>
      <span>Adicionar bloco</span>
    </button>`;
  document.getElementById('notesCount').textContent = `(${noteBlocks.length})`;
}

function countSlidesPreview(text) {
  if (!text.trim()) return 0;
  try { return parseStructuredText(text).length; } catch { return 0; }
}

function addNote() {
  noteBlocks.push({ id: 'n' + Date.now(), text: '' });
  renderNotes();
}

function removeNote(id) {
  noteBlocks = noteBlocks.filter(b => b.id !== id);
  if (!noteBlocks.length) noteBlocks = [{ id: 'n' + Date.now(), text: '' }];
  renderNotes();
}

function updateNote(id, val) {
  const b = noteBlocks.find(x => x.id === id);
  if (b) {
    b.text = val;
    // Update just the slide count footer without full re-render (keep focus)
    const cards = document.querySelectorAll('.note-card');
    const idx = noteBlocks.findIndex(x => x.id === id);
    if (cards[idx]) cards[idx].querySelector('.note-foot').textContent = `${countSlidesPreview(val)} slides detectados`;
  }
}

function createBatch() {
  const filled = noteBlocks.filter(b => b.text.trim());
  if (!filled.length) { showToast('Adicione texto em pelo menos um bloco'); return; }
  showBatchFolderDialog(filled.length);
}

// Ask which folder before creating in batch
function showBatchFolderDialog(count) {
  let dlg = document.getElementById('batchDialog');
  if (!dlg) { dlg = document.createElement('div'); dlg.id = 'batchDialog'; dlg.className = 'ai-dialog'; document.body.appendChild(dlg); }
  const folderBtns = folders.map(f =>
    `<button class="batch-folder" onclick="doCreateBatch('${f.id}')">👩‍⚕️ ${escHtml(f.name)} <span class="bf-count">${countInFolder(f.id)}</span></button>`).join('');
  dlg.innerHTML = `
    <div class="ai-overlay" onclick="closeBatchDialog()"></div>
    <div class="ai-box" style="max-width:420px">
      <div class="ai-head"><h3>Criar ${count} carrossel(éis)</h3><button class="modal-close" onclick="closeBatchDialog()">✕</button></div>
      <div class="ai-body">
        <label class="ai-label">Adicionar em qual pasta?</label>
        <button class="batch-folder" onclick="doCreateBatch('none')">📋 Todos (sem pasta)</button>
        ${folderBtns}
        <button class="batch-folder new" onclick="batchNewFolder()">＋ Criar nova pasta</button>
      </div>
    </div>`;
  dlg.style.display = 'flex';
}
function closeBatchDialog() { const d = document.getElementById('batchDialog'); if (d) d.remove(); }

function batchNewFolder() {
  const name = (prompt('Nome da pasta (ex: nome do médico):') || '').trim();
  if (!name) return;
  const id = 'f' + Date.now().toString(36);
  folders.push({ id, name });
  persistFolders();
  doCreateBatch(id);
}

function doCreateBatch(folderId) {
  closeBatchDialog();
  const filled = noteBlocks.filter(b => b.text.trim());
  let created = 0;
  const newOnes = [];
  for (const b of filled) {
    const slides = parseStructuredText(b.text);
    if (!slides.length) continue;
    const carousel = {
      id: `carousel_${Date.now()}_${created}`,
      topic: slides[0].title || `Carrossel ${created + 1}`,
      style: currentStyle,
      level: currentLevel === 'auto' ? 'C1' : currentLevel,
      slides, caption: '', hashtags: [],
    };
    if (folderId && folderId !== 'none') carousel.folderId = folderId;
    if (currentStyle.startsWith('ct_')) {
      const tmpl = _customTemplates.find(t => t.id === currentStyle);
      if (tmpl) carousel._customTemplates = { [tmpl.id]: tmpl.fmt };
    }
    newOnes.push(carousel);
    created++;
  }
  if (!created) { showToast('Não consegui identificar slides nos blocos'); return; }

  carousels = [...newOnes, ...carousels];
  document.getElementById('resultsCount').textContent = `(${carousels.length})`;
  if (folderId && folderId !== 'none') currentFolder = folderId;   // ir para a pasta escolhida
  renderCarousels();
  setPasteView('results');
  const nm = (folderId && folderId !== 'none') ? folderName(folderId) : 'Todos';
  showToast(`✅ ${created} criado(s) em "${nm}"!`);
}

// ── Level ───────────────────────────────────────────────────────────
function setLevel(l) {
  currentLevel = l;
  document.querySelectorAll('.level-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.level === l));
  document.getElementById('levelHint').textContent = LEVEL_HINTS[l];
}

// ── Style ───────────────────────────────────────────────────────────
function setStyle(s) {
  currentStyle = s;
  document.querySelectorAll('.style-option').forEach(o =>
    o.classList.toggle('active', o.dataset.style === s));
}

// ── Custom Templates ─────────────────────────────────────────────────
function loadCustomTemplates() {
  try {
    const raw = localStorage.getItem(CUSTOM_TMPL_KEY);
    if (raw) _customTemplates = JSON.parse(raw) || [];
  } catch { _customTemplates = []; }
  _customTemplates.forEach(t => {
    SharedRender.FMT[t.id] = t.fmt;
    if (t.fmtCapa) SharedRender.FMT[t.id + '_capa'] = t.fmtCapa;
  });
  renderCustomTemplateCards();
}

function saveCustomTemplates() {
  localStorage.setItem(CUSTOM_TMPL_KEY, JSON.stringify(_customTemplates));
}

function renderCustomTemplateCards() {
  const container = document.getElementById('customTemplateCards');
  if (!container) return;
  container.innerHTML = _customTemplates.map(t => `
    <label class="style-option${currentStyle === t.id ? ' active' : ''}" data-style="${t.id}" onclick="setStyle('${t.id}')">
      <div class="style-preview" style="background:${escHtml(t.previewGradient || '#666')}"></div>
      <span>${escHtml(t.name)}</span>
      <button class="custom-tmpl-del" title="Excluir" onclick="event.stopPropagation();deleteCustomTemplate('${t.id}')">✕</button>
    </label>`).join('');
  container.style.display = _customTemplates.length ? 'grid' : 'none';
}

function deleteCustomTemplate(id) {
  _customTemplates = _customTemplates.filter(t => t.id !== id);
  delete SharedRender.FMT[id];
  delete SharedRender.FMT[id + '_capa'];
  saveCustomTemplates();
  renderCustomTemplateCards();
  if (currentStyle === id) setStyle('medico');
}

// ── Template creation dialog — removed (templates added by code) ──────

// ── Bio ─────────────────────────────────────────────────────────────
function toggleBio() {
  const w = document.getElementById('bioWrap');
  const open = w.style.display !== 'none';
  w.style.display = open ? 'none' : 'block';
  document.getElementById('bioChevron').textContent = open ? '▸' : '▾';
}

// ── Qty ─────────────────────────────────────────────────────────────
function changeQty(d) {
  qty = Math.max(1, Math.min(10, qty + d));
  document.getElementById('qtyDisplay').textContent = qty;
}

// ── Image gallery ───────────────────────────────────────────────────
let _uploadTarget = null;  // 'slide' → apply first upload to current slide
document.getElementById('photoInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const target = _uploadTarget;   // capture before reset
  _uploadTarget = null;
  e.target.value = '';            // allow re-selecting the same file later
  if (!files.length) return;
  try {
    showToast(`Enviando ${files.length} imagem(ns)...`);
    const fd = new FormData();
    files.forEach(f => fd.append('photos', f));
    const res = await fetch('/api/upload-photo', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('servidor respondeu ' + res.status);
    const data = await res.json();
    if (!data.paths || !data.paths.length) throw new Error('nenhum caminho retornado');

    const fid = galleryContextFolder();   // tag images with the current folder
    data.paths.forEach(p => galleryImages.unshift({ path: p, folderId: fid }));
    renderGallery();

    // If uploaded from the side panel, apply to the current slide
    if (target === 'slide' && activeCarousel) {
      const slide = activeCarousel.slides[activeSlideIndex];
      slide.bg = data.paths[0];
      slide.noImage = false;
      refreshModal();
    } else if (document.getElementById('slideModal').style.display !== 'none') {
      renderSideImage();
    }
    persistDrafts();
    showToast(`✅ ${files.length} imagem(ns) adicionada(s)`);
  } catch (err) {
    showToast('Erro ao enviar imagem: ' + err.message);
  }
});

// Each folder has its own image bank. This returns the folder whose gallery to show.
function galleryContextFolder() {
  if (document.getElementById('slideModal').style.display !== 'none' && activeCarousel) {
    return activeCarousel.folderId || null;
  }
  return (currentFolder && currentFolder !== 'all' && currentFolder !== 'none') ? currentFolder : null;
}
// Images visible for the current folder context
function visibleGallery() {
  const fid = galleryContextFolder();
  return galleryImages.filter(g => (g.folderId || null) === fid);
}

function renderGallery() {
  const drawer = document.getElementById('galleryDrawer');
  if (!drawer) return;
  const imgs = visibleGallery();
  if (!imgs.length) {
    const nm = galleryContextFolder() ? folderName(galleryContextFolder()) : 'esta área';
    drawer.innerHTML = `<p class="gallery-empty">Nenhuma imagem em ${escHtml(nm || 'esta pasta')}.<br/>Adicione imagens aqui.</p>`;
    return;
  }
  drawer.innerHTML = imgs.map(g => `
    <div class="gallery-thumb" style="background-image:url('${g.path}')"
      title="Clique: aplica ao slide aberto · Duplo clique: aplica a todos"
      onclick="applyImageToSlide('${g.path}')" ondblclick="applyImageToAll('${g.path}')">
      <button class="thumb-del" title="Excluir imagem" onclick="event.stopPropagation(); removeGalleryImage('${g.path}')">✕</button>
    </div>
  `).join('');
}

async function removeGalleryImage(path) {
  try {
    await fetch('/api/gallery/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
  } catch {}
  galleryImages = galleryImages.filter(g => g.path !== path);
  carousels.forEach(c => {
    if (c.photo === path) delete c.photo;
    c.slides.forEach(s => { if (s.bg === path) delete s.bg; });
  });
  renderGallery();
  if (document.getElementById('slideModal').style.display !== 'none') refreshModal(true);
  persistDrafts();
  showToast('🗑 Imagem removida da galeria');
}

function applyImageToSlide(path) {
  if (!activeCarousel) { showToast('Abra um carrossel primeiro'); return; }
  const s = activeCarousel.slides[activeSlideIndex];
  s.bg = path; s.noImage = false;
  refreshModal(activeSlideIndex);
  showToast(`✅ Fundo aplicado ao slide ${activeSlideIndex + 1}`);
}

function applyImageToAll(path) {
  if (activeCarousel) {
    activeCarousel.slides.forEach(s => { s.bg = path; s.noImage = false; });
    activeCarousel.photo = path;
    refreshModal(true);
  }
  showToast('✅ Fundo aplicado a todos os slides');
}

function slideBg(slide, carousel) {
  if (slide && slide.noImage) return null;
  return (slide && slide.bg) || (carousel && carousel.photo) || null;
}

// ── Generate (AI) ───────────────────────────────────────────────────
async function generate() {
  const topic = document.getElementById('topicInput').value.trim();
  if (!topic) { showToast('Digite um tema primeiro'); return; }

  const btn = document.getElementById('btnGenerate');
  const btnText = document.getElementById('btnText');
  const btnLoader = document.getElementById('btnLoader');
  btn.disabled = true; btnText.style.display = 'none'; btnLoader.style.display = 'inline';

  try {
    let level = currentLevel;
    // Auto: ask the model to classify first
    if (level === 'auto') {
      const r = await fetch('/api/suggest-level', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
      });
      const d = await r.json();
      if (d.level) {
        level = d.level;
        showToast(`Nível sugerido: ${d.level} — ${d.reason || ''}`);
      } else level = 'C1';
    }

    const bio = document.getElementById('bioInput').value.trim();
    showProgress(qty > 1 ? `Gerando ${qty} carrosséis com IA (nível ${level})...` : `Gerando copy com IA (nível ${level})...`);
    const timer = startFakeProgress(qty * 6000);

    const res = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, quantity: qty, style: currentStyle, level, bio })
    });
    const data = await res.json();
    clearInterval(timer); setProgress(100); setTimeout(hideProgress, 400);
    if (data.error) throw new Error(data.error);

    // New carousels start WITHOUT image (medico gray). Assign to active folder.
    data.carousels.forEach(c => {
      assignFolder(c);
      // If using a custom template, attach its FMT so server-side export can render it
      if (currentStyle.startsWith('ct_')) {
        const tmpl = _customTemplates.find(t => t.id === currentStyle);
        if (tmpl) c._customTemplates = { [tmpl.id]: tmpl.fmt };
      }
    });

    carousels = [...data.carousels, ...carousels];
    renderCarousels();
    showToast(`✅ ${data.carousels.length} carrossel(éis) gerado(s)!`);
  } catch (err) {
    hideProgress();
    showToast('Erro: ' + err.message);
  } finally {
    btn.disabled = false; btnText.style.display = 'inline'; btnLoader.style.display = 'none';
  }
}

document.getElementById('topicInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') generate();
});

// ── Paste → auto-split into slides ──────────────────────────────────
// Handles the doctor-creator-copy skill format:
//   **SLIDE 1**
//   Título: ...
//   Texto: ...
// plus markdown bold, "---" separators, and blank-line blocks.
function parseStructuredText(raw) {
  // Normalize: strip markdown bold/italic markers, headers, carriage returns
  const text = String(raw || '')
    .replace(/\*\*/g, '')      // **bold**
    .replace(/^#+\s*/gm, '')   // # headers
    .replace(/\r/g, '')
    .trim();
  if (!text) return [];

  // A slide marker at the start of a line. Each marker = a new page (incl. CTA/CAPA/GANCHO).
  // Captures and discards the marker + separator (—, –, -, :, .), keeping the title that follows.
  const markerRe = /^[ \t]*(?:slide\s*\d+|capa|gancho|cta|p[áa]gina\s*\d+|p[áa]g\.?\s*\d+)\b[ \t]*[—–:\-.)]*[ \t]*/i;
  // Words that are page LABELS, not titles (e.g. "SLIDE 6 — CTA" → "CTA" is a label, ignore it)
  const LABEL_ONLY = /^(?:cta|capa|gancho|hook|conclus[ãa]o|fechamento|encerramento|t[íi]tulo|texto|slide\s*\d*)$/i;

  if (new RegExp(markerRe.source, 'im').test(text)) {
    const blocks = [];
    let cur = null;
    for (const line of text.split('\n')) {
      const m = line.match(markerRe);
      if (m) {
        if (cur !== null) blocks.push(cur);
        let rest = line.slice(m[0].length);
        // If what's left after the marker is just a label (CTA/CAPA/...), discard it.
        const restClean = rest.trim().replace(/^[—–:\-.)\s]+/, '').replace(/[—–:\-.)\s]+$/, '');
        if (LABEL_ONLY.test(restClean)) rest = '';
        cur = rest;                              // title (real text) comes after, or on next lines
      } else {
        cur = (cur === null) ? line : cur + '\n' + line;
      }
    }
    if (cur !== null) blocks.push(cur);

    const slides = blocks
      .map(b => extractTitleText(b.trim()))
      .filter(s => s.title || s.subtitle);
    if (slides.length) return slides;
  }

  // Strategy 2: blocks separated by --- / === or blank lines
  const slides = [];
  const blocks = text.split(/\n\s*(?:[-=_*]{3,})\s*\n|\n{2,}/).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const s = extractTitleText(block);
    if (s.title || s.subtitle) slides.push(s);
  }
  return slides;
}

// Extract title + subtitle from one slide block (handles "Título:"/"Texto:" labels or plain lines)
function extractTitleText(block) {
  const titleM = block.match(/t[íi]tulo\s*[:\-]\s*(.+)/i);
  const textM  = block.match(/(?:texto|conte[úu]do|corpo|descri[çc][ãa]o)\s*[:\-]\s*([\s\S]+)/i);

  if (titleM || textM) {
    let title = titleM ? titleM[1].split('\n')[0] : '';
    let subtitle = textM ? textM[1] : '';
    // Stop subtitle if another "Título:" appears (safety)
    subtitle = subtitle.split(/\n\s*t[íi]tulo\s*[:\-]/i)[0];
    // If no explicit title label but has text, use lines before "Texto:" as title
    if (!titleM && textM) {
      const before = block.slice(0, block.toLowerCase().indexOf('texto')).trim();
      title = before.split('\n').filter(Boolean)[0] || '';
    }
    return { type: 'info', title: clean(title), subtitle: cleanMulti(subtitle) };
  }

  // No labels: first line = title, remaining lines = subtitle
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  return { type: 'info', title: clean(lines[0] || ''), subtitle: cleanMulti(lines.slice(1).join('\n')) };
}

function clean(s) {
  return SharedRender.sanitizeCopy(String(s || '').replace(/^\*+|\*+$/g, ''));
}
// Like clean but preserves intentional line breaks (collapses only spaces/tabs)
function cleanMulti(s) {
  const lines = String(s || '').split('\n').map(l => SharedRender.sanitizeCopy(l)).filter(Boolean);
  return lines.join('\n').trim();
}

// ── Render grid ─────────────────────────────────────────────────────
function renderCarousels() {
  const grid = document.getElementById('carouselGrid');
  const empty = document.getElementById('emptyState');
  const rc = document.getElementById('resultsCount');
  if (rc) rc.textContent = `(${carousels.length})`;

  // Build cards, filtered by the selected folder (keep real index ci)
  let html = '';
  carousels.forEach((c, ci) => {
    if (!folderMatch(c)) return;
    const fName = folderName(c.folderId);
    const folderOpts = folders.map(f =>
      `<option value="${f.id}" ${c.folderId === f.id ? 'selected' : ''}>${escHtml(f.name)}</option>`).join('');
    html += `
    <div class="carousel-card ${c._collapsed ? 'collapsed' : ''}" draggable="true" ondragstart="dragCarousel(event, ${ci})"
      ondragover="cardDragOver(event, ${ci})" ondragleave="cardDragLeave(event)" ondrop="reorderCarousel(event, ${ci})"
      onclick="openModal(${ci})">
      <button class="card-delete" title="Excluir carrossel" onclick="event.stopPropagation(); deleteCarousel(${ci})">✕</button>
      <div class="card-header">
        <button class="card-collapse" title="Recolher/expandir" onclick="event.stopPropagation(); toggleCardCollapse(${ci}, this)">${c._collapsed ? '▸' : '▾'}</button>
        <h4 class="card-title" contenteditable="true" spellcheck="false" title="Clique para renomear"
          onclick="event.stopPropagation()"
          onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
          onblur="renameCarousel(${ci}, this.innerText)">${escHtml(c.topic || c.slides[0].title)}</h4>
        <span class="card-badge">${c.slides.length} slides · ${c.level || ''} · ${c.style}</span>
        ${c._calendarStatus ? `<span class="card-status ${c._calendarStatus}">${c._calendarStatus === 'producao' ? '🔨 Em produção' : c._calendarStatus === 'aprovado' ? '✓ Aprovado' : c._calendarStatus === 'agendado' ? '📅 Agendado' : c._calendarStatus}</span>` : ''}
      </div>
      ${fName ? `<div class="card-folder">👩‍⚕️ ${escHtml(fName)}</div>` : ''}
      <div class="card-slides">
        ${c.slides.map((s, si) => `
          <div class="slide-row">
            <span class="slide-num">${si + 1}</span>
            <div class="slide-texts">
              <div class="slide-title-text">${escHtml(s.title)}</div>
              <div class="slide-sub-text">${escHtml(s.subtitle)}</div>
            </div>
          </div>`).join('')}
      </div>
      <div class="card-footer">
        <select class="card-move" onclick="event.stopPropagation()" onchange="event.stopPropagation(); moveCarouselToFolder(${ci}, this.value)" title="Mover para pasta">
          <option value="none" ${!c.folderId ? 'selected' : ''}>📁 Sem pasta</option>
          ${folderOpts}
        </select>
        <button class="btn-sm" onclick="event.stopPropagation(); copyAllTexts(${ci})">📋</button>
        <button class="btn-sm accent" onclick="event.stopPropagation(); openModal(${ci}); setTimeout(exportCurrentCarousel,100)">⬇ PNG</button>
      </div>
    </div>`;
  });
  grid.innerHTML = html;

  renderFolders();
  updateMainView();
  persistDrafts();
}

// ── Folders (organize drafts by doctor) ─────────────────────────────
let folders = [];
let currentFolder = 'all';
// New carousels inherit the currently-open folder
function assignFolder(c) {
  if (currentFolder && currentFolder !== 'all' && currentFolder !== 'none') c.folderId = currentFolder;
}
const FOLDERS_KEY = 'carouselmed_folders';
let _dragCarouselIdx = null;

function persistFolders() {
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify({ folders, currentFolder })); } catch {}
  saveToServer();
}
function loadFolders() {
  try {
    const d = JSON.parse(localStorage.getItem(FOLDERS_KEY) || '{}');
    folders = d.folders || [];
    currentFolder = d.currentFolder || 'all';
  } catch { folders = []; currentFolder = 'all'; }
}

function folderName(id) {
  const f = folders.find(x => x.id === id);
  return f ? f.name : null;
}
function countInFolder(id) {
  if (id === 'all') return carousels.length;
  if (id === 'none') return carousels.filter(c => !c.folderId).length;
  return carousels.filter(c => c.folderId === id).length;
}
function folderMatch(c) {
  if (currentFolder === 'all') return true;
  if (currentFolder === 'none') return !c.folderId;
  return c.folderId === currentFolder;
}

function renderFolders() {
  const bar = document.getElementById('folderBar');
  if (!carousels.length && !folders.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';

  let html = `
    <button class="folder-chip ${currentFolder === 'all' ? 'active' : ''}"
      onclick="selectFolder('all')" ondragover="event.preventDefault()" ondrop="dropOnFolder(event,'all')">
      📋 Todos <span class="folder-count">${countInFolder('all')}</span>
    </button>
    <button class="folder-chip ${currentFolder === 'none' ? 'active' : ''}"
      onclick="selectFolder('none')" ondragover="event.preventDefault()" ondrop="dropOnFolder(event,'none')">
      📥 Sem pasta <span class="folder-count">${countInFolder('none')}</span>
    </button>`;

  html += folders.map(f => `
    <button class="folder-chip ${currentFolder === f.id ? 'active' : ''}"
      onclick="selectFolder('${f.id}')" ondragover="event.preventDefault()"
      ondragenter="this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')"
      ondrop="dropOnFolder(event,'${f.id}')" title="Arraste um carrossel aqui para mover">
      👩‍⚕️ ${escHtml(f.name)} <span class="folder-count">${countInFolder(f.id)}</span>
      <span class="folder-x" onclick="event.stopPropagation(); deleteFolder('${f.id}')" title="Excluir pasta">✕</span>
    </button>`).join('');

  html += `<button class="folder-add" onclick="createFolder()">＋ Nova pasta</button>`;
  const anyExpanded = carousels.some(c => !c._collapsed);
  html += `<button class="folder-add collapse-all" onclick="collapseAll(${anyExpanded})" title="Recolher/expandir todos">${anyExpanded ? '▴ Recolher tudo' : '▾ Expandir tudo'}</button>`;
  bar.innerHTML = html;
}

function selectFolder(id) {
  currentFolder = id;
  persistFolders();
  renderCarousels();
}

function createFolder() {
  const name = (prompt('Nome da pasta (ex: nome do médico):') || '').trim();
  if (!name) return;
  const id = 'f' + Date.now().toString(36);
  folders.push({ id, name });
  currentFolder = id;
  persistFolders();
  renderCarousels();
  showToast(`📁 Pasta "${name}" criada`);
}

function deleteFolder(id) {
  const f = folders.find(x => x.id === id);
  if (!f) return;
  folders = folders.filter(x => x.id !== id);
  carousels.forEach(c => { if (c.folderId === id) delete c.folderId; });
  if (currentFolder === id) currentFolder = 'all';
  persistFolders(); persistDrafts();
  renderCarousels();
  showToast(`Pasta "${f.name}" excluída (carrosséis mantidos)`);
}

function moveCarouselToFolder(ci, folderId) {
  if (folderId === 'none' || folderId === 'all') delete carousels[ci].folderId;
  else carousels[ci].folderId = folderId;
  persistDrafts();
  renderCarousels();
  const nm = folderId === 'none' || folderId === 'all' ? 'Sem pasta' : folderName(folderId);
  showToast(`Movido para "${nm}"`);
}

// Drag & drop
function dragCarousel(ev, ci) { _dragCarouselIdx = ci; ev.dataTransfer.effectAllowed = 'move'; }
function dropOnFolder(ev, folderId) {
  ev.preventDefault();
  document.querySelectorAll('.folder-chip').forEach(c => c.classList.remove('drag-over'));
  if (_dragCarouselIdx == null) return;
  moveCarouselToFolder(_dragCarouselIdx, folderId);
  _dragCarouselIdx = null;
}

// Reorder cards by dragging one onto another
function cardDragOver(ev, ci) {
  if (_dragCarouselIdx == null || _dragCarouselIdx === ci) return;
  ev.preventDefault();
  ev.currentTarget.classList.add('card-drop-target');
}
function cardDragLeave(ev) { ev.currentTarget.classList.remove('card-drop-target'); }
function reorderCarousel(ev, targetCi) {
  ev.preventDefault();
  ev.stopPropagation();
  document.querySelectorAll('.card-drop-target').forEach(c => c.classList.remove('card-drop-target'));
  if (_dragCarouselIdx == null || _dragCarouselIdx === targetCi) { _dragCarouselIdx = null; return; }
  const item = carousels.splice(_dragCarouselIdx, 1)[0];
  let t = targetCi;
  if (_dragCarouselIdx < targetCi) t = targetCi - 1;   // adjust after removal
  carousels.splice(t, 0, item);
  _dragCarouselIdx = null;
  renderCarousels();
  showToast('↕ Ordem atualizada');
}

// ── Rename a carousel (editable card title) ─────────────────────────
function renameCarousel(ci, name) {
  name = (name || '').replace(/\s+/g, ' ').trim();
  const c = carousels[ci];
  if (!c) return;
  if (!name) { renderCarousels(); return; }   // revert if cleared
  c.topic = name;
  persistDrafts();
  // keep modal title in sync if this carousel is open
  if (activeCarousel === c) document.getElementById('modalTitle').textContent = name;
}

// ── Collapse / expand cards ─────────────────────────────────────────
function toggleCardCollapse(ci, btn) {
  const c = carousels[ci];
  c._collapsed = !c._collapsed;
  const card = btn.closest('.carousel-card');
  card.classList.toggle('collapsed', c._collapsed);
  btn.textContent = c._collapsed ? '▸' : '▾';
  persistDrafts();
}
function collapseAll(state) {
  carousels.forEach(c => c._collapsed = state);
  renderCarousels();
}

// ── Delete a carousel ───────────────────────────────────────────────
function deleteCarousel(idx) {
  carousels.splice(idx, 1);
  renderCarousels();
  if (mode === 'paste') document.getElementById('resultsCount').textContent = `(${carousels.length})`;
  showToast('🗑 Carrossel excluído');
}

// Auto-save: localStorage (fast) + server file (survives everything), debounced
let _serverSaveTimer = null;
let _renderDebounceTimer = null;
function _debouncedRender() {
  clearTimeout(_renderDebounceTimer);
  _renderDebounceTimer = setTimeout(() => { renderSlidePreview(); renderThumbStrip(activeSlideIndex); }, 80);
}
function saveToServer() {
  clearTimeout(_serverSaveTimer);
  _serverSaveTimer = setTimeout(async () => {
    try {
      await fetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carousels, folders, currentFolder, galleryImages })
      });
    } catch {}
  }, 700);
}

function persistDrafts() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(carousels));
    localStorage.setItem('carouselmed_gallery', JSON.stringify(galleryImages));
  } catch {}
  saveToServer();
}

// ── Central view controller ─────────────────────────────────────────
function updateMainView() {
  const grid = document.getElementById('carouselGrid');
  const empty = document.getElementById('emptyState');
  const notes = document.getElementById('notesWorkspace');
  const folderBar = document.getElementById('folderBar');

  let showGrid;
  if (mode === 'paste' && pasteView === 'notes') {
    notes.style.display = 'block';
    grid.style.display = 'none';
    empty.style.display = 'none';
    showGrid = false;
  } else {
    notes.style.display = 'none';
    grid.style.display = carousels.length ? 'grid' : 'none';
    empty.style.display = carousels.length ? 'none' : 'flex';
    showGrid = true;
  }
  // Folder bar shows whenever the grid view is active and there are drafts/folders
  folderBar.style.display = (showGrid && (carousels.length || folders.length)) ? 'flex' : 'none';
}

// ── Modal ───────────────────────────────────────────────────────────
function openModal(idx) {
  activeCarousel = carousels[idx];
  activeSlideIndex = 0;
  clearPreviewSelection();
  document.getElementById('modalTitle').textContent = activeCarousel.topic || activeCarousel.slides[0].title;
  document.getElementById('slideModal').style.display = 'flex';
  renderModalStylePicker();
  refreshModal();
}

// ── In-modal template picker ─────────────────────────────────────────
const ALL_PRESET_STYLES = [
  { id:'medico',            name:'Médico' },
  { id:'tweet_com_imagem',  name:'Tweet c/ Imagem' },
  { id:'texto_img_escura',  name:'Texto + Img Escura' },
  { id:'tela_dividida',     name:'Tela Dividida' },
];

function renderModalStylePicker() {
  const grid = document.getElementById('modalStyleGrid');
  if (!grid) return;
  const allStyles = [
    ...ALL_PRESET_STYLES,
    ..._customTemplates.map(t => ({ id: t.id, name: t.name, gradient: t.previewGradient }))
  ];
  const cur = activeCarousel ? activeCarousel.style : currentStyle;
  grid.innerHTML = allStyles.map(s => {
    const isActive = s.id === cur;
    const previewStyle = s.gradient
      ? `background:${s.gradient}`
      : `background:var(--style-${s.id}, #ccc)`;
    return `<button class="modal-style-chip${isActive ? ' active' : ''}" title="${escHtml(s.name)}"
      onclick="setCarouselStyle('${s.id}')">
      <span class="modal-style-swatch style-preview style-${s.id}" style="${s.gradient ? 'background:' + s.gradient : ''}"></span>
      <span class="modal-style-label">${escHtml(s.name)}</span>
    </button>`;
  }).join('');
}

function setCarouselStyle(style) {
  if (!activeCarousel) return;
  activeCarousel.style = style;
  delete activeCarousel._customTemplates;

  // Clear per-slide style overrides so the new template fully applies to all slides
  const STYLE_KEYS = ['box','boxOp','titleColor','subColor','shadow','font','align','justify','gap','padX','padTop','padBottom','bgType','bgColor','bgGradient','bgSplitRatio','bgSplitBottom','bgOverlay','bgBlurRatio','bgBlurAmount','bgBlurOverlay','textShadow'];
  activeCarousel.slides.forEach((slide, idx) => {
    if (slide.fmt) STYLE_KEYS.forEach(k => delete slide.fmt[k]);
    // Propagate new template into free-positioned elements (capa on slide 0, inner on rest)
    if (slide._freePos && slide._elements) {
      const effectiveStyle = (idx === 0 && SharedRender.FMT[style + '_capa']) ? style + '_capa' : style;
      const fmt = SharedRender.FMT[effectiveStyle] || SharedRender.FMT.medico;
      slide._elements.forEach(el => {
        if (el.type === 'text') {
          el.bgColor   = fmt.box;
          el.bgOpacity = fmt.boxOp;
          el.color     = el.bold ? fmt.titleColor : fmt.subColor;
          el.fontFamily = fmt.font;
          el.shadow    = fmt.shadow;
        }
      });
    }
  });

  renderModalStylePicker();
  renderThumbStrip(null, true);
  renderSlidePreview();
  syncSidePanel();
  persistDrafts();
}
function closeModal() { document.getElementById('slideModal').style.display = 'none'; }
function navSlide(d) {
  const total = activeCarousel.slides.length;
  activeSlideIndex = Math.max(0, Math.min(total - 1, activeSlideIndex + d));
  clearPreviewSelection();
  refreshModal();
}
function jumpToSlide(i) { activeSlideIndex = i; clearPreviewSelection(); refreshModal(); }

function refreshModal(thumbRebuild = null) {
  renderSlidePreview();
  if (thumbRebuild === true) renderThumbStrip(null, true);
  else renderThumbStrip(thumbRebuild);
  syncSidePanel();
}

// ── Unified rendering via SharedRender (preview === export) ──────────
const CQW = px => (px * 100 / 1080).toFixed(3) + 'cqw';

function curSlide() { return activeCarousel.slides[activeSlideIndex]; }
function ensureFmt(slide) { if (!slide.fmt) slide.fmt = {}; return slide.fmt; }
function mergedFmt(slide, style) {
  const base = SharedRender.FMT[style] || SharedRender.FMT.medico;
  return Object.assign({}, base, slide.fmt || {});
}

function slideStageHTML(carousel, i) {
  const slide = carousel.slides[i];
  // Slide 0 uses _capa variant of the template if one exists
  let useCarousel = carousel;
  if (i === 0) {
    const capaKey = carousel.style + '_capa';
    if (SharedRender.FMT[capaKey]) useCarousel = { ...carousel, style: capaKey };
  }
  const f = mergedFmt(slide, useCarousel.style);
  if (typeof ensureFontLoaded === 'function') ensureFontLoaded(f.font);
  syncTextToElements(slide, useCarousel.style);
  return SharedRender.bgLayer(slide, useCarousel) + SharedRender.buildInner(slide, useCarousel, CQW);
}

// Text elements of a slide (free mode)
function textElsOf(slide) { return (slide._elements || []).filter(e => e.type === 'text'); }

// When _freePos: reconcile text-element count with block count and sync text/bold
function syncTextToElements(slide, style) {
  if (!slide._freePos || !slide._elements || !slide._elements.length) return;
  const blocks = ensureBlocks(slide);
  const f = mergedFmt(slide, style);
  let tEls = textElsOf(slide);

  // add elements for new blocks
  while (tEls.length < blocks.length) {
    const last = tEls[tEls.length - 1];
    const ne = last ? JSON.parse(JSON.stringify(last)) : {
      type:'text', x:70, w:SharedRender.SLIDE_W-140, fontSize:40, fontFamily:f.font,
      align:f.align, bgColor:f.box, bgOpacity:f.boxOp, shadow:f.shadow, boxRadius:16, color:'#111', italic:false
    };
    ne.id = 'blk' + Math.random().toString(36).slice(2, 7);
    ne.y = (last ? last.y : 700) + 180;
    slide._elements.push(ne); tEls.push(ne);
  }
  // remove elements for deleted blocks
  while (tEls.length > blocks.length) {
    const rm = tEls.pop();
    const idx = slide._elements.indexOf(rm);
    if (idx >= 0) slide._elements.splice(idx, 1);
  }
  // sync text + bold from blocks (positions/colors/sizes preserved)
  tEls.forEach((el, i) => {
    el.text = blocks[i].text;
    el.bold = blocks[i].kind === 'title';
  });
}

let _thumbCarouselId = null, _thumbSlideCount = 0;
function renderThumbStrip(rebuildIdx = null, forceAll = false) {
  const strip = document.getElementById('thumbStrip');
  const cId = activeCarousel && activeCarousel.id;
  const needFull = forceAll || _thumbCarouselId !== cId || _thumbSlideCount !== activeCarousel.slides.length;
  if (needFull) {
    _thumbCarouselId = cId;
    _thumbSlideCount = activeCarousel.slides.length;
    strip.innerHTML = activeCarousel.slides.map((s, i) => `
      <div class="thumb-item" onclick="jumpToSlide(${i})">
        <div class="thumb-stage">${slideStageHTML(activeCarousel, i)}</div>
      </div>`).join('');
  } else if (rebuildIdx != null) {
    const items = strip.querySelectorAll('.thumb-item');
    if (items[rebuildIdx]) items[rebuildIdx].querySelector('.thumb-stage').innerHTML = slideStageHTML(activeCarousel, rebuildIdx);
  }
  strip.querySelectorAll('.thumb-item').forEach((el, i) => el.classList.toggle('active', i === activeSlideIndex));
}

function renderSlidePreview() {
  const total = activeCarousel.slides.length;
  document.getElementById('slideCounterModal').textContent = `${activeSlideIndex + 1} / ${total}`;
  document.getElementById('prevBtn').disabled = activeSlideIndex === 0;
  document.getElementById('nextBtn').disabled = activeSlideIndex === total - 1;
  document.getElementById('slidePreview').innerHTML =
    `<div class="preview-counter">${activeSlideIndex + 1}/${total}</div>` +
    slideStageHTML(activeCarousel, activeSlideIndex);
  attachPreviewDrag();
}

// ── Drag text boxes directly in the preview (Canva-style) ───────────
let _pvSelIdx = null;   // selected box (text element index)
let _pvDrag = null;

function attachPreviewDrag() {
  const host = document.getElementById('slidePreview');
  if (!host) return;
  host.querySelectorAll('.sr-box').forEach(box => {
    box.style.cursor = 'move';
    box.addEventListener('mousedown', pvDown);
  });
  if (_pvSelIdx != null) {
    const sel = host.querySelector(`.sr-box[data-i="${_pvSelIdx}"]`);
    if (sel) sel.classList.add('sr-selected');
  }
}

function pvDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const box = e.currentTarget;
  if (box.dataset.i === '') return;
  const idx = +box.dataset.i;
  _pvSelIdx = idx;   // select the box (color/size now target it); free mode only on drag
  const host = document.getElementById('slidePreview');
  const scale = host.clientWidth / 1080;
  _pvDrag = { idx, sx: e.clientX, sy: e.clientY, scale, moved: false, ox: null, oy: null };
  window.addEventListener('mousemove', pvMove);
  window.addEventListener('mouseup', pvEnd);
  renderSlidePreview();
  syncSidePanel();   // reflect the selected box's color/size in the panel
}

function pvMove(e) {
  if (!_pvDrag) return;
  const dx = (e.clientX - _pvDrag.sx) / _pvDrag.scale;
  const dy = (e.clientY - _pvDrag.sy) / _pvDrag.scale;
  if (!_pvDrag.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;  // ignore tiny (click)
  _pvDrag.moved = true;
  const slide = curSlide();
  // convert to free mode on first real drag (so the box moves independently)
  if (!slide._freePos) {
    slide._elements = buildDefaultElements(slide, activeCarousel.style);
    slide._freePos = true;
  }
  const el = textElsOf(slide)[_pvDrag.idx];
  if (!el) return;
  if (_pvDrag.ox == null) { _pvDrag.ox = el.x; _pvDrag.oy = el.y; }
  el.x = Math.round(_pvDrag.ox + dx);
  el.y = Math.round(_pvDrag.oy + dy);
  renderSlidePreview();
}

function pvEnd() {
  window.removeEventListener('mousemove', pvMove);
  window.removeEventListener('mouseup', pvEnd);
  if (_pvDrag && _pvDrag.moved) {
    syncTitleSubFromBlocks(curSlide());
    renderThumbStrip(activeSlideIndex);
    persistDrafts();
  }
  _pvDrag = null;
}

// Get the currently selected box reference (element in free mode, block in flex)
function selectedBox() {
  const slide = curSlide();
  if (_pvSelIdx == null) return null;
  if (slide._freePos) return { kind: 'el', obj: textElsOf(slide)[_pvSelIdx] };
  return { kind: 'block', obj: ensureBlocks(slide)[_pvSelIdx] };
}

// reset selection when opening a different slide
function clearPreviewSelection() { _pvSelIdx = null; }

// ── Side editing panel (operates on slide.fmt) ──────────────────────
function syncSidePanel() {
  const slide = curSlide();
  const f = mergedFmt(slide, activeCarousel.style);
  const eff = SharedRender.getFmt(slide, activeCarousel.style);   // includes auto-fit

  renderBlocksEditor();
  renderFontList();

  document.getElementById('rngTitleSize').value = Math.round(eff.titleSize);
  document.getElementById('valTitleSize').textContent = Math.round(eff.titleSize) + 'px';
  document.getElementById('rngSubSize').value = Math.round(eff.subSize);
  document.getElementById('valSubSize').textContent = Math.round(eff.subSize) + 'px';
  document.getElementById('rngOffsetY').value = f.offsetY || 0;
  document.getElementById('rngGap').value = f.gap != null ? f.gap : eff.gap;

  // Colors: if a box is selected, show ITS colors; else slide-level
  const sel = selectedBox();
  let textColor = f.titleColor, boxColor = f.box || '#ffffff', boxOp = f.boxOp != null ? f.boxOp : 100, shadow = !!f.shadow;
  if (sel && sel.obj) {
    const o = sel.obj;
    if (sel.kind === 'el') {
      textColor = o.color || textColor;
      boxColor = (o.bgColor !== undefined ? o.bgColor : boxColor) || '#ffffff';
      boxOp = o.bgOpacity != null ? o.bgOpacity : boxOp;
      shadow = !!o.shadow;
    } else {
      textColor = o.color || textColor;
      boxColor = (o.boxColor !== undefined ? o.boxColor : boxColor) || '#ffffff';
      boxOp = o.boxOp != null ? o.boxOp : boxOp;
      shadow = o.shadow != null ? o.shadow : shadow;
    }
  }
  document.getElementById('sideTextColor').value = rgbToHexJS(textColor);
  document.getElementById('sideBoxColor').value = rgbToHexJS(boxColor);
  document.getElementById('sideBoxOp').value = boxOp;
  document.getElementById('valBoxOp').textContent = boxOp + '%';
  document.getElementById('sideShadow').checked = shadow;

  // Text shadow (per-box or slide-level)
  const ts = (sel && sel.obj && sel.obj.textShadow !== undefined) ? sel.obj.textShadow : f.textShadow || null;
  document.getElementById('sideTextShadow').checked = !!ts;
  document.getElementById('textShadowControls').style.display = ts ? '' : 'none';
  if (ts) {
    document.getElementById('sideTextShadowColor').value = ts.color || '#000000';
    document.getElementById('rngTxtShOp').value = ts.opacity != null ? ts.opacity : 100;
    document.getElementById('valTxtShOp').textContent = (ts.opacity != null ? ts.opacity : 100) + '%';
    document.getElementById('rngTxtShBlur').value = ts.blur || 0;
    document.getElementById('valTxtShBlur').textContent = (ts.blur || 0) + 'px';
    document.getElementById('rngTxtShDist').value = ts.dist || 0;
    document.getElementById('valTxtShDist').textContent = (ts.dist || 0) + 'px';
    document.getElementById('rngTxtShAngle').value = ts.angle || 0;
    document.getElementById('valTxtShAngle').textContent = (ts.angle || 0) + '°';
  }

  // Line-height
  let lh = 1.3;
  if (sel && sel.obj) {
    lh = (sel.kind === 'el' ? sel.obj.lineHeight : sel.obj.lineHeight) || 1.3;
  } else {
    const blks = SharedRender.deriveBlocks(slide);
    if (blks.length && blks[0].lineHeight) lh = blks[0].lineHeight;
  }
  document.getElementById('rngLineH').value = Math.round(lh * 100);
  document.getElementById('valLineH').textContent = lh;

  // Selection indicator
  const ind = document.getElementById('colorScopeLabel');
  if (ind) {
    ind.innerHTML = (sel && sel.obj)
      ? `Editando <b>Caixa ${_pvSelIdx + 1}</b> · <a href="#" onclick="deselectBox();return false;">aplicar a todas</a>`
      : `Editando <b>todas as caixas</b> · clique numa caixa no preview para editar só ela`;
  }

  renderSideImage();
  syncFolderPresetBar();
}

function deselectBox() { _pvSelIdx = null; renderSlidePreview(); syncSidePanel(); }

function rgbToHexJS(color) {
  if (!color) return '#ffffff';
  if (color.startsWith('#')) return color.slice(0, 7);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#ffffff';
  return '#' + [m[1],m[2],m[3]].map(x => (+x).toString(16).padStart(2,'0')).join('');
}

// ── Text blocks (flexible 1/2/3+ boxes per slide) ───────────────────
function newBlockId() { return 'b' + Math.random().toString(36).slice(2, 9); }

function ensureBlocks(slide) {
  if (!slide.blocks || !slide.blocks.length) {
    slide.blocks = SharedRender.deriveBlocks(slide).map(b => ({
      id: newBlockId(), text: b.text, kind: b.kind || 'body'
    }));
  }
  slide.blocks.forEach(b => { if (!b.id) b.id = newBlockId(); });
  return slide.blocks;
}

function syncTitleSubFromBlocks(slide) {
  const b = slide.blocks || [];
  slide.title = (b[0] && b[0].text) || '';
  slide.subtitle = b.slice(1).map(x => x.text).join('\n');
}

function renderBlocksEditor() {
  const slide = curSlide();
  const blocks = ensureBlocks(slide);
  document.getElementById('blocksEditor').innerHTML = blocks.map((b, i) => `
    <div class="block-row">
      <div class="block-head">
        <button class="block-kind ${b.kind === 'title' ? 'on' : ''}" onclick="toggleBlockKind(${i})"
          title="Alternar estilo título (maior/negrito) ↔ corpo">T</button>
        <span class="block-label">Caixa ${i + 1}</span>
        <button class="block-del" onclick="removeBlock(${i})" ${blocks.length <= 1 ? 'style="display:none"' : ''}>✕</button>
      </div>
      <textarea class="side-input block-text" rows="2"
        oninput="updateBlock(${i}, this.value)">${escHtml(b.text)}</textarea>
    </div>`).join('');
}

function updateBlock(i, val) {
  const slide = curSlide();
  const blocks = ensureBlocks(slide);

  // Double-Enter (blank line) splits the block into multiple boxes
  if (/\n[ \t]*\n/.test(val)) {
    const parts = val.split(/\n[ \t]*\n/).map(p => p.replace(/\s+$/,'').replace(/^\s+/,''));
    const firstKind = (blocks.length === 1 || blocks[i].kind === 'title') ? 'title' : blocks[i].kind;
    const replacement = parts.map((t, k) => ({
      id: newBlockId(), text: t,
      kind: (k === 0 ? firstKind : 'body'),
    }));
    blocks.splice(i, 1, ...replacement);
    syncTitleSubFromBlocks(slide);
    renderBlocksEditor();
    renderSlidePreview(); renderThumbStrip(activeSlideIndex);
    // focus the last new block
    setTimeout(() => {
      const tas = document.querySelectorAll('#blocksEditor .block-text');
      const target = tas[i + replacement.length - 1];
      if (target) { target.focus(); target.setSelectionRange(target.value.length, target.value.length); }
    }, 0);
    return;
  }

  blocks[i].text = val;
  syncTitleSubFromBlocks(slide);
  _debouncedRender();
}

function addBlock() {
  const slide = curSlide();
  const blocks = ensureBlocks(slide);
  if (blocks.length === 1 && blocks[0].kind !== 'title') blocks[0].kind = 'title';
  blocks.push({ id: newBlockId(), text: 'Novo texto', kind: 'body' });
  syncTitleSubFromBlocks(slide);
  renderBlocksEditor();
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
  setTimeout(() => {
    const tas = document.querySelectorAll('#blocksEditor .block-text');
    const t = tas[tas.length - 1];
    if (t) { t.focus(); t.select(); }
  }, 0);
}

function removeBlock(i) {
  const slide = curSlide();
  const blocks = ensureBlocks(slide);
  if (blocks.length <= 1) return;
  blocks.splice(i, 1);
  syncTitleSubFromBlocks(slide);
  renderBlocksEditor();
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}

function toggleBlockKind(i) {
  const slide = curSlide();
  const blocks = ensureBlocks(slide);
  blocks[i].kind = blocks[i].kind === 'title' ? 'body' : 'title';
  renderBlocksEditor();
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}
function sideSize(role, px) {
  const slide = curSlide();
  const sel = selectedBox();
  if (sel) {
    // size the SELECTED box only
    if (sel.kind === 'el' && sel.obj) sel.obj.fontSize = px;
    else if (sel.obj) sel.obj.size = px;
  } else {
    const f = ensureFmt(slide);
    if (role === 'title') f.titleSize = px; else f.subSize = px;
    textElsOf(slide).forEach(e => { if ((role === 'title') === !!e.bold) e.fontSize = px; });
    ensureBlocks(slide).forEach(b => { if ((role === 'title') === (b.kind === 'title')) delete b.size; });
  }
  document.getElementById(role === 'title' ? 'valTitleSize' : 'valSubSize').textContent = px + 'px';
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}
function sideOffsetY(val) { ensureFmt(curSlide()).offsetY = val; renderSlidePreview(); renderThumbStrip(activeSlideIndex); }
function sideGap(val)     { ensureFmt(curSlide()).gap = val;     renderSlidePreview(); renderThumbStrip(activeSlideIndex); }

// ── Font picker ────────────────────────────────────────────────────
let _customFonts = [];   // user-uploaded fonts: { family, cssValue, src:'custom' }

function _allFonts() {
  const gf = (typeof GOOGLE_FONTS !== 'undefined' ? GOOGLE_FONTS : []).map(g => ({ family: g.family, cssValue: g.cssValue, src: 'google' }));
  const lf = (typeof localFontFamilies !== 'undefined' ? localFontFamilies : []).map(f => ({ family: f.family, cssValue: f.family, src: 'local' }));
  return [..._customFonts, ...gf, ...lf];
}

function renderFontList() {
  const list = document.getElementById('fontList');
  if (!list) return;
  const search = (document.getElementById('fontSearch')?.value || '').toLowerCase().trim();
  const slide = curSlide();
  const f = mergedFmt(slide, activeCarousel.style);
  const currentFont = (f.font || 'Inter').replace(/['"]/g, '').split(',')[0].trim().toLowerCase();

  let fonts = _allFonts();
  if (search) fonts = fonts.filter(f => f.family.toLowerCase().includes(search));

  if (!fonts.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center">Nenhuma fonte encontrada</div>';
    return;
  }

  list.innerHTML = fonts.slice(0, 60).map(f => {
    const active = f.family.toLowerCase() === currentFont;
    const tag = f.src === 'custom' ? 'Minha' : f.src === 'google' ? 'Google' : 'PC';
    return `<div class="font-item${active ? ' active' : ''}" onclick="selectFont('${f.cssValue.replace(/'/g, "\\'")}','${f.family.replace(/'/g, "\\'")}')" title="${f.family}">
      <span class="font-item-name" style="font-family:'${f.family}',sans-serif">${f.family}</span>
      <span class="font-item-tag">${tag}</span>
    </div>`;
  }).join('');
}

function filterFontList() { renderFontList(); }

function selectFont(cssValue, family) {
  if (typeof ensureFontLoaded === 'function') ensureFontLoaded(cssValue);
  const slide = curSlide();
  ensureFmt(slide).font = cssValue;
  // Also update free-position elements
  if (slide._elements) slide._elements.forEach(el => { if (el.type === 'text') el.fontFamily = cssValue; });
  renderFontList();
  renderSlidePreview();
  renderThumbStrip(activeSlideIndex);
}

function sideFontToAll() {
  const src = mergedFmt(curSlide(), activeCarousel.style);
  activeCarousel.slides.forEach((slide, i) => {
    if (i === activeSlideIndex) return;
    ensureFmt(slide).font = src.font;
    if (slide._elements) slide._elements.forEach(el => { if (el.type === 'text') el.fontFamily = src.font; });
  });
  renderThumbStrip(null, true);
  showToast('✅ Fonte aplicada a todos os slides');
}

function uploadCustomFonts(files) {
  if (!files || !files.length) return;
  Array.from(files).forEach(file => {
    const family = file.name.replace(/\.(ttf|otf|woff2?)/i, '').replace(/[-_]/g, ' ');
    const url = URL.createObjectURL(file);
    const format = file.name.endsWith('.otf') ? 'opentype' : file.name.endsWith('.woff2') ? 'woff2' : file.name.endsWith('.woff') ? 'woff' : 'truetype';
    const css = `@font-face{font-family:'${family}';src:url('${url}') format('${format}');font-display:swap;}`;
    const styleEl = document.getElementById('localFontFaces');
    styleEl.textContent += '\n' + css;
    _customFonts.push({ family, cssValue: family, src: 'custom' });
  });
  renderFontList();
  showToast(`✅ ${files.length} fonte(s) adicionada(s)`);
}

function sideTextColor(hex) {
  const slide = curSlide();
  const sel = selectedBox();
  if (sel && sel.obj) {
    sel.obj.color = hex;   // only the selected box
  } else {
    const f = ensureFmt(slide); f.titleColor = hex; f.subColor = hex;
    textElsOf(slide).forEach(e => e.color = hex);
    ensureBlocks(slide).forEach(b => { delete b.color; });
  }
  document.getElementById('sideTextColor').value = hex;
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}
function sideBoxColor(hex) {
  const slide = curSlide();
  const sel = selectedBox();
  if (sel && sel.obj) {
    if (sel.kind === 'el') { sel.obj.bgColor = hex; if (!sel.obj.bgOpacity) sel.obj.bgOpacity = 100; }
    else { sel.obj.boxColor = hex; if (sel.obj.boxOp == null) sel.obj.boxOp = 100; }
  } else {
    const f = ensureFmt(slide); f.box = hex; if (!f.boxOp) f.boxOp = 100;
    textElsOf(slide).forEach(e => { e.bgColor = hex; if (!e.bgOpacity) e.bgOpacity = 100; });
    ensureBlocks(slide).forEach(b => { delete b.boxColor; });
  }
  document.getElementById('sideBoxColor').value = hex;
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}
function sideBoxOpacity(val) {
  const slide = curSlide();
  const sel = selectedBox();
  if (sel && sel.obj) {
    if (sel.kind === 'el') sel.obj.bgOpacity = val; else sel.obj.boxOp = val;
  } else {
    ensureFmt(slide).boxOp = val;
    textElsOf(slide).forEach(e => e.bgOpacity = val);
    ensureBlocks(slide).forEach(b => { delete b.boxOp; });
  }
  document.getElementById('valBoxOp').textContent = val + '%';
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}
function sideShadow(on) {
  const slide = curSlide();
  const sel = selectedBox();
  if (sel && sel.obj) {
    sel.obj.shadow = on;
  } else {
    ensureFmt(slide).shadow = on;
    textElsOf(slide).forEach(e => e.shadow = on);
    ensureBlocks(slide).forEach(b => { delete b.shadow; });
  }
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}

// ── Text shadow (behind letters) ───────────────────────────────────
function sideTextShadowToggle(on) {
  const slide = curSlide();
  const sel = selectedBox();
  const defaultTs = { color:'#000000', opacity:100, blur:8, dist:2, angle:135 };
  if (sel && sel.obj) {
    sel.obj.textShadow = on ? (sel.obj.textShadow || JSON.parse(JSON.stringify(defaultTs))) : null;
  } else {
    const f = ensureFmt(slide);
    if (on) {
      f.textShadow = f.textShadow || defaultTs;
    } else {
      delete f.textShadow;
    }
    if (slide._elements) slide._elements.forEach(el => {
      if (el.type === 'text') el.textShadow = f.textShadow || null;
    });
    ensureBlocks(slide).forEach(b => { delete b.textShadow; });
  }
  document.getElementById('textShadowControls').style.display = on ? '' : 'none';
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}

function sideTextShadowProp() {
  const slide = curSlide();
  const sel = selectedBox();
  let ts;
  if (sel && sel.obj) {
    ts = sel.obj.textShadow || (sel.obj.textShadow = { color:'#000000', opacity:100, blur:8, dist:2, angle:135 });
  } else {
    const f = ensureFmt(slide);
    ts = f.textShadow || (f.textShadow = { color:'#000000', opacity:100, blur:8, dist:2, angle:135 });
    if (slide._elements) slide._elements.forEach(el => {
      if (el.type === 'text') el.textShadow = ts;
    });
    ensureBlocks(slide).forEach(b => { delete b.textShadow; });
  }
  ts.color   = document.getElementById('sideTextShadowColor').value;
  ts.opacity = +document.getElementById('rngTxtShOp').value;
  ts.blur    = +document.getElementById('rngTxtShBlur').value;
  ts.dist    = +document.getElementById('rngTxtShDist').value;
  ts.angle   = +document.getElementById('rngTxtShAngle').value;
  document.getElementById('valTxtShOp').textContent = ts.opacity + '%';
  document.getElementById('valTxtShBlur').textContent = ts.blur + 'px';
  document.getElementById('valTxtShDist').textContent = ts.dist + 'px';
  document.getElementById('valTxtShAngle').textContent = ts.angle + '°';
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}

function sideLineHeight(val) {
  const lh = +(val / 100).toFixed(2);
  document.getElementById('valLineH').textContent = lh;
  const slide = curSlide();
  const sel = selectedBox();
  if (sel && sel.obj) {
    if (sel.kind === 'el') sel.obj.lineHeight = lh;
    else sel.obj.lineHeight = lh;
  } else {
    ensureBlocks(slide).forEach(b => { b.lineHeight = lh; });
    if (slide._elements) slide._elements.forEach(el => { if (el.type === 'text') el.lineHeight = lh; });
  }
  renderSlidePreview(); renderThumbStrip(activeSlideIndex);
}

function _textShadowCSS(ts, U) {
  if (!ts) return '';
  const rad = (ts.angle || 0) * Math.PI / 180;
  const x = Math.round(Math.cos(rad) * (ts.dist || 0));
  const y = Math.round(Math.sin(rad) * (ts.dist || 0));
  const r = parseInt((ts.color||'#000000').slice(1,3),16);
  const g = parseInt((ts.color||'#000000').slice(3,5),16);
  const b = parseInt((ts.color||'#000000').slice(5,7),16);
  const a = (ts.opacity != null ? ts.opacity : 100) / 100;
  return `text-shadow:${U?U(x):x+'px'} ${U?U(y):y+'px'} ${U?U(ts.blur||0):(ts.blur||0)+'px'} rgba(${r},${g},${b},${a});`;
}

function sidePreset(name) {
  const presets = {
    white:  { box:'#ffffff', op:100, title:'#111111', sub:'#444444' },
    black:  { box:'#111111', op:100, title:'#ffffff', sub:'#dddddd' },
    accent: { box:'#2563eb', op:100, title:'#ffffff', sub:'#eaf0ff' },
    cream:  { box:'#f8f5f2', op:100, title:'#3d2b1f', sub:'#5a3e30' },
    red:    { box:'#FF0000', op:100, title:'#ffffff', sub:'#ffe5e5' },
    none:   { box:null, op:0, title:null, sub:null },
  };
  const p = presets[name]; if (!p) return;
  const slide = curSlide();
  const sel = selectedBox();
  if (sel && sel.obj) {
    // apply preset to the SELECTED box only
    const isTitle = sel.kind === 'el' ? !!sel.obj.bold : (sel.obj.kind === 'title');
    if (sel.kind === 'el') {
      sel.obj.bgColor = p.box; sel.obj.bgOpacity = p.op;
      if (p.title) sel.obj.color = isTitle ? p.title : p.sub;
    } else {
      sel.obj.boxColor = p.box; sel.obj.boxOp = p.op;
      if (p.title) sel.obj.color = isTitle ? p.title : p.sub;
    }
  } else {
    const f = ensureFmt(slide);
    f.box = p.box; f.boxOp = p.op;
    if (p.title) { f.titleColor = p.title; f.subColor = p.sub; }
    textElsOf(slide).forEach(e => { e.bgColor = p.box; e.bgOpacity = p.op; if (p.title) e.color = e.bold ? p.title : p.sub; });
    ensureBlocks(slide).forEach(b => { delete b.boxColor; delete b.boxOp; delete b.color; });
  }
  syncSidePanel(); renderSlidePreview(); renderThumbStrip(activeSlideIndex);
  showToast(sel ? `Preset aplicado à caixa ${_pvSelIdx + 1}` : 'Preset aplicado');
}
function sideColorsToAll() {
  const src = mergedFmt(curSlide(), activeCarousel.style);
  activeCarousel.slides.forEach((slide, i) => {
    const f = ensureFmt(slide);
    f.box = src.box; f.boxOp = src.boxOp; f.titleColor = src.titleColor;
    f.subColor = src.subColor; f.shadow = src.shadow;
    f.font = src.font;
    if (src.textShadow) f.textShadow = JSON.parse(JSON.stringify(src.textShadow));
    else delete f.textShadow;
    if (slide._elements) slide._elements.forEach(el => {
      if (el.type === 'text') {
        el.bgColor = src.box; el.bgOpacity = src.boxOp;
        el.color = el.bold ? src.titleColor : src.subColor;
        el.shadow = src.shadow;
        el.fontFamily = src.font;
        el.textShadow = src.textShadow ? JSON.parse(JSON.stringify(src.textShadow)) : null;
      }
    });
    const srcBlocks = ensureBlocks(curSlide());
    ensureBlocks(slide).forEach((b, bi) => {
      delete b.color; delete b.boxColor; delete b.boxOp; delete b.shadow;
      const sb = srcBlocks[bi] || srcBlocks[0];
      if (sb && sb.lineHeight) b.lineHeight = sb.lineHeight;
    });
  });
  renderSlidePreview();
  renderThumbStrip(null, true);
  persistDrafts();
  showToast('✅ Cores e fonte aplicadas a todos os slides');
}

// ── Folder color/font presets ──────────────────────────────────────
function _currentFolder() {
  if (!activeCarousel) return null;
  const fid = activeCarousel.folderId;
  return fid ? folders.find(f => f.id === fid) : null;
}

function syncFolderPresetBar() {
  const bar = document.getElementById('folderPresetBar');
  if (!bar) return;
  const folder = _currentFolder();
  if (!folder) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const preview = document.getElementById('folderPresetPreview');
  const btn = document.getElementById('btnLoadPreset');
  if (folder.preset) {
    btn.style.display = '';
    const p = folder.preset;
    const fontName = (p.font || 'Inter').replace(/['"]/g, '').split(',')[0].trim();
    // Backwards compat
    const ti = p.title || { color: p.titleColor, boxColor: p.box, boxOp: p.boxOp, shadow: p.shadow, textShadow: p.textShadow };
    const bo = p.body  || { color: p.subColor,   boxColor: p.box, boxOp: p.boxOp, shadow: p.shadow, textShadow: p.textShadow };
    function _swatchBg(s) {
      const h = s.boxColor || '#ffffff', o = s.boxOp != null ? s.boxOp : 100;
      const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
      return `rgba(${r},${g},${b},${o/100})`;
    }
    const tSh = ti.textShadow ? 'text-shadow:1px 1px 3px rgba(0,0,0,0.6);' : '';
    const bSh = bo.textShadow ? 'text-shadow:1px 1px 3px rgba(0,0,0,0.6);' : '';
    preview.innerHTML = `
      <div class="preset-card" onclick="loadFolderPreset()" title="Clique para aplicar">
        <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">
          <div class="preset-swatch-mini" style="background:${_swatchBg(ti)};${ti.shadow?'box-shadow:0 1px 4px rgba(0,0,0,0.3);':''}">
            <span style="color:${ti.color};font-family:'${fontName}',sans-serif;font-size:12px;font-weight:700;${tSh}">Título</span>
          </div>
          <div class="preset-swatch-mini" style="background:${_swatchBg(bo)};${bo.shadow?'box-shadow:0 1px 4px rgba(0,0,0,0.3);':''}">
            <span style="color:${bo.color};font-family:'${fontName}',sans-serif;font-size:9px;${bSh}">Texto</span>
          </div>
        </div>
        <div class="preset-info">
          <div class="preset-folder-name">📁 ${escHtml(folder.name)}</div>
          <div class="preset-details">${fontName}${ti.textShadow ? ' · Sombra' : ''}</div>
        </div>
      </div>`;
  } else {
    btn.style.display = 'none';
    preview.innerHTML = `<div class="preset-empty">Nenhum preset salvo para "${escHtml(folder.name)}"</div>`;
  }
}

function _captureBlockStyle(block, slideFmt) {
  return {
    color: block.color || (block.kind === 'title' ? slideFmt.titleColor : slideFmt.subColor),
    boxColor: block.boxColor !== undefined ? block.boxColor : slideFmt.box,
    boxOp: block.boxOp != null ? block.boxOp : (slideFmt.boxOp != null ? slideFmt.boxOp : 100),
    shadow: block.shadow != null ? block.shadow : !!slideFmt.shadow,
    textShadow: block.textShadow !== undefined ? block.textShadow : (slideFmt.textShadow || null),
    lineHeight: block.lineHeight || null,
  };
}

function saveFolderPreset() {
  const folder = _currentFolder();
  if (!folder) { showToast('Este carrossel não está em uma pasta'); return; }
  const slide = curSlide();
  const f = mergedFmt(slide, activeCarousel.style);
  const blocks = ensureBlocks(slide);
  const titleBlock = blocks.find(b => b.kind === 'title') || blocks[0];
  const bodyBlock = blocks.find(b => b.kind !== 'title') || blocks[blocks.length > 1 ? 1 : 0];

  folder.preset = {
    font: f.font,
    title: _captureBlockStyle(titleBlock, f),
    body: _captureBlockStyle(bodyBlock, f),
  };
  // Deep copy textShadow objects
  if (folder.preset.title.textShadow) folder.preset.title.textShadow = JSON.parse(JSON.stringify(folder.preset.title.textShadow));
  if (folder.preset.body.textShadow) folder.preset.body.textShadow = JSON.parse(JSON.stringify(folder.preset.body.textShadow));

  persistFolders();
  syncFolderPresetBar();
  showToast(`✅ Preset salvo para a pasta "${folder.name}"`);
}

function loadFolderPreset() {
  const folder = _currentFolder();
  if (!folder || !folder.preset) { showToast('Nenhum preset salvo nesta pasta'); return; }
  const p = folder.preset;

  // Backwards compat: old presets without title/body
  if (!p.title) {
    p.title = { color: p.titleColor, boxColor: p.box, boxOp: p.boxOp, shadow: p.shadow, textShadow: p.textShadow };
    p.body  = { color: p.subColor,   boxColor: p.box, boxOp: p.boxOp, shadow: p.shadow, textShadow: p.textShadow };
  }

  activeCarousel.slides.forEach(slide => {
    const fmt = ensureFmt(slide);
    if (p.font) fmt.font = p.font;
    // Apply per-block styles
    ensureBlocks(slide).forEach(b => {
      const src = (b.kind === 'title') ? p.title : p.body;
      b.color = src.color;
      b.boxColor = src.boxColor;
      b.boxOp = src.boxOp;
      b.shadow = src.shadow;
      b.textShadow = src.textShadow ? JSON.parse(JSON.stringify(src.textShadow)) : null;
      if (src.lineHeight) b.lineHeight = src.lineHeight;
    });
    // Also set slide-level fmt for rendering fallback
    fmt.titleColor = p.title.color;
    fmt.subColor = p.body.color;
    fmt.box = p.title.boxColor;
    fmt.boxOp = p.title.boxOp;
    fmt.shadow = p.title.shadow;
    fmt.textShadow = p.title.textShadow ? JSON.parse(JSON.stringify(p.title.textShadow)) : null;
    // Sync _elements
    if (slide._elements) slide._elements.forEach(el => {
      if (el.type === 'text') {
        const src = el.bold ? p.title : p.body;
        el.color = src.color;
        el.bgColor = src.boxColor;
        el.bgOpacity = src.boxOp;
        el.shadow = src.shadow;
        if (p.font) el.fontFamily = p.font;
        el.textShadow = src.textShadow ? JSON.parse(JSON.stringify(src.textShadow)) : null;
        if (src.lineHeight) el.lineHeight = src.lineHeight;
      }
    });
  });
  if (p.font && typeof ensureFontLoaded === 'function') ensureFontLoaded(p.font);
  syncSidePanel();
  renderSlidePreview();
  renderThumbStrip(null, true);
  persistDrafts();
  showToast(`✅ Preset da pasta "${folder.name}" aplicado a todos os slides`);
}

// ── Per-slide image ─────────────────────────────────────────────────
function renderSideImage() {
  const slide = activeCarousel.slides[activeSlideIndex];
  const eff = slideBg(slide, activeCarousel);   // effective image (respects noImage)
  const prev = document.getElementById('sideImgPreview');
  prev.style.backgroundImage = eff ? `url('${eff}')` : 'none';
  prev.classList.toggle('empty', !eff);
  prev.innerHTML = eff
    ? `<button class="img-remove-x" title="Remover imagem deste slide" onclick="event.stopPropagation(); sideRemoveImg()">✕</button>`
    : '<span>Sem imagem<br/><small>Clique 2x para escolher do PC</small></span>';

  // Zoom/position sliders only when there's an image
  const adj = document.getElementById('imgAdjust');
  adj.style.display = eff ? 'block' : 'none';
  if (eff) {
    const z = Math.round(((slide.bgZoom || 1) * 100));
    document.getElementById('rngImgZoom').value = z;
    document.getElementById('valImgZoom').textContent = (z / 100).toFixed(2) + 'x';
    document.getElementById('rngImgX').value = slide.bgX || 0;
    document.getElementById('rngImgY').value = slide.bgY || 0;
  }

  const gal = document.getElementById('sideGallery');
  const imgs = visibleGallery();
  gal.innerHTML = imgs.length
    ? imgs.map(g => `
      <div class="side-gal-thumb ${(!slide.noImage && eff === g.path) ? 'active' : ''}" style="background-image:url('${g.path}')"
        onclick="setSlideImage('${g.path}')" title="Usar neste slide">
        <button class="thumb-del small" title="Excluir da galeria" onclick="event.stopPropagation(); removeGalleryImage('${g.path}')">✕</button>
      </div>`).join('')
    : `<p class="gallery-empty" style="grid-column:1/-1">Sem imagens nesta pasta</p>`;
}

function setSlideImage(path) {
  const slide = activeCarousel.slides[activeSlideIndex];
  slide.bg = path;
  slide.noImage = false;
  refreshModal(activeSlideIndex);
  showToast(`✅ Imagem aplicada ao slide ${activeSlideIndex + 1}`);
}
function sideRemoveImg() {
  const slide = activeCarousel.slides[activeSlideIndex];
  delete slide.bg;
  slide.noImage = true;     // explicit: this slide shows no image (even if carousel.photo set)
  refreshModal(activeSlideIndex);
  showToast('🗑 Imagem removida do slide');
}
function sideApplyImgAll() {
  const cur = curSlide();
  const bg = slideBg(cur, activeCarousel);
  if (!bg) { showToast('Este slide não tem imagem'); return; }
  // copy the image + current zoom/position to every slide
  const zoom = cur.bgZoom, x = cur.bgX, y = cur.bgY;
  activeCarousel.slides.forEach(s => {
    s.bg = bg; s.noImage = false;
    if (zoom != null) s.bgZoom = zoom; else delete s.bgZoom;
    if (x != null) s.bgX = x; else delete s.bgX;
    if (y != null) s.bgY = y; else delete s.bgY;
  });
  activeCarousel.photo = bg;
  refreshModal(true);
  persistDrafts();
  showToast('✅ Imagem e enquadramento aplicados a todos');
}
function sideUploadForSlide() {
  _uploadTarget = 'slide';
  document.getElementById('photoInput').click();
}

// Background image zoom + position (per slide)
function sideImgZoom(v) {
  curSlide().bgZoom = v / 100;
  document.getElementById('valImgZoom').textContent = (v / 100).toFixed(2) + 'x';
  renderSlidePreview(); renderThumbStrip(activeSlideIndex); persistDrafts();
}
function sideImgPos(axis, v) {
  curSlide()[axis === 'x' ? 'bgX' : 'bgY'] = v;
  renderSlidePreview(); renderThumbStrip(activeSlideIndex); persistDrafts();
}
function sideImgReset() {
  const s = curSlide();
  delete s.bgZoom; delete s.bgX; delete s.bgY;
  renderSideImage(); renderSlidePreview(); renderThumbStrip(activeSlideIndex); persistDrafts();
  showToast('Imagem resetada');
}

function getPreviewStyle(name) {
  const map = {
    medico:   { noBg:true,  solidBg:'#ffffff', cardBg:'rgba(255,255,255,0)', titleColor:'#111111', subtitleColor:'#444444', accent:'#2563eb', accentColor:'#2563eb', titleSize:'30px', subtitleSize:'17px', font:'Inter,sans-serif', radius:'0' },
    default:  { cardBg:'rgba(255,255,255,0.92)', titleColor:'#1a1a2e', subtitleColor:'#333', accent:'#2563eb', accentColor:'#2563eb', titleSize:'18px', subtitleSize:'13px', font:'Inter,sans-serif', radius:'10px' },
    dark:     { cardBg:'rgba(10,10,10,0.88)', titleColor:'#fff', subtitleColor:'#ccc', accent:'#FF6A00', accentColor:'#FF6A00', titleSize:'18px', subtitleSize:'13px', font:'Inter,sans-serif', radius:'10px' },
    feminine: { cardBg:'rgba(248,245,242,0.93)', titleColor:'#3d2b1f', subtitleColor:'#5a3e30', accent:'#D4A373', accentColor:'#D4A373', titleSize:'17px', subtitleSize:'13px', font:'Georgia,serif', radius:'14px' },
    punk:     { cardBg:'rgba(17,17,17,0.90)', titleColor:'#fff', subtitleColor:'#bbb', accent:'#FF0000', accentColor:'#FF0000', titleSize:'20px', subtitleSize:'13px', font:'"Arial Black",sans-serif', radius:'0' },
  };
  return map[name] || map.medico;
}

// ── Copy ────────────────────────────────────────────────────────────
function copyAllTexts(idx) {
  const c = carousels[idx];
  const text = c.slides.map((s, i) => {
    const blocks = (s.blocks && s.blocks.length)
      ? s.blocks.map(b => b.text)
      : [s.title, s.subtitle].filter(Boolean);
    return `SLIDE ${i + 1}\n` + blocks.join('\n');
  }).join('\n\n---\n\n');
  navigator.clipboard.writeText(text); showToast('✅ Textos copiados!');
}
function copySlideTexts() { copyAllTexts(carousels.indexOf(activeCarousel)); }
function copyCaption(idx) {
  const c = idx !== undefined ? carousels[idx] : activeCarousel;
  navigator.clipboard.writeText(`${c.caption || ''}\n\n${(c.hashtags || []).join(' ')}`.trim());
  showToast('✅ Legenda copiada!');
}

// ── Progress overlay ────────────────────────────────────────────────
const RING_CIRC = 2 * Math.PI * 52;
function showProgress(label) {
  document.getElementById('progressLabel').textContent = label || 'Processando...';
  setProgress(0);
  document.getElementById('progressOverlay').style.display = 'flex';
}
function setProgress(pct) {
  pct = Math.max(0, Math.min(100, pct));
  document.getElementById('progressPct').textContent = Math.round(pct) + '%';
  const fill = document.getElementById('ringFill');
  fill.style.strokeDasharray = RING_CIRC;
  fill.style.strokeDashoffset = RING_CIRC * (1 - pct / 100);
}
function hideProgress() { document.getElementById('progressOverlay').style.display = 'none'; }

// Animate progress toward a target while an async task runs
function startFakeProgress(estMs, cap = 92) {
  let pct = 0;
  const step = 100 / (estMs / 100);
  const timer = setInterval(() => {
    pct = Math.min(cap, pct + step * (1 - pct / 100) * 1.6);
    setProgress(pct);
  }, 100);
  return timer;
}

// ── Export ──────────────────────────────────────────────────────────
async function exportCurrentCarousel() {
  const n = activeCarousel.slides.length;
  const fmt = (document.getElementById('exportFormat') || {}).value || 'png';
  showProgress(`Renderizando ${n} slides em ${fmt.toUpperCase()}...`);
  const timer = startFakeProgress(n * 900);
  document.querySelector('.btn-primary').disabled = true;
  try {
    const res = await fetch('/api/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carousel: activeCarousel, format: fmt })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    clearInterval(timer); setProgress(100);
    setTimeout(hideProgress, 400);

    // Auto-download the ZIP with all slides
    if (data.zip) {
      const a = document.createElement('a');
      const topic = (activeCarousel.topic || 'carrossel').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
      a.href = data.zip + '?t=' + Date.now();
      a.download = `${topic}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    showToast(`✅ ${data.files.length} slides baixados em .zip!`);
  } catch (err) {
    clearInterval(timer); hideProgress();
    showToast('Erro: ' + err.message);
  } finally {
    document.querySelector('.btn-primary').disabled = false;
  }
}

// ── Share (Canva-style editable link) ───────────────────────────────
async function shareDesign() {
  if (!activeCarousel) return;
  try {
    const res = await fetch('/api/share', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carousel: activeCarousel, id: activeCarousel._shareId })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    activeCarousel._shareId = data.id;
    const url = `${location.origin}/?d=${data.id}`;
    try { await navigator.clipboard.writeText(url); } catch {}
    showShareDialog(url);
  } catch (err) {
    showToast('Erro ao compartilhar: ' + err.message);
  }
}

function showShareDialog(url) {
  let dlg = document.getElementById('shareDialog');
  if (!dlg) {
    dlg = document.createElement('div');
    dlg.id = 'shareDialog';
    dlg.className = 'share-dialog';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = `
    <div class="share-box">
      <h3>🔗 Link de edição compartilhável</h3>
      <p>Qualquer pessoa com este link pode abrir e editar este carrossel.</p>
      <div class="share-url-row">
        <input id="shareUrlInput" value="${url}" readonly onclick="this.select()" />
        <button class="btn-primary" onclick="copyShareUrl()">Copiar</button>
      </div>
      <p class="share-note">✅ Link copiado! (funciona nesta rede; quando publicar o site, funcionará para todos)</p>
      <button class="btn-secondary" onclick="document.getElementById('shareDialog').remove()">Fechar</button>
    </div>`;
}
function copyShareUrl() {
  const inp = document.getElementById('shareUrlInput');
  inp.select(); navigator.clipboard.writeText(inp.value);
  showToast('✅ Link copiado!');
}

// Load a shared design if URL has ?d=<id>
async function loadFromUrl() {
  const id = new URLSearchParams(location.search).get('d');
  if (!id) return false;
  try {
    const res = await fetch('/api/design/' + encodeURIComponent(id));
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const c = data.carousel;
    c._shareId = id;
    carousels = [c, ...carousels];
    renderCarousels();
    openModal(0);
    showToast('✅ Design compartilhado carregado — edite e compartilhe de volta');
    return true;
  } catch (err) {
    showToast('Não foi possível abrir o design: ' + err.message);
    return false;
  }
}

// ── AI image generation (per page) ──────────────────────────────────
let aiProvider = 'free';

function openAiImage() {
  if (!activeCarousel) { showToast('Abra um carrossel primeiro'); return; }
  document.getElementById('aiToken').value = localStorage.getItem('pollinations_token') || '';
  const pagesEl = document.getElementById('aiPages');
  if (!pagesEl.value) pagesEl.value = String(activeSlideIndex + 1);
  document.getElementById('aiImageDialog').style.display = 'flex';
  renderAiPerPage();
}
function closeAiImage() { document.getElementById('aiImageDialog').style.display = 'none'; }
function setAiProvider(p) {
  aiProvider = p;
  document.querySelectorAll('.ai-prov').forEach(b => b.classList.toggle('active', b.dataset.prov === p));
  document.getElementById('aiFreeToken').style.display = p === 'free' ? 'block' : 'none';
  document.getElementById('aiProNote').style.display = p === 'pro' ? 'block' : 'none';
}
function saveAiToken() {
  localStorage.setItem('pollinations_token', document.getElementById('aiToken').value.trim());
}

// "2-5, 7" → [1,2,3,4,6] (0-based indices, clamped to slide count)
function parseAiPages(str, total) {
  const set = new Set();
  (str || '').split(',').forEach(part => {
    part = part.trim();
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]; for (let i = a; i <= b; i++) set.add(i); }
    else if (/^\d+$/.test(part)) set.add(+part);
  });
  return [...set].filter(n => n >= 1 && n <= total).sort((a, b) => a - b).map(n => n - 1);
}

function renderAiPerPage() {
  const list = document.getElementById('aiPerPageList');
  if (!activeCarousel || !document.getElementById('aiPerPage').checked) { list.innerHTML = ''; return; }
  const idxs = parseAiPages(document.getElementById('aiPages').value, activeCarousel.slides.length);
  list.innerHTML = idxs.map(i => `
    <div class="ai-perpage">
      <span class="ai-pp-label">Pág. ${i + 1}</span>
      <input class="ai-input ai-pp-input" data-idx="${i}" placeholder="Prompt da página ${i + 1} (opcional)" />
    </div>`).join('');
}

async function generateAiImages() {
  if (!activeCarousel) return;
  const total = activeCarousel.slides.length;
  const idxs = parseAiPages(document.getElementById('aiPages').value, total);
  if (!idxs.length) { showToast('Digite as páginas (ex: 2-5)'); return; }

  const general = document.getElementById('aiPrompt').value.trim();
  const perPage = {};
  document.querySelectorAll('.ai-pp-input').forEach(inp => { if (inp.value.trim()) perPage[+inp.dataset.idx] = inp.value.trim(); });
  if (!general && !Object.keys(perPage).length) { showToast('Escreva um prompt'); return; }

  const useContext = document.getElementById('aiUseContext').checked;
  const token = (document.getElementById('aiToken').value || '').trim();
  const provider = aiProvider;

  closeAiImage();
  showProgress(`Gerando ${idxs.length} imagem(ns) com IA (${provider === 'pro' ? 'Nano Banana' : 'Free'})...`);

  let done = 0, ok = 0, firstErr = null;
  for (const i of idxs) {
    const slide = activeCarousel.slides[i];
    const base = perPage[i] || general;
    const ctx = useContext ? `. Tema do slide: ${slide.title || ''}. ${slide.subtitle || ''}` : '';
    const prompt = `${base}${ctx}. Imagem vertical 4:5 para carrossel médico de Instagram, profissional, alta qualidade, sem texto na imagem`;
    setProgress((done / idxs.length) * 100);
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, prompt, token })
      });
      const data = await res.json();
      if (data.error) firstErr = firstErr || data.error;
      else if (data.path) {
        slide.bg = data.path; slide.noImage = false; ok++;
        const fid = activeCarousel.folderId || null;
        if (!galleryImages.some(g => g.path === data.path)) galleryImages.unshift({ path: data.path, folderId: fid });
      }
    } catch (e) { firstErr = firstErr || e.message; }
    done++;
    setProgress((done / idxs.length) * 100);
  }

  hideProgress();
  renderGallery();
  refreshModal(activeSlideIndex);
  persistDrafts();
  if (ok) showToast(`✅ ${ok} imagem(ns) gerada(s) e aplicada(s)!`);
  if (firstErr) setTimeout(() => showToast('⚠️ ' + firstErr), ok ? 1800 : 0);
}

// ── Quick AI image (1-click, uses slide text as prompt) ─────────────
async function quickGenerateSlideImage() {
  if (!activeCarousel) { showToast('Abra um carrossel primeiro'); return; }
  const slide = activeCarousel.slides[activeSlideIndex];
  const title = (slide.title || '').trim();
  const sub   = (slide.subtitle || slide.blocks?.[0]?.text || '').trim();
  if (!title && !sub) { showToast('Slide sem texto — escreva o conteúdo primeiro'); return; }

  const token = localStorage.getItem('pollinations_token') || '';
  const slideNum = activeSlideIndex + 1;
  const isFirst = activeSlideIndex === 0;
  const slideText = [title, sub].filter(Boolean).join('. ');

  showProgress(`Gerando imagem para slide ${slideNum}...`);
  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'free', slideText, isCover: isFirst, token })
    });
    const data = await res.json();
    hideProgress();
    if (data.error) { showToast('⚠️ ' + data.error); return; }
    slide.bg = data.path; slide.noImage = false;
    const fid = activeCarousel.folderId || null;
    if (!galleryImages.some(g => g.path === data.path)) galleryImages.unshift({ path: data.path, folderId: fid });
    refreshModal(activeSlideIndex);
    renderGallery();
    persistDrafts();
    showToast(`✅ Imagem gerada para slide ${slideNum}!`);
  } catch (e) {
    hideProgress();
    showToast('⚠️ ' + e.message);
  }
}

// ── Drafts (localStorage) ───────────────────────────────────────────
const DRAFT_KEY = 'carouselmed_drafts';
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(carousels));
    showToast(`💾 ${carousels.length} carrossel(éis) salvos como rascunho`);
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message);
  }
}
// Accept both old format (["path",...]) and new ([{path,folderId},...])
function normalizeGallery(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(g => typeof g === 'string' ? { path: g, folderId: null } : g).filter(g => g && g.path);
}

function loadDrafts() {
  try {
    galleryImages = normalizeGallery(JSON.parse(localStorage.getItem('carouselmed_gallery') || '[]'));
    renderGallery();
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved) && saved.length) {
      carousels = saved;
      renderCarousels();
    }
  } catch {}
}

// ── Utils ───────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

document.addEventListener('keydown', e => {
  if (typeof Ed !== 'undefined' && Ed.open) return;
  if (document.getElementById('slideModal').style.display === 'none') return;
  if (e.key === 'ArrowLeft')  navSlide(-1);
  if (e.key === 'ArrowRight') navSlide(1);
  if (e.key === 'Escape')     closeModal();
});

// Load drafts from the server file (survives PC restart / cache clear / other browser)
async function loadFromServer() {
  try {
    const r = await fetch('/api/drafts');
    const d = await r.json();
    if (d && ((d.carousels && d.carousels.length) || (d.folders && d.folders.length))) {
      carousels = d.carousels || [];
      folders = d.folders || [];
      currentFolder = d.currentFolder || 'all';
      galleryImages = normalizeGallery(d.galleryImages);
      // Keep localStorage in sync so cache never diverges from server
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(carousels));
        localStorage.setItem(FOLDERS_KEY, JSON.stringify({ folders, currentFolder }));
      } catch {}
      renderGallery();
      renderCarousels();
      return true;
    }
  } catch {}
  return false;
}

// ── Notifications + Dashboard (Calendar) ───────────────────────────
let _calSummary = null;   // cached summary from /api/calendar/summary
let _mainTab = 'main';    // 'main' | 'dashboard'

async function loadCalendarSummary() {
  try {
    const res = await fetch('/api/calendar/summary');
    _calSummary = await res.json();
    updateNotifBadge();
    return _calSummary;
  } catch { return null; }
}

function _pendingItems() {
  if (!_calSummary) return [];
  const importedIds = new Set(carousels.filter(c => c._calendarId).map(c => c._calendarId));
  return (_calSummary.allItems || []).filter(c => !importedIds.has(c.id));
}

function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  const count = _pendingItems().filter(c => c.status === 'producao').length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'flex';
  if (!open) renderNotifList();
}

const _statusLabels = {
  rascunho:'Rascunho', roteiro:'Roteiro', gravacao:'Gravação', producao:'Produção',
  edicao:'Edição', aprovacao:'Em aprovação', alteracao:'Alteração', aprovado:'Aprovado',
  agendado:'Agendado', publicado:'Publicado', cancelado:'Cancelado'
};

async function renderNotifList() {
  if (!_calSummary) await loadCalendarSummary();
  const list = document.getElementById('notifList');

  const importedIds = new Map(carousels.filter(c => c._calendarId).map(c => [c._calendarId, c.id]));
  let items = (_calSummary.allItems || []).map(c => ({ ...c, _imported: importedIds.has(c.id), _carouselId: importedIds.get(c.id) }));

  // Populate doctor dropdown from all calendar items
  const sel = document.getElementById('notifDoctor');
  if (sel) {
    const prev = sel.value;
    const names = [...new Set(items.map(c => c.doctor_name))].sort();
    sel.innerHTML = '<option value="">Todos os médicos</option>' +
      names.map(n => `<option value="${escHtml(n)}"${n === prev ? ' selected' : ''}>${escHtml(n)}</option>`).join('');
  }

  // Apply filters
  const search = (document.getElementById('notifSearch')?.value || '').toLowerCase().trim();
  const doctor = document.getElementById('notifDoctor')?.value || '';
  const dateFrom = document.getElementById('notifDateFrom')?.value || '';
  const dateTo = document.getElementById('notifDateTo')?.value || '';
  const status = document.getElementById('notifStatus')?.value || '';

  if (search) items = items.filter(c =>
    (c.title || '').toLowerCase().includes(search) ||
    (c.description || '').toLowerCase().includes(search) ||
    (c.doctor_name || '').toLowerCase().includes(search));
  if (doctor) items = items.filter(c => c.doctor_name === doctor);
  if (status) items = items.filter(c => c.status === status);
  if (dateFrom) items = items.filter(c => c.date >= dateFrom);
  if (dateTo) items = items.filter(c => c.date <= dateTo);

  if (!items.length) {
    list.innerHTML = `<div class="notif-empty">Nenhum resultado com esses filtros.</div>`;
    return;
  }
  list.innerHTML = items.map(c => {
    const dd = c.date ? c.date.slice(8,10) + '/' + c.date.slice(5,7) : '';
    const statusLabel = _statusLabels[c.status] || c.status || '';
    const action = c._imported
      ? `<span class="notif-imported">✓ Importado</span>`
      : `<button class="notif-approve" onclick="approveFromNotif('${c.id}','${c.doctor_id}','${escHtml(c.doctor_name)}')">✓ Importar</button>`;
    return `<div class="notif-item${c._imported ? ' notif-item--imported' : ''}">
      <div class="notif-item-info">
        <div class="notif-item-doctor">${escHtml(c.doctor_name)}</div>
        <div class="notif-item-title">${escHtml(c.title)}</div>
        <div class="notif-item-date">${dd} · ${escHtml(c.category || '')}</div>
      </div>
      <div class="notif-item-actions">
        <span class="notif-status notif-status--${c.status || 'unknown'}">${escHtml(statusLabel)}</span>
        ${action}
      </div>
    </div>`;
  }).join('');
}

async function approveFromNotif(itemId, doctorId, doctorName) {
  const item = (_calSummary.allItems || []).find(c => c.id === itemId);
  if (!item) { showToast('Item não encontrado'); return; }

  // Find or create folder
  let folder = folders.find(f => f.name === doctorName);
  if (!folder) {
    folder = { id: 'f' + Date.now().toString(36), name: doctorName };
    folders.push(folder);
    persistFolders();
  }

  // Build carousel
  const dd = item.date ? item.date.slice(8,10) : '00';
  const mm = item.date ? item.date.slice(5,7) : '00';
  const topic = `${dd}-${mm} ${doctorName}`;
  const rawText = item.script || item.description || '';
  let slides = parseStructuredText(rawText);
  if (!slides.length && item.title) slides = [{ type:'info', title:item.title, subtitle:item.description || '' }];
  if (!slides.length) { showToast('Sem conteúdo para importar'); return; }

  const carousel = {
    id: `cal_${Date.now()}`,
    topic,
    style: currentStyle,
    level: (item.category || 'c1').toUpperCase(),
    slides,
    caption: item.description || '',
    hashtags: [],
    folderId: folder.id,
    _calendarId: item.id,
    _calendarStatus: item.status || 'importado',
  };
  carousels.unshift(carousel);

  updateNotifBadge();
  renderNotifList();

  currentFolder = folder.id;
  renderCarousels();
  persistDrafts();
  showToast(`✅ "${topic}" importado e aprovado na pasta "${doctorName}"!`);
}

// ── Main tab switching (Carrosséis / Dashboard) ────────────────────
function setMainTab(tab) {
  _mainTab = tab;
  document.getElementById('tabMain').classList.toggle('active', tab === 'main');
  document.getElementById('tabDashboard').classList.toggle('active', tab === 'dashboard');

  const dashboard = document.getElementById('dashboardView');
  const grid = document.getElementById('carouselGrid');
  const empty = document.getElementById('emptyState');
  const topAI = document.getElementById('topbarAI');
  const topPaste = document.getElementById('topbarPaste');
  const notes = document.getElementById('notesWorkspace');
  const folderBar = document.getElementById('folderBar');

  if (tab === 'dashboard') {
    dashboard.style.display = 'block';
    grid.style.display = 'none';
    empty.style.display = 'none';
    topAI.style.display = 'none';
    topPaste.style.display = 'none';
    notes.style.display = 'none';
    folderBar.style.display = 'none';
    renderDashboard();
  } else {
    dashboard.style.display = 'none';
    // Restore normal view
    if (mode === 'ai') { topAI.style.display = 'block'; topPaste.style.display = 'none'; }
    else { topAI.style.display = 'none'; topPaste.style.display = 'flex'; }
    updateMainView();
  }
}

async function renderDashboard() {
  const content = document.getElementById('dashboardContent');
  content.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px">Carregando dados do calendário...</p>';

  if (!_calSummary) await loadCalendarSummary();
  if (!_calSummary) { content.innerHTML = '<p style="color:#f66;text-align:center;padding:40px">Erro ao carregar calendário</p>'; return; }

  const allItems = _calSummary.allItems || [];
  const doctors = _calSummary.doctors || [];

  // Populate doctor dropdown (preserve selection)
  const dSel = document.getElementById('dashDoctor');
  if (dSel) {
    const prev = dSel.value;
    const names = [...new Set(allItems.map(c => c.doctor_name))].sort();
    dSel.innerHTML = '<option value="">Todos os médicos</option>' +
      names.map(n => `<option value="${escHtml(n)}"${n === prev ? ' selected' : ''}>${escHtml(n)}</option>`).join('');
  }

  // Read filters
  const fStatus = document.getElementById('dashStatus')?.value || '';
  const fDoctor = document.getElementById('dashDoctor')?.value || '';

  // Filter items
  let filtered = allItems;
  if (fStatus) filtered = filtered.filter(c => c.status === fStatus);
  if (fDoctor) filtered = filtered.filter(c => c.doctor_name === fDoctor);

  // Build per-doctor stats from filtered items
  const byDoc = {};
  for (const item of filtered) {
    const did = item.doctor_id;
    if (!byDoc[did]) byDoc[did] = { name: item.doctor_name, total: 0, producao: 0, aprovado: 0, agendado: 0, edicao: 0, gravacao: 0, roteiro: 0, rascunho: 0, aprovacao: 0, alteracao: 0, publicado: 0, cancelado: 0 };
    byDoc[did].total++;
    if (byDoc[did][item.status] !== undefined) byDoc[did][item.status]++;
  }

  const docIds = Object.keys(byDoc).sort((a,b) => byDoc[b].total - byDoc[a].total);

  // Count imported per doctor
  const importedByDoc = {};
  carousels.forEach(c => {
    if (c.folderId) {
      const f = folders.find(ff => ff.id === c.folderId);
      if (f) importedByDoc[f.name] = (importedByDoc[f.name] || 0) + 1;
    }
  });

  if (!docIds.length) {
    content.innerHTML = '<div class="notif-empty">Nenhum resultado com esses filtros.</div>';
    return;
  }

  content.innerHTML = docIds.map(did => {
    const d = byDoc[did];
    const doctor = doctors.find(x => x.id === did);
    const imported = importedByDoc[d.name] || 0;
    const importable = d.producao + d.agendado + d.aprovacao;
    const statParts = [];
    if (d.rascunho) statParts.push(`<span class="dash-stat rascunho">📝 ${d.rascunho} rascunho</span>`);
    if (d.roteiro) statParts.push(`<span class="dash-stat roteiro">📋 ${d.roteiro} roteiro</span>`);
    if (d.gravacao) statParts.push(`<span class="dash-stat gravacao">🎬 ${d.gravacao} gravação</span>`);
    if (d.producao) statParts.push(`<span class="dash-stat producao">🔨 ${d.producao} produção</span>`);
    if (d.edicao) statParts.push(`<span class="dash-stat edicao">✂️ ${d.edicao} edição</span>`);
    if (d.aprovacao) statParts.push(`<span class="dash-stat aprovacao">⏳ ${d.aprovacao} em aprovação</span>`);
    if (d.alteracao) statParts.push(`<span class="dash-stat alteracao">🔄 ${d.alteracao} alteração</span>`);
    if (d.aprovado) statParts.push(`<span class="dash-stat aprovado">✓ ${d.aprovado} aprovados</span>`);
    if (d.agendado) statParts.push(`<span class="dash-stat agendado">📅 ${d.agendado} agendados</span>`);
    if (d.publicado) statParts.push(`<span class="dash-stat publicado">🌐 ${d.publicado} publicados</span>`);
    if (d.cancelado) statParts.push(`<span class="dash-stat cancelado">✕ ${d.cancelado} cancelados</span>`);
    return `<div class="dash-card">
      <div class="dash-card-head">
        <div>
          <div class="dash-card-name">${escHtml(d.name)}</div>
          <div class="dash-card-specialty">${escHtml(doctor ? doctor.specialty : '')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:22px;font-weight:800;color:var(--text)">${d.total}</div>
          <div style="font-size:11px;color:var(--text-muted)">${fStatus ? (_statusLabels[fStatus] || fStatus) : 'total'}</div>
        </div>
      </div>
      <div class="dash-stats">${statParts.join('')}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-muted)">
        <span>📥 ${imported} importado(s) no CarouselMed</span>
        <span>${importable} pendente(s)</span>
      </div>
      <button class="dash-import-btn" onclick="dashImportDoctor('${did}','${escHtml(d.name)}')" ${importable === 0 ? 'disabled' : ''}>
        📥 Importar ${importable} pendente(s) de ${escHtml(d.name)}
      </button>
    </div>`;
  }).join('');
}

async function dashImportDoctor(doctorId, doctorName) {
  showToast(`Buscando conteúdos de ${doctorName}...`);
  try {
    const res = await fetch(`/api/calendar/content?doctor_id=${doctorId}`);
    const data = await res.json();
    const items = (data.items || []).filter(c => c.status === 'producao' || c.status === 'agendado' || c.status === 'aprovacao');
    if (!items.length) { showToast('Nenhum conteúdo pendente encontrado'); return; }

    let folder = folders.find(f => f.name === doctorName);
    if (!folder) {
      folder = { id: 'f' + Date.now().toString(36), name: doctorName };
      folders.push(folder);
      persistFolders();
    }

    let created = 0;
    for (const item of items) {
      // Skip if already imported
      if (carousels.some(c => c._calendarId === item.id)) continue;

      const dd = item.date ? item.date.slice(8,10) : '00';
      const mm = item.date ? item.date.slice(5,7) : '00';
      const topic = `${dd}-${mm} ${doctorName}`;
      const rawText = item.script || item.description || '';
      let slides = parseStructuredText(rawText);
      if (!slides.length && item.title) slides = [{ type:'info', title:item.title, subtitle:item.description || '' }];
      if (!slides.length) continue;

      carousels.unshift({
        id: `cal_${Date.now()}_${created}`,
        topic,
        style: currentStyle,
        level: (item.category || 'c1').toUpperCase(),
        slides,
        caption: item.description || '',
        hashtags: [],
        folderId: folder.id,
        _calendarId: item.id,
        _calendarStatus: item.status,
      });
      created++;
    }

    if (!created) { showToast('Todos os conteúdos já foram importados'); return; }

    currentFolder = folder.id;
    setMainTab('main');
    if (mode !== 'paste') setMode('paste');
    setPasteView('results');
    renderCarousels();
    persistDrafts();
    _calSummary = null; // force refresh
    showToast(`✅ ${created} carrossel(éis) de ${doctorName} importado(s)!`);
  } catch (err) {
    showToast('Erro: ' + err.message);
  }
}

// ── Calendar import (Doctor Creator) ───────────────────────────────
let _calDoctors = [];
let _calItems = [];

async function openCalendarImport() {
  document.getElementById('calendarDialog').style.display = 'flex';
  document.getElementById('calPreview').innerHTML = '';
  document.getElementById('calImportBtn').disabled = true;

  // Default date range: current month
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('calFrom').value = `${y}-${m}-01`;
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  document.getElementById('calTo').value = `${y}-${m}-${lastDay}`;

  // Fetch doctors list
  try {
    const sel = document.getElementById('calDoctor');
    sel.innerHTML = '<option value="">Carregando...</option>';
    const res = await fetch('/api/calendar/doctors');
    const data = await res.json();
    _calDoctors = data.doctors || [];
    sel.innerHTML = '<option value="">-- Selecione o médico --</option>' +
      _calDoctors.map(d => `<option value="${d.id}">${escHtml(d.name)} — ${escHtml(d.specialty || '')}</option>`).join('');
  } catch (err) {
    showToast('Erro ao carregar médicos: ' + err.message);
  }
}

function closeCalendarImport() {
  document.getElementById('calendarDialog').style.display = 'none';
}

async function calDoctorChanged() {
  const doctorId = document.getElementById('calDoctor').value;
  const from = document.getElementById('calFrom').value;
  const to = document.getElementById('calTo').value;
  const preview = document.getElementById('calPreview');
  const btn = document.getElementById('calImportBtn');

  if (!doctorId) { preview.innerHTML = ''; btn.disabled = true; return; }

  preview.innerHTML = '<p style="color:var(--text-muted)">Buscando conteúdos...</p>';
  try {
    let url = `/api/calendar/content?doctor_id=${doctorId}`;
    if (from) url += `&from=${from}`;
    if (to) url += `&to=${to}`;
    const res = await fetch(url);
    const data = await res.json();
    _calItems = data.items || [];

    if (!_calItems.length) {
      preview.innerHTML = '<p style="color:var(--text-muted)">Nenhum carrossel encontrado nesse período.</p>';
      btn.disabled = true;
      return;
    }

    preview.innerHTML = `<p class="cal-count">${_calItems.length} carrossel(éis) encontrado(s):</p>` +
      _calItems.map(c => {
        const d = c.date ? c.date.slice(8, 10) + '/' + c.date.slice(5, 7) : '';
        return `<div class="cal-item">
          <span class="cal-item-date">${d}</span>
          <span class="cal-item-title">${escHtml(c.title)}</span>
          <span class="cal-item-type">${c.category || ''}</span>
        </div>`;
      }).join('');
    btn.disabled = false;
    btn.textContent = `📥 Importar ${_calItems.length} carrossel(éis)`;
  } catch (err) {
    preview.innerHTML = `<p style="color:#f66">Erro: ${err.message}</p>`;
    btn.disabled = true;
  }
}

// Listen for date changes too
document.getElementById('calFrom')?.addEventListener('change', calDoctorChanged);
document.getElementById('calTo')?.addEventListener('change', calDoctorChanged);

function doCalendarImport() {
  if (!_calItems.length) return;
  const doctor = _calDoctors.find(d => d.id === document.getElementById('calDoctor').value);
  const doctorName = doctor ? doctor.name : 'Médico';

  // Find or create folder for this doctor
  let folder = folders.find(f => f.name === doctorName);
  if (!folder) {
    folder = { id: 'f' + Date.now().toString(36), name: doctorName };
    folders.push(folder);
    persistFolders();
  }

  let created = 0;
  for (const item of _calItems) {
    // Build slide name: "DD-MM NomeMédico"
    const dd = item.date ? item.date.slice(8, 10) : '00';
    const mm = item.date ? item.date.slice(5, 7) : '00';
    const topic = `${dd}-${mm} ${doctorName}`;

    // Parse the script field (Slide 1 — ... format) or fall back to description
    const rawText = item.script || item.description || '';
    let slides = parseStructuredText(rawText);
    if (!slides.length && item.title) {
      slides = [{ type: 'info', title: item.title, subtitle: item.description || '' }];
    }
    if (!slides.length) continue;

    // Map category to funnel level
    const level = (item.category || 'c1').toUpperCase();

    const carousel = {
      id: `cal_${Date.now()}_${created}`,
      topic,
      style: currentStyle,
      level: level,
      slides,
      caption: item.description || '',
      hashtags: [],
      folderId: folder.id,
    };
    carousels.unshift(carousel);
    created++;
  }

  if (!created) { showToast('Não foi possível criar carrosséis a partir dos dados'); return; }

  currentFolder = folder.id;
  closeCalendarImport();
  renderCarousels();
  persistDrafts();
  if (mode !== 'paste') setMode('paste');
  setPasteView('results');
  showToast(`✅ ${created} carrossel(éis) importado(s) para "${doctorName}"!`);
}

// Init — priority: shared link → server file → localStorage
(async () => {
  loadCustomTemplates();
  if (await loadFromUrl()) { renderFolders(); loadCalendarSummary(); return; }
  if (await loadFromServer()) { renderFolders(); loadCalendarSummary(); return; }
  loadFolders(); loadDrafts();
  renderFolders();
  loadCalendarSummary();
})();
