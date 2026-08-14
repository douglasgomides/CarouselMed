/**
 * middleware.js — trava o app inteiro atrás de usuário e senha.
 *
 * Roda na borda da Vercel, ANTES de qualquer coisa: protege também os arquivos
 * estáticos (index.html, app.js), que são servidos pela Vercel e não passam
 * pelo Express. Sem isso, só as rotas /api ficariam protegidas.
 *
 * Credenciais em PANEL_USER e PANEL_PASSWORD (variáveis de ambiente).
 */
export const config = {
  // tudo, menos os internos da própria Vercel
  matcher: '/((?!_vercel/).*)',
};

function naoAutorizado(mensagem) {
  return new Response(mensagem, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="CarouselMed", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

// Comparação de tempo constante: não entrega a senha caractere a caractere.
function igual(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export default function middleware(request) {
  const user = process.env.PANEL_USER;
  const pass = process.env.PANEL_PASSWORD;

  // Sem credenciais configuradas o app fecha, em vez de ficar aberto por engano.
  if (!user || !pass) {
    return new Response(
      'CarouselMed trancado: defina PANEL_USER e PANEL_PASSWORD nas variáveis de ambiente.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return naoAutorizado('Acesso restrito.');

  let recebido;
  try {
    recebido = atob(header.slice(6));
  } catch {
    return naoAutorizado('Credenciais inválidas.');
  }

  const sep = recebido.indexOf(':');
  const u = sep < 0 ? recebido : recebido.slice(0, sep);
  const p = sep < 0 ? '' : recebido.slice(sep + 1);

  if (!igual(u, user) || !igual(p, pass)) return naoAutorizado('Usuário ou senha incorretos.');
}
