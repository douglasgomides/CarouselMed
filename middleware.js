/**
 * middleware.js — porteiro do app inteiro.
 *
 * Roda na borda da Vercel, ANTES do arquivo estático: protege também o
 * index.html e o app.js, que são servidos pela Vercel e não passam pelo
 * Express. Sem isso, só as rotas /api ficariam protegidas.
 *
 * Quem valida usuário e senha é POST /api/login (no Express), que devolve um
 * cookie assinado. Aqui só conferimos a assinatura desse cookie.
 *
 * A leitura das contas e o cálculo da assinatura são cópia do lib/sessao.js —
 * a borda roda ESM com Web Crypto e não consegue exigir o módulo CommonJS.
 * Mexeu em um, mexa no outro.
 */
export const config = {
  matcher: '/((?!_vercel/).*)',
};

const NOME = 'cm_sessao';

// as únicas rotas abertas: a tela de login e o que ela precisa chamar
const LIVRES = new Set(['/login', '/login.html', '/api/login', '/api/logout', '/favicon.ico']);

/** PANEL_USERS="usuario:senha,outro:senha" — aceita o formato antigo também. */
function lerUsuarios() {
  const lista = [];
  for (const par of String(process.env.PANEL_USERS || '').split(',')) {
    const t = par.trim();
    if (!t) continue;
    const corte = t.indexOf(':');
    if (corte < 1) continue;
    const usuario = t.slice(0, corte).trim();
    const senha = t.slice(corte + 1);
    if (usuario && senha) lista.push({ usuario, senha });
  }
  if (!lista.length && process.env.PANEL_USER && process.env.PANEL_PASSWORD) {
    lista.push({ usuario: process.env.PANEL_USER, senha: process.env.PANEL_PASSWORD });
  }
  return lista;
}

function segredo(contas) {
  return process.env.SESSION_SECRET || contas.map((c) => `${c.usuario}:${c.senha}`).join('|');
}

async function assinar(exp, usuario, chave) {
  const cod = new TextEncoder();
  const k = await crypto.subtle.importKey(
    'raw', cod.encode(chave), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, cod.encode(`${exp}|${usuario}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function igual(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function lerCookie(cabecalho, nome) {
  for (const parte of (cabecalho || '').split(';')) {
    const [k, ...resto] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(resto.join('='));
  }
  return null;
}

async function sessaoValida(request, contas) {
  const bruto = lerCookie(request.headers.get('cookie'), NOME);
  if (!bruto) return false;
  const p = bruto.split('.');
  if (p.length !== 3) return false;
  const [exp, quem, sig] = p;
  // conta apagada do PANEL_USERS perde o acesso na hora
  if (!contas.some((c) => c.usuario === quem)) return false;
  if (!Number(exp) || Number(exp) < Date.now()) return false;
  return igual(sig, await assinar(exp, quem, segredo(contas)));
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const caminho = url.pathname;

  const contas = lerUsuarios();

  // Sem credenciais configuradas o app fecha, em vez de ficar aberto por engano.
  if (!contas.length) {
    return new Response(
      'CarouselMed trancado: defina PANEL_USERS ("usuario:senha,outro:senha") nas variáveis de ambiente.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  if (LIVRES.has(caminho)) return;
  if (await sessaoValida(request, contas)) return;

  // Chamada de API sem sessão: responde JSON, senão o front recebe HTML de login
  if (caminho.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Sessão expirada. Entre de novo.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const destino = new URL('/login', url);
  if (caminho !== '/') destino.searchParams.set('next', caminho + url.search);
  return Response.redirect(destino, 302);
}
