#!/usr/bin/env node
/**
 * Gerencia as contas do painel, na tabela carouselmed_usuarios do Supabase.
 *
 * A senha nunca trafega nem é guardada em texto: o hash scrypt é calculado
 * aqui e só ele vai para o banco.
 *
 *   node scripts/conta.js listar
 *   node scripts/conta.js criar equipe "senha-boa-aqui"
 *   node scripts/conta.js senha equipe "senha-nova"
 *   node scripts/conta.js desativar equipe
 *   node scripts/conta.js ativar equipe
 *
 * Precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (as mesmas
 * que o app já usa para o Storage). Rode com elas carregadas:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/conta.js listar
 */
const { criarHash } = require('../lib/sessao');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const TABELA = 'carouselmed_usuarios';

// Senha curta é o elo fraco de todo o esquema: o cookie dura 30 dias e o
// painel fica numa URL pública. Melhor recusar aqui do que descobrir depois.
const MINIMO = 10;

async function listar() {
  const { data, error } = await sb.from(TABELA)
    .select('usuario, ativo, criado_em, ultimo_login').order('usuario');
  if (error) throw new Error(error.message);
  if (!data.length) return console.log('(nenhuma conta cadastrada)');
  for (const c of data) {
    const quando = c.ultimo_login ? new Date(c.ultimo_login).toLocaleString('pt-BR') : 'nunca entrou';
    console.log(`  ${c.ativo ? '✓' : '✗'} ${c.usuario.padEnd(18)} último acesso: ${quando}`);
  }
}

async function criar(usuario, senha) {
  if (!usuario || !senha) throw new Error('uso: criar <usuario> <senha>');
  if (senha.length < MINIMO) throw new Error(`senha muito curta — mínimo ${MINIMO} caracteres`);
  const { error } = await sb.from(TABELA)
    .insert({ usuario, senha_hash: criarHash(senha) });
  if (error) throw new Error(error.message);
  console.log(`conta "${usuario}" criada`);
}

async function trocarSenha(usuario, senha) {
  if (!usuario || !senha) throw new Error('uso: senha <usuario> <senha-nova>');
  if (senha.length < MINIMO) throw new Error(`senha muito curta — mínimo ${MINIMO} caracteres`);
  const { data, error } = await sb.from(TABELA)
    .update({ senha_hash: criarHash(senha) }).eq('usuario', usuario).select('usuario');
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error(`conta "${usuario}" não existe`);
  console.log(`senha de "${usuario}" trocada`);
  console.log('As sessões abertas continuam valendo — quem assina o cookie é SESSION_SECRET.');
}

async function marcar(usuario, ativo) {
  const { data, error } = await sb.from(TABELA)
    .update({ ativo }).eq('usuario', usuario).select('usuario');
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error(`conta "${usuario}" não existe`);
  console.log(`"${usuario}" ${ativo ? 'ativada' : 'desativada'}`);
  if (!ativo) {
    console.log('Atenção: quem já está logado continua até o cookie vencer (30 dias).');
    console.log('Para cortar o acesso agora, troque SESSION_SECRET — isso desloga todo mundo.');
  }
}

const [cmd, a, b] = process.argv.slice(2);
const acoes = {
  listar,
  criar: () => criar(a, b),
  senha: () => trocarSenha(a, b),
  ativar: () => marcar(a, true),
  desativar: () => marcar(a, false),
};

if (!acoes[cmd]) {
  console.log('comandos: listar | criar <u> <s> | senha <u> <s> | ativar <u> | desativar <u>');
  process.exit(1);
}
acoes[cmd]().catch((e) => { console.error('erro:', e.message); process.exit(1); });
