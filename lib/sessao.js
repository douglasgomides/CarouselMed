/**
 * sessao.js — cookie de sessão assinado (lado Node/Express).
 *
 * O mesmo cálculo é refeito no middleware.js, que roda na borda com Web Crypto.
 * As duas cópias precisam andar juntas: mexeu aqui, mexa lá.
 *
 * Contas ficam em PANEL_USERS, uma lista "usuario:senha" separada por vírgula:
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
function lerUsuarios() {
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

/** Chave do HMAC. Ver o comentário do topo sobre o fallback. */
function segredo(contas) {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return (contas || lerUsuarios()).map((c) => `${c.usuario}:${c.senha}`).join('|');
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

module.exports = { NOME, DIAS, lerUsuarios, segredo, assinar, igual, criarCookie, cookieDeSaida };
