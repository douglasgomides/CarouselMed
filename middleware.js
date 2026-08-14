/**
 * middleware.js — porteiro do app inteiro.
 *
 * Roda na borda da Vercel, ANTES do arquivo estático: protege também o
 * index.html e o app.js, que são servidos pela Vercel e não passam pelo
 * Express. Sem isso, só as rotas /api ficariam protegidas.
 *
 * Quem valida usuário e senha é POST /api/login (no Express), que devolve um
 * cookie assinado. Aqui só conferimos a assinatura desse cookie.
 */
export const config = {
  matcher: '/((?!_vercel/).*)',
};

const NOME = 'cm_sessao';

// as únicas rotas abertas: a tela de login e o que ela precisa chamar
const LIVRES = new Set(['/login', '/login.html', '/api/login', '/api/logout', '/favicon.ico']);

async function assinar(exp, usuario, senha) {
  const cod = new TextEncoder();
  const chave = await crypto.subtle.importKey(
    'raw', cod.encode(senha), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', chave, cod.encode(`${exp}|${usuario}`));
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

async function sessaoValida(request, usuario, senha) {
  const bruto = lerCookie(request.headers.get('cookie'), NOME);
  if (!bruto) return false;
  const p = bruto.split('.');
  if (p.length !== 3) return false;
  const [exp, quem, sig] = p;
  if (quem !== usuario) return false;              // senha/usuário trocados → sessão morre
  if (!Number(exp) || Number(exp) < Date.now()) return false;
  return igual(sig, await assinar(exp, quem, senha));
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const caminho = url.pathname;

  const usuario = process.env.PANEL_USER;
  const senha = process.env.PANEL_PASSWORD;

  // Sem credenciais configuradas o app fecha, em vez de ficar aberto por engano.
  if (!usuario || !senha) {
    return new Response(
      'CarouselMed trancado: defina PANEL_USER e PANEL_PASSWORD nas variáveis de ambiente.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  if (LIVRES.has(caminho)) return;
  if (await sessaoValida(request, usuario, senha)) return;

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
