/**
 * font-scanner.js — lê fontes do Windows com a API nova do opentype.js
 */
const fs   = require('fs');
const path = require('path');

let opentype = null;
try { opentype = require('opentype.js'); } catch { /* sem opentype, usa fallback */ }

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local');

// Bundled project fonts (work on any server) + local Windows fonts (dev only).
// Non-existent dirs are skipped gracefully, so this works on Linux servers too.
const FONT_DIRS = [
  path.join(__dirname, 'fonts'),                                 // bundled — works everywhere
  path.join(LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'),     // Windows user fonts
  'C:\\Windows\\Fonts',                                          // Windows system fonts
  '/usr/share/fonts',                                           // Linux server fonts
  '/usr/local/share/fonts',
];

const SUPPORTED = new Set(['.ttf', '.otf']);

const WEIGHT_MAP = {
  thin:100, hairline:100, extralight:200, ultralight:200,
  light:300, regular:400, normal:400, roman:400,
  medium:500, semibold:600, demibold:600, bold:700,
  extrabold:800, ultrabold:800, heavy:800,
  black:900, ultra:900,
};

function parseFont(fullPath) {
  const buffer = fs.readFileSync(fullPath);
  const font = opentype.parse(buffer.buffer || buffer);
  const get = k => {
    const n = font.names[k];
    if (!n) return '';
    return n.en || n['en-US'] || Object.values(n)[0] || '';
  };
  const family = (get('preferredFamily') || get('fontFamily') || '').trim();
  const style  = (get('preferredSubfamily') || get('fontSubfamily') || 'Regular').trim();
  return { family, style };
}

function styleToCSS(style) {
  const low = style.toLowerCase().replace(/[\s\-]/g, '');
  const italic = low.includes('italic') || low.includes('oblique');
  const key = Object.keys(WEIGHT_MAP).find(k => low.includes(k)) || 'regular';
  return { weight: WEIGHT_MAP[key], italic };
}

async function scanFonts() {
  const results = [];
  const seen = new Set();

  for (const dir of FONT_DIRS) {
    if (!fs.existsSync(dir)) continue;
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!SUPPORTED.has(ext)) continue;
      const fullPath = path.join(dir, file);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);

      let family = '';
      let style  = 'Regular';

      // Try opentype.js first
      if (opentype) {
        try {
          const parsed = parseFont(fullPath);
          family = parsed.family;
          style  = parsed.style;
        } catch { /* fallback below */ }
      }

      // Filename fallback: "Poppins-Bold.ttf" → family=Poppins, style=Bold
      if (!family) {
        const base   = path.basename(file, ext);
        const parts  = base.split(/[-_]/);
        family = parts[0].replace(/([a-z])([A-Z])/g, '$1 $2'); // SFUIText → SF UI Text
        style  = parts.slice(1).join(' ') || 'Regular';
      }

      const { weight, italic } = styleToCSS(style);
      const encodedDir = encodeURIComponent(dir);

      results.push({
        family,
        style,
        weight,
        italic,
        file,
        fullPath,
        url: `/api/font-file/${encodeURIComponent(file)}?dir=${encodedDir}`,
      });
    }
  }

  return results;
}

function groupByFamily(fonts) {
  const map = {};
  for (const f of fonts) {
    if (!map[f.family]) map[f.family] = { family: f.family, variants: [] };
    map[f.family].variants.push(f);
  }
  for (const key of Object.keys(map)) {
    map[key].variants.sort((a, b) => a.weight - b.weight || a.italic - b.italic);
  }
  return Object.values(map).sort((a, b) => a.family.localeCompare(b.family));
}

module.exports = { scanFonts, groupByFamily, FONT_DIRS };
