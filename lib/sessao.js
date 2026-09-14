/**
 * sessao.js — cookie de sessão assinado (lado Node/Express).
 *
 * O mesmo cálculo é refeito no middleware.js, que roda na borda com Web Crypto.
 * As duas cópias precisam andar juntas: mexeu aqui, mexa lá.
 *
 * Contas vêm do Supabase (tabela carouselmed_usuarios), com a senha guardada
 * como scrypt — nunca em texto. Criar conta e trocar senha passam a ser
 * operação de banco, sem redeploy e sem acesso ao painel da Vercel.
 *
 * PANEL_USERS continua funcionando como reserva, para não quebrar quem já
 * está no ar antes da migração e para desenvolvimento local:
 *   PANEL_USERS="marcelly:senha-dela,equipe:senha-do-time"
 *
 * Quem assina o cookie é SESSION_SECRET. Sem ela caímos no comportamento
 * antigo — a própria lista de credenciais vira a chave —, e aí trocar
 * qualquer senha derruba todas as sessões abertas de todo mundo.
 */
const crypto = require('crypto');

const NOME = 'cm_sessao';
const DIAS = 30;

/** Lê as contas do ambiente. Aceita o formato antigo de um usuário só. */
function lerUsuariosDoAmbiente() {
  const lista = [];
  for (const par of String(process.env.PANEL_USERS || '').split(',')) {
    const t = par.trim();
    if (!t) continue;
    const corte = t.indexOf(':');
    if (corte < 1) continue;              // sem usuário ou sem separador: ignora
    const usuario = t.slice(0, corte).trim();
    const senha = t.slice(corte + 1);     // senha pode conter ':'
    if (usuario && senha) lista.push({ usuario, senha });
  }
  if (!lista.length && process.env.PANEL_USER && process.env.PANEL_PASSWORD) {
    lista.push({ usuario: process.env.PANEL_USER, senha: process.env.PANEL_PASSWORD });
  }
  return lista;
}

// ── Senhas com scrypt ────────────────────────────────────────────────
// scrypt é do próprio Node: sem dependência nova, e o custo em CPU é o que
// torna caro testar senha por força bruta. Formato guardado no banco:
//   scrypt$<salt em hex>$<hash em hex>
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_BYTES = 32;

function criarHash(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(senha), salt, SCRYPT_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function conferirHash(senha, guardado) {
  try {
    const [algo, saltHex, hashHex] = String(guardado || '').split('$');
    if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
    const esperado = Buffer.from(hashHex, 'hex');
    const obtido = crypto.scryptSync(String(senha), Buffer.from(saltHex, 'hex'),
                                     esperado.length, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return crypto.timingSafeEqual(esperado, obtido);
  } catch { return false; }
}

// ── Contas no Supabase ───────────────────────────────────────────────
// Só o POST /api/login chega aqui. O middleware da borda continua apenas
// conferindo a assinatura do cookie, sem ida ao banco — é o que mantém
// arquivo estático rápido.
function clienteAdmin() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Confere usuário e senha. Tenta o Supabase primeiro; se a tabela não
 * responder (sem credencial, rede fora, projeto novo), cai no PANEL_USERS.
 * A reserva existe para que uma falha de banco não tranque todo mundo fora.
 */
async function autenticar(usuario, senha) {
  const nome = String(usuario ?? '').trim();
  if (!nome || !senha) return null;

  const sb = clienteAdmin();
  if (sb) {
    try {
      const { data, error } = await sb
        .from('carouselmed_usuarios')
        .select('usuario, senha_hash, ativo')
        .eq('usuario', nome)
        .maybeSingle();
      if (!error && data) {
        if (!data.ativo) return null;
        if (!conferirHash(senha, data.senha_hash)) return null;
        sb.from('carouselmed_usuarios')
          .update({ ultimo_login: new Date().toISOString() })
          .eq('usuario', nome)
          .then(() => {}, () => {});   // registrar acesso nunca derruba o login
        return { usuario: data.usuario };
      }
      if (error) console.error('login: Supabase indisponível, usando PANEL_USERS —', error.message);
    } catch (e) {
      console.error('login: Supabase falhou, usando PANEL_USERS —', e.message);
    }
  }

  const conta = lerUsuariosDoAmbiente().find(
    (c) => igual(nome, c.usuario) && igual(String(senha), c.senha)
  );
  return conta ? { usuario: conta.usuario } : null;
}

/**
 * Contas conhecidas. Mantido para segredo() no modo antigo — quando
 * SESSION_SECRET não está definido, a chave do HMAC sai daqui.
 */
function lerUsuarios() {
  return lerUsuariosDoAmbiente();
}

/**
 * Chave do HMAC.
 *
 * Com SESSION_SECRET definida, é ela — e aí trocar senha ou criar conta não
 * derruba sessão de ninguém.
 *
 * Sem ela, cai no modo antigo: a própria lista do PANEL_USERS vira a chave.
 * Isso é incompatível com conta que só existe no Supabase — a chave sairia
 * de uma lista que não contém esse usuário, e o cookie assinado no login
 * não seria aceito pelo middleware depois. Por isso exigimos a variável
 * assim que o ambiente é capaz de falar com o banco.
 */
function segredo(contas) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const doAmbiente = contas || lerUsuariosDoAmbiente();
  if (!doAmbiente.length) {
    throw new Error(
      'SESSION_SECRET não configurada. Ela é obrigatória quando as contas vêm do Supabase — ' +
      'sem ela o cookie é assinado com uma chave que o middleware não consegue reproduzir.'
    );
  }
  return doAmbiente.map((c) => `${c.usuario}:${c.senha}`).join('|');
}

function assinar(exp, usuario, chave) {
  return crypto.createHmac('sha256', chave).update(`${exp}|${usuario}`).digest('hex');
}

// comparação de tempo constante, para não vazar a senha caractere a caractere
function igual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function criarCookie(usuario, chave) {
  const exp = Date.now() + DIAS * 24 * 3600 * 1000;
  const valor = `${exp}.${usuario}.${assinar(exp, usuario, chave)}`;
  const maxAge = DIAS * 24 * 3600;
  return `${NOME}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

function cookieDeSaida() {
  return `${NOME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

module.exports = {
  NOME, DIAS, lerUsuarios, lerUsuariosDoAmbiente, autenticar,
  criarHash, conferirHash, segredo, assinar, igual, criarCookie, cookieDeSaida,
};
