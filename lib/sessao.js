/**
 * sessao.js — cookie de sessão assinado (lado Node/Express).
 *
 * O mesmo cálculo é refeito no middleware.js, que roda na borda com Web Crypto.
 * A chave da assinatura é a própria PANEL_PASSWORD: trocar a senha derruba
 * todas as sessões abertas, sem precisar de outra variável.
 */
const crypto = require('crypto');

const NOME = 'cm_sessao';
const DIAS = 30;

function assinar(exp, usuario, senha) {
  return crypto.createHmac('sha256', senha).update(`${exp}|${usuario}`).digest('hex');
}

// comparação de tempo constante, para não vazar a senha caractere a caractere
function igual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function criarCookie(usuario, senha) {
  const exp = Date.now() + DIAS * 24 * 3600 * 1000;
  const valor = `${exp}.${usuario}.${assinar(exp, usuario, senha)}`;
  const maxAge = DIAS * 24 * 3600;
  return `${NOME}=${encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

function cookieDeSaida() {
  return `${NOME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

module.exports = { NOME, DIAS, assinar, igual, criarCookie, cookieDeSaida };
