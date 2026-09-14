/* =====================================================================
   shared-render.js — UNIFIED slide rendering for preview + export.
   Loaded in the browser (window.SharedRender) and required by Node
   (generate.js). Guarantees preview === PNG.

   Layout model:
   - Default: flex-centered stack (title box + subtitle box) with auto-fit
     font sizing and consistent breathing room. Frames every slide the same.
   - Free mode (after dragging in advanced editor): absolute _elements.
   ===================================================================== */
(function (global) {

  const SLIDE_W = 1080, SLIDE_H = 1350;

  // Per-style format defaults (white boxes by default)
  const FMT = {
    medico:   { titleSize:64, subSize:40, titleColor:'#111111', subColor:'#444444', box:'#ffffff', boxOp:100, shadow:true,  align:'center', justify:'center',   gap:30, font:"Inter, sans-serif", padX:96, padTop:110, padBottom:110 },
    default:  { titleSize:60, subSize:40, titleColor:'#1a1a2e', subColor:'#333333', box:'#ffffff', boxOp:96,  shadow:false, align:'left',   justify:'flex-end', gap:18, font:"Inter, sans-serif", padX:64, padTop:80,  padBottom:120 },
    dark:     { titleSize:60, subSize:40, titleColor:'#ffffff', subColor:'#dddddd', box:'#0a0a0a', boxOp:88,  shadow:false, align:'left',   justify:'flex-end', gap:18, font:"Inter, sans-serif", padX:64, padTop:80,  padBottom:120 },
    feminine: { titleSize:58, subSize:40, titleColor:'#3d2b1f', subColor:'#5a3e30', box:'#f8f5f2', boxOp:94,  shadow:false, align:'left',   justify:'flex-end', gap:18, font:"Georgia, serif",   padX:64, padTop:80,  padBottom:120 },
    punk:     { titleSize:66, subSize:40, titleColor:'#ffffff', subColor:'#bbbbbb', box:'#111111', boxOp:92,  shadow:false, align:'left',   justify:'flex-end', gap:16, font:'"Arial Black", sans-serif', padX:60, padTop:80, padBottom:120 },
    azul:     { titleSize:62, subSize:40, titleColor:'#ffffff', subColor:'#cce0ff', box:'#1a56db', boxOp:95,  shadow:true,  align:'left',   justify:'flex-end', gap:18, font:"Inter, sans-serif", padX:64, padTop:80,  padBottom:120 },
    verde:    { titleSize:60, subSize:38, titleColor:'#ffffff', subColor:'#d4edda', box:'#197a3b', boxOp:92,  shadow:false, align:'left',   justify:'flex-end', gap:18, font:"Inter, sans-serif", padX:64, padTop:80,  padBottom:120 },
    premium:  { titleSize:56, subSize:36, titleColor:'#d4af37', subColor:'#a89060', box:'#0a0a0a', boxOp:96,  shadow:false, align:'center', justify:'center',   gap:22, font:"Georgia, serif",   padX:80, padTop:100, padBottom:100 },
    minimal:  { titleSize:70, subSize:42, titleColor:'#1a1a1a', subColor:'#444444', box:'#ffffff', boxOp:90,  shadow:false, align:'center', justify:'flex-start', gap:20, font:"Inter, sans-serif", padX:60, padTop:70, padBottom:80 },
    // ── Tweet com Imagem: foto no topo + área creme embaixo ─────────────
    tweet_com_imagem:      { titleSize:52, subSize:41, titleColor:'#1a1a1a', subColor:'#3d3d3d', box:'#ffffff', boxOp:0, shadow:false, align:'left', justify:'flex-start', gap:36, font:"Georgia, serif", padX:72, padTop:590, padBottom:190, bgType:'split', bgColor:'#f5f0ea', bgSplitRatio:0.42 },
    tweet_com_imagem_capa: { titleSize:70, subSize:50, titleColor:'#ffffff', subColor:'#f0f0f0', box:'#ffffff', boxOp:0, shadow:false, align:'left', justify:'flex-end',   gap:12, font:"Georgia, serif", padX:72, padTop:80,  padBottom:110, bgType:'image', bgOverlay:'linear-gradient(to bottom,rgba(255,255,255,0.42) 0%,rgba(255,255,255,0) 16%,transparent 45%,rgba(0,0,0,0.62) 82%,rgba(0,0,0,0.78) 100%)', textShadow:{x:0,y:2,blur:14,color:'rgba(0,0,0,0.55)'} },
    // ── Texto + Imagem Escura: foto escurecida, texto branco grande em baixo ─
    texto_img_escura: { titleSize:84, subSize:37, titleColor:'#ffffff', subColor:'#cccccc', box:'#ffffff', boxOp:0, shadow:false, align:'left', justify:'flex-end', gap:16, font:'"Playfair Display", serif', padX:72, padTop:80, padBottom:130, bgType:'image', bgOverlay:'linear-gradient(to bottom,rgba(0,0,0,0.28) 0%,rgba(0,0,0,0.38) 42%,rgba(0,0,0,0.70) 78%,rgba(0,0,0,0.82) 100%)', textShadow:{x:0,y:1,blur:10,color:'rgba(0,0,0,0.5)'} },
    // ── Tweet: capa foto + slides internos com fundo sólido e crédito do médico ──
    tweet:      { titleSize:82, subSize:44, titleColor:'#ffffff', subColor:'#cccccc', box:'#ffffff', boxOp:0, shadow:false, align:'left', justify:'center',   gap:22, font:'"Inter","Arial",sans-serif', padX:72, padTop:80,  padBottom:80,  bgType:'solid', bgColor:'#04284e', textShadow:{x:0,y:2,blur:12,color:'rgba(0,0,0,0.55)'} },
    tweet_capa: { titleSize:80, subSize:42, titleColor:'#ffffff', subColor:'#e0e0e0', box:'#ffffff', boxOp:0, shadow:false, align:'left', justify:'flex-end', gap:20, font:'"Inter","Arial",sans-serif', padX:72, padTop:80,  padBottom:130, bgType:'image', bgOverlay:'linear-gradient(to bottom,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0.10) 38%,rgba(0,0,0,0.62) 75%,rgba(0,0,0,0.82) 100%)', textShadow:{x:0,y:2,blur:10,color:'rgba(0,0,0,0.65)'} },
    // ── Tweet Érica: capa foto + slides internos alternando preto e branco, texto grande justificado
    tweet_erica:      { titleSize:70, subSize:48, titleColor:'#ffffff', subColor:'#e0e0e0', box:'#ffffff', boxOp:0, shadow:false, align:'justify', justify:'center', gap:32, font:'"Inter","Arial",sans-serif', padX:88, padTop:110, padBottom:180, bgType:'solid', bgColor:'#000000',
      altColors:[{bg:'#ffffff',title:'#1a1a1a',sub:'#444444'},{bg:'#000000',title:'#ffffff',sub:'#e0e0e0'}] },
    tweet_erica_capa: { titleSize:80, subSize:42, titleColor:'#ffffff', subColor:'#e0e0e0', box:'#ffffff', boxOp:0, shadow:false, align:'left', justify:'flex-end', gap:20, font:'"Inter","Arial",sans-serif', padX:72, padTop:80,  padBottom:130, bgType:'image', bgOverlay:'linear-gradient(to bottom,rgba(0,0,0,0.05) 0%,rgba(0,0,0,0.10) 38%,rgba(0,0,0,0.62) 75%,rgba(0,0,0,0.82) 100%)', textShadow:{x:0,y:2,blur:10,color:'rgba(0,0,0,0.65)'} },
    // ── Tela Dividida com Blur: foto completa + frosted-glass no topo para texto
    tela_dividida:      { titleSize:76, subSize:44, titleColor:'#0d0d0d', subColor:'#2a2a2a', box:'#f4f4f4', boxOp:0, shadow:false, align:'center', justify:'flex-start', gap:20, font:'"Montserrat","Inter",sans-serif', padX:60, padTop:88,  padBottom:840, bgType:'blur-top', bgColor:'#f2f2f2', bgBlurRatio:0.38, bgBlurAmount:10, bgBlurOverlay:'rgba(250,250,250,0.52)' },
    tela_dividida_capa: { titleSize:72, subSize:44, titleColor:'#ffffff', subColor:'#c8ddf0', box:'#ffffff', boxOp:0, shadow:false, align:'left',   justify:'flex-start', gap:24, font:'"Montserrat","Inter",sans-serif', padX:64, padTop:108, padBottom:840, bgType:'blur-top', bgColor:'#0a2358', bgBlurRatio:0.38, bgBlurAmount:10, bgBlurOverlay:'rgba(10,35,88,0.72)', textShadow:{x:0,y:2,blur:8,color:'rgba(0,0,0,0.35)'} },
  };

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Clean copy: remove structural labels (CAPA / Slide N / Título / Texto)
  // and travessões (em/en dash → comma). Used by generation + paste.
  function sanitizeCopy(s) {
    if (!s) return '';
    let t = String(s).replace(/\*\*/g, '').replace(/\r/g, '');
    // Strip a leading structural label
    t = t.replace(/^\s*(capa|slide\s*\d+|p[áa]gina\s*\d+|t[íi]tulo|texto|gancho|cta|conte[úu]do|legenda)\s*[:\-–—.)]+\s*/i, '');
    // Remove any remaining "Slide N" / "CAPA" / "Página N" markers
    t = t.replace(/\b(slide\s*\d+|capa|p[áa]gina\s*\d+)\b\s*[:\-–—]?\s*/gi, '');
    // Travessão (— –) → comma (keeps the sentence flowing)
    t = t.replace(/\s*[—–]\s*/g, ', ');
    // Tidy punctuation: no space before punctuation, no double commas
    t = t.replace(/\s+([,.!?;:])/g, '$1').replace(/,\s*,/g, ',').replace(/^[\s,.:;-]+/, '');
    return t.replace(/[ \t]+/g, ' ').trim();
  }
  function _buildTextShadow(ts, U) {
    if (!ts) return '';
    const rad = (ts.angle || 0) * Math.PI / 180;
    const x = Math.round(Math.cos(rad) * (ts.dist || 0));
    const y = Math.round(Math.sin(rad) * (ts.dist || 0));
    const c = ts.color || '#000000';
    const pr = parseInt(c.slice(1,3),16), pg = parseInt(c.slice(3,5),16), pb = parseInt(c.slice(5,7),16);
    const a = (ts.opacity != null ? ts.opacity : 100) / 100;
    const one = `${U(x)} ${U(y)} ${U(ts.blur||0)} rgba(${pr},${pg},${pb},${a})`;
    // Stack 3 layers for solid, opaque shadow (like CapCut)
    return `text-shadow:${one},${one},${one};`;
  }

  function hexToRgba(hex, a) {
    if (!hex) return 'transparent';
    if (!hex.startsWith('#')) return hex;
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Auto-fit font size: shrink when text is long so it stays in the breathing area
  function fit(text, base, maxChars, min) {
    const len = (text || '').length;
    if (len <= maxChars) return base;
    return Math.max(min, Math.round(base * (maxChars / len) * 1.06));
  }

  // Merge style defaults + per-slide overrides + auto-fit
  function getFmt(slide, style) {
    const base = FMT[style] || FMT.medico;
    const o = slide.fmt || {};
    const titleSize = o.titleSize != null ? o.titleSize : fit(slide.title, base.titleSize, 40, Math.round(base.titleSize*0.55));
    const subSize   = o.subSize   != null ? o.subSize   : fit(slide.subtitle, base.subSize, 95, Math.round(base.subSize*0.6));
    return Object.assign({}, base, o, { titleSize, subSize, font: o.font || base.font });
  }

  // Derive the canonical block list from a slide.
  // Uses slide.blocks if present, else builds from title/subtitle.
  function deriveBlocks(slide) {
    if (slide.blocks && slide.blocks.length) return slide.blocks;
    const b = [];
    if (slide.title)    b.push({ text: slide.title, kind: 'title' });
    if (slide.subtitle) b.push({ text: slide.subtitle, kind: 'body' });
    if (!b.length)      b.push({ text: slide.title || '', kind: 'title' });
    return b;
  }

  // Normalize blocks with effective size/color/bold (+ auto-fit when not overridden)
  function normalizeBlocks(slide, style) {
    const base = FMT[style] || FMT.medico;
    const o = slide.fmt || {};
    const align = o.align || base.align;
    const titleColor = o.titleColor || base.titleColor;
    const subColor   = o.subColor   || base.subtitleColor || base.subColor;
    const arr = deriveBlocks(slide);
    return arr.map((bl, i) => {
      // A lone box is always treated as a title (bigger + bold)
      const isTitle = arr.length === 1 ? true : (bl.kind ? bl.kind === 'title' : i === 0);
      const baseSize = isTitle ? (o.titleSize || base.titleSize) : (o.subSize || base.subSize);
      let size;
      if (bl.size != null) size = bl.size;
      else if (isTitle && o.titleSize) size = o.titleSize;
      else if (!isTitle && o.subSize) size = o.subSize;
      else size = fit(bl.text, baseSize, isTitle ? 40 : 95, Math.round(baseSize * 0.55));
      return {
        text: bl.text,
        size,
        color: bl.color || (isTitle ? titleColor : subColor),
        bold: bl.bold != null ? bl.bold : isTitle,
        align: bl.align || align,
        // per-block box styling (falls back to slide-level fmt)
        boxColor: bl.boxColor !== undefined ? bl.boxColor : (o.box !== undefined ? o.box : base.box),
        boxOp: bl.boxOp != null ? bl.boxOp : (o.boxOp != null ? o.boxOp : base.boxOp),
        shadow: bl.shadow != null ? bl.shadow : (o.shadow != null ? o.shadow : base.shadow),
        textShadow: bl.textShadow !== undefined ? bl.textShadow : (o.textShadow || null),
        lineHeight: bl.lineHeight || null,
      };
    });
  }

  // One hugging text box (idx = block index, used for preview dragging)
  function oneBox(bl, f, U, idx) {
    if (!bl.text || /^\s*\(?\s*\)?\s*$/.test(bl.text)) return '';
    const boxColor = bl.boxColor !== undefined ? bl.boxColor : f.box;
    const boxOp = bl.boxOp != null ? bl.boxOp : f.boxOp;
    const sh = bl.shadow != null ? bl.shadow : f.shadow;
    const hasBox = boxColor && boxOp > 0;
    const bg = hasBox ? hexToRgba(boxColor, boxOp / 100) : 'transparent';
    const shadow = (hasBox && sh) ? `box-shadow:0 ${U(12)} ${U(45)} rgba(0,0,0,0.16);` : '';
    const ts = bl.textShadow !== undefined ? bl.textShadow : f.textShadow;
    const txtSh = ts ? _buildTextShadow(ts, U) : '';
    const jc = bl.align === 'center' ? 'center' : (bl.align === 'right' ? 'flex-end' : 'flex-start');
    const pad = hasBox ? `${U(20)} ${U(32)}` : '0';
    const boxWidth = hasBox ? 'max-width:100%' : 'width:100%;max-width:100%';
    return `<div class="sr-box" data-i="${idx == null ? '' : idx}" style="${boxWidth};display:flex;justify-content:${jc};">
      <span style="display:inline-block;background:${bg};color:${bl.color};
        font-size:${U(bl.size)};font-weight:${bl.bold?'700':'400'};font-family:${f.font};
        border-radius:${U(16)};padding:${pad};${shadow}${txtSh}
        text-align:${bl.align};line-height:${bl.lineHeight || 1.3};white-space:pre-wrap;word-break:break-word;
        box-decoration-break:clone;-webkit-box-decoration-break:clone;">${esc(bl.text)}</span>
    </div>`;
  }

  // Flex-centered stack (default layout) — frames every slide consistently
  function buildFlexBoxes(slide, style, U) {
    const f = getFmt(slide, style);
    const offY = (slide.fmt && slide.fmt.offsetY) || 0;
    const gap = (slide.fmt && slide.fmt.gap != null) ? slide.fmt.gap : f.gap;
    const boxes = normalizeBlocks(slide, style).map((bl, idx) => oneBox(bl, f, U, idx)).join('');
    return `<div style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:${f.justify};gap:${U(gap)};
      padding:${U(f.padTop)} ${U(f.padX)} ${U(f.padBottom)};box-sizing:border-box;
      transform:translateY(${U(offY)});">${boxes}</div>`;
  }

  // Absolute element (free-positioned). textIdx = index among text elements (preview drag)
  function renderAbsEl(el, U, textIdx) {
    const base = `position:absolute;left:${U(el.x)};top:${U(el.y)};`;
    if (el.type === 'accent')
      return `<div style="${base}width:${U(el.w)};height:${U(el.h)};background:${el.color};border-radius:${U(el.borderRadius||4)};"></div>`;
    if (el.type === 'card')
      return `<div style="${base}width:${U(el.w)};height:${U(el.h)};background:${el.bgColor||'rgba(255,255,255,0.9)'};border-radius:${U(el.borderRadius||16)};"></div>`;
    if (el.type === 'text') {
      const hasBox = el.bgColor && el.bgOpacity > 0;
      const bg = hasBox ? hexToRgba(el.bgColor, el.bgOpacity/100) : 'transparent';
      const pad = hasBox ? `${U(22)} ${U(32)}` : '0';
      const shadow = (hasBox && el.shadow) ? `box-shadow:0 ${U(12)} ${U(45)} rgba(0,0,0,0.16);` : '';
      const txtSh = el.textShadow ? _buildTextShadow(el.textShadow, U) : '';
      const radius = el.boxRadius != null ? el.boxRadius : 14;
      const align = el.align || 'left';
      const inner = `<span style="display:inline-block;background:${bg};border-radius:${U(radius)};padding:${pad};${shadow}${txtSh}
        font-size:${U(el.fontSize)};font-family:${el.fontFamily};color:${el.color};
        font-weight:${el.bold?'700':'400'};font-style:${el.italic?'italic':'normal'};
        text-align:${align};line-height:${el.lineHeight || 1.3};white-space:pre-wrap;word-break:break-word;
        box-decoration-break:clone;-webkit-box-decoration-break:clone;">${esc(el.text)}</span>`;
      // width:max-content makes the box hug the text (auto-fit), capped by el.w
      const jc = align === 'center' ? 'center' : (align === 'right' ? 'flex-end' : 'flex-start');
      return `<div class="sr-box" data-i="${textIdx == null ? '' : textIdx}" style="${base}width:max-content;max-width:${U(el.w)};display:flex;justify-content:${jc};">${inner}</div>`;
    }
    return '';
  }

  // Background layer
  function bgLayer(slide, carousel, filesAsUrl) {
    const style = carousel.style || 'medico';
    const isMedico = style === 'medico';
    const fmt = FMT[style] || {};
    // slide.noImage = explicit "this slide has no image" (overrides carousel.photo)
    let bg = (slide && slide.noImage) ? null
           : ((slide && slide.bg) || (carousel && carousel.photo) || null);
    if (isMedico && !bg) {
      return `<div style="position:absolute;inset:0;background:${carousel.medicoBg || '#eceef2'};"></div>`;
    }
    // Split layout: photo on top N% OR bottom N%, solid color on the other side
    if (fmt.bgType === 'split') {
      const ratio = fmt.bgSplitRatio != null ? fmt.bgSplitRatio : 0.45;
      const pct = Math.round(ratio * 100);
      const solidColor = fmt.bgColor || '#ffffff';
      const photoBottom = fmt.bgSplitBottom === true;
      let photoHtml = '';
      if (bg) {
        const url = filesAsUrl ? filesAsUrl(bg) : bg;
        const zoom = (slide && slide.bgZoom) || 1;
        const px = (slide && slide.bgX) || 0;
        const py = (slide && slide.bgY) || 0;
        const transform = (zoom !== 1 || px || py) ? `transform:scale(${zoom}) translate(${px}%,${py}%);transform-origin:center center;` : '';
        const posStyle = photoBottom
          ? `bottom:0;left:0;right:0;height:${pct}%`
          : `top:0;left:0;right:0;height:${pct}%`;
        photoHtml = `<div style="position:absolute;${posStyle};overflow:hidden;">
          <div style="position:absolute;inset:0;background:url('${url}') center/cover no-repeat;${transform}"></div>
        </div>`;
      }
      return `<div style="position:absolute;inset:0;background:${solidColor};"></div>${photoHtml}`;
    }
    // Blur-top layout: full photo background + frosted/blurred panel at top N% for text
    if (fmt.bgType === 'blur-top') {
      const ratio    = fmt.bgBlurRatio  != null ? fmt.bgBlurRatio  : 0.38;
      const blurAmt  = fmt.bgBlurAmount != null ? fmt.bgBlurAmount : 10;
      const blurPct  = Math.round(ratio * 100);
      const exp      = Math.ceil(blurAmt * 2); // expand inner div to hide blur-edge fringe
      const innerH   = Math.round(1350 + exp * 4); // taller than slide so photo centers correctly
      // carousel.bgColor overrides the built-in overlay color
      let overlay, overlayFade;
      if (carousel && carousel.bgColor) {
        overlay     = hexToRgba(carousel.bgColor, 0.78);
        overlayFade = hexToRgba(carousel.bgColor, 0);
      } else {
        overlay = fmt.bgBlurOverlay || 'rgba(245,245,245,0.70)';
        const m = overlay.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        overlayFade = m ? `rgba(${m[1]},${m[2]},${m[3]},0)` : 'transparent';
      }
      if (!bg) {
        return `<div style="position:absolute;inset:0;background:${(carousel && carousel.bgColor) || fmt.bgColor || '#f4f4f4'};"></div>`;
      }
      const url = filesAsUrl ? filesAsUrl(bg) : bg;
      const zoom = (slide && slide.bgZoom) || 1;
      const px2  = (slide && slide.bgX)   || 0;
      const py2  = (slide && slide.bgY)   || 0;
      const transform2 = (zoom !== 1 || px2 || py2)
        ? `transform:scale(${zoom}) translate(${px2}%,${py2}%);transform-origin:center center;` : '';
      return (
        `<div style="position:absolute;inset:0;background:url('${url}') center/cover no-repeat;${transform2}"></div>` +
        `<div style="position:absolute;top:0;left:0;right:0;height:${blurPct + 22}%;overflow:hidden;">` +
          `<div style="position:absolute;top:-${exp}px;left:-${exp}px;right:-${exp}px;height:${innerH}px;background:url('${url}') center/cover no-repeat;${transform2}filter:blur(${blurAmt}px);"></div>` +
          `<div style="position:absolute;inset:0;background:linear-gradient(to bottom,${overlay},${overlay} 55%,${overlayFade} 100%);"></div>` +
        `</div>`
      );
    }
    if (bg && fmt.bgType !== 'solid') {
      const url = filesAsUrl ? filesAsUrl(bg) : bg;
      const zoom = (slide && slide.bgZoom) || 1;
      const px = (slide && slide.bgX) || 0;
      const py = (slide && slide.bgY) || 0;
      const transform = (zoom !== 1 || px || py)
        ? `transform:scale(${zoom}) translate(${px}%, ${py}%);transform-origin:center center;` : '';
      const overlay = fmt.bgOverlay || 'linear-gradient(to bottom,transparent 35%,rgba(0,0,0,0.18) 100%)';
      return `<div style="position:absolute;inset:0;overflow:hidden;">
                <div style="position:absolute;inset:0;background:url('${url}') center/cover no-repeat;${transform}"></div>
              </div>
              <div style="position:absolute;inset:0;background:${overlay};"></div>`;
    }
    // Custom template with solid/gradient background
    const slideBgOverride = slide && slide.fmt && slide.fmt.bgColor;
    // Alternating colors (e.g. tweet_erica: black/white per slide index)
    if (fmt.altColors && carousel && carousel.slides && !slideBgOverride) {
      const idx = carousel.slides.indexOf(slide);
      const alt = fmt.altColors[((idx >= 0 ? idx : 0)) % fmt.altColors.length];
      return `<div style="position:absolute;inset:0;background:${alt.bg};"></div>`;
    }
    if (fmt.bgType === 'solid' || slideBgOverride || fmt.bgColor) {
      return `<div style="position:absolute;inset:0;background:${slideBgOverride || fmt.bgColor || '#1a2040'};"></div>`;
    }
    if (fmt.bgGradient) return `<div style="position:absolute;inset:0;background:${fmt.bgGradient};"></div>`;
    return `<div style="position:absolute;inset:0;background:#1a2040;"></div>`;
  }

  // Inner content (boxes) — flex default OR absolute free-positioned.
  // offsetY (posição vertical) and gap (espaço) work in BOTH modes:
  //  - flex: native translateY + CSS gap
  //  - free: render-time translateY wrapper + per-element gap redistribution
  function buildInner(slide, carousel, U) {
    if (slide._freePos && slide._elements && slide._elements.length) {
      const style = carousel.style || 'medico';
      const base = FMT[style] || FMT.medico;
      const offY = (slide.fmt && slide.fmt.offsetY) || 0;

      // Cor alternada (tweet_erica) também vale para caixa arrastada.
      //
      // Este ramo devolve cedo, antes do trecho que injeta altColors mais
      // abaixo. O fundo alternava certo, porque bgLayer calcula por conta
      // própria, e o texto ficava na cor padrão do estilo — branca. Em slide
      // de fundo branco isso é texto invisível.
      //
      // Só trocamos a cor que o próprio sistema pôs. Toda cor que o estilo
      // usa (a padrão e as das alternâncias) conta como automática; qualquer
      // outra veio do seletor e é preservada.
      const altEl = (base.altColors && carousel.slides)
        ? base.altColors[Math.max(0, carousel.slides.indexOf(slide)) % base.altColors.length]
        : null;
      const automaticas = altEl
        ? new Set(
            [base.titleColor, base.subColor]
              .concat(base.altColors.flatMap((a) => [a.title, a.sub]))
              .filter(Boolean)
              .map((c) => String(c).toLowerCase()),
          )
        : null;
      const corAutomatica = (el) => {
        if (!altEl) return null;
        const atual = String(el.color || '').toLowerCase();
        if (atual && !automaticas.has(atual)) return null;   // escolha manual, respeita
        const desejada = el.bold ? altEl.title : altEl.sub;
        return atual === String(desejada).toLowerCase() ? null : desejada;
      };
      const gapAdj = (slide.fmt && slide.fmt.gap != null) ? (slide.fmt.gap - base.gap) : 0;

      // text elements sorted top→bottom get an increasing gap shift
      const textOrder = slide._elements.filter(e => e.type === 'text').slice().sort((a, b) => a.y - b.y);
      let ti = -1;
      const inner = slide._elements.map(el => {
        let e = el;
        let idx = null;
        if (el.type === 'text') {
          idx = ++ti;   // index among text elements (drag target)
          if (gapAdj) {
            const oi = textOrder.indexOf(el);
            if (oi > 0) e = Object.assign({}, el, { y: el.y + gapAdj * oi });
          }
        }
        if (el.type === 'text') {
          const cor = corAutomatica(el);
          if (cor) e = Object.assign({}, e, { color: cor });
        }
        return renderAbsEl(e, U, idx);
      }).join('\n');

      return offY
        ? `<div style="position:absolute;inset:0;transform:translateY(${U(offY)});">${inner}</div>`
        : inner;
    }
    const style = carousel.style || 'medico';
    // Tweet Érica: inject alternating text colors + bottom credit
    if (style === 'tweet_erica') {
      const fmt = FMT.tweet_erica;
      const idx = carousel.slides ? carousel.slides.indexOf(slide) : -1;
      const alt = (fmt.altColors && idx >= 0)
        ? fmt.altColors[idx % fmt.altColors.length]
        : { title: fmt.titleColor, sub: fmt.subColor };
      const modSlide = Object.assign({}, slide, {
        fmt: Object.assign({}, slide.fmt, { titleColor: alt.title, subColor: alt.sub }),
      });
      const content = buildFlexBoxes(modSlide, style, U);
      const credit = buildDoctorCreditBottom(carousel, alt.title, U);
      return content + credit;
    }
    const content = buildFlexBoxes(slide, style, U);
    if (style === 'tweet') {
      const credit = buildDoctorCredit(carousel, U);
      if (credit) {
        const insertAt = content.indexOf('>') + 1;
        return content.slice(0, insertAt) + credit + content.slice(insertAt);
      }
    }
    return content;
  }

  // Doctor credit at absolute bottom center (tweet_erica style)
  function buildDoctorCreditBottom(carousel, textColor, U) {
    const handle = (carousel.tweetHandle || carousel.doctorName || '').trim();
    // avatarUrl é a foto de perfil, escolhida à parte. carousel.photo NÃO
    // serve: ela é o fundo aplicado a todos os slides, então o crédito saía
    // com a mesma imagem da capa — e sumia quando não havia fundo nenhum.
    const photo = carousel.avatarUrl || '';
    if (!handle && !photo) return '';
    const color = textColor || '#ffffff';
    const avatarHtml = photo
      ? `<div style="width:${U(56)};height:${U(56)};border-radius:50%;overflow:hidden;flex-shrink:0;background:url('${photo}') center/cover no-repeat;border:${U(2)} solid ${color === '#ffffff' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.15)'};"></div>`
      : '';
    const verified = `<span style="display:inline-flex;align-items:center;justify-content:center;width:${U(26)};height:${U(26)};background:#3897f0;border-radius:50%;color:#fff;font-size:${U(14)};font-weight:700;flex-shrink:0;">✓</span>`;
    const nameHtml = handle
      ? `<span style="font-size:${U(30)};font-weight:600;color:${color};font-family:Inter,sans-serif;line-height:1.2;">${esc(handle)}</span>${verified}`
      : '';
    return `<div style="position:absolute;bottom:${U(80)};left:0;right:0;display:flex;align-items:center;justify-content:center;gap:${U(14)};">${avatarHtml}${nameHtml}</div>`;
  }

  // Doctor credit chip (avatar + name) for tweet inner slides — in-flow, above text boxes
  function buildDoctorCredit(carousel, U) {
    const name = (carousel.doctorName || '').trim();
    const photo = carousel.avatarUrl || '';
    if (!name && !photo) return '';
    const avatarHtml = photo
      ? `<div style="width:${U(64)};height:${U(64)};border-radius:50%;overflow:hidden;flex-shrink:0;background:url('${photo}') center/cover no-repeat;border:${U(2)} solid rgba(255,255,255,0.3);"></div>`
      : '';
    const nameHtml = name
      ? `<span style="font-size:${U(34)};font-weight:700;color:#ffffff;font-family:Inter,sans-serif;line-height:1.2;">${esc(name)}</span>`
      : '';
    return `<div style="display:flex;align-items:center;gap:${U(18)};width:100%;">${avatarHtml}${nameHtml}</div>`;
  }

  const SharedRender = {
    SLIDE_W, SLIDE_H, FMT, getFmt, esc, hexToRgba, fit, sanitizeCopy,
    deriveBlocks, normalizeBlocks, oneBox, buildFlexBoxes, renderAbsEl, bgLayer, buildInner, buildDoctorCredit, buildDoctorCreditBottom,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SharedRender;
  else global.SharedRender = SharedRender;

})(typeof window !== 'undefined' ? window : globalThis);
