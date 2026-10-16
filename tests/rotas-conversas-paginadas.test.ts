import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { codificarCursorDeConversas } from '../src/nucleo/cursor-de-conversas.js';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

// #1202: GET /conversas pagina por cursor. Sem cursor e sem `limite`, a primeira pagina (500); `proximo` so existe
// quando HA mais; o cursor invalido, ou de outra ordem, e 400 e nunca a primeira pagina.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (corpo: string): any => JSON.parse(corpo);

test('uma lista que cabe na pagina vem inteira e SEM proximo; os campos de cada Conversa nao mudam', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const r = await cena.pedir('/conversas', cena.chave.valor);
    assert.equal(r.status, 200);
    const corpo = j(r.corpo);
    assert.equal(corpo.conversas.length, 4);
    assert.equal('proximo' in corpo, false);
    assert.deepEqual(Object.keys(corpo), ['conversas']);
    const campos = new Set(corpo.conversas.flatMap((c: object) => Object.keys(c)));
    assert.deepEqual([...campos].sort(), ['assunto', 'coletiva', 'configuracao', 'fonte', 'id', 'mensagens', 'nome', 'origemDoNome']);
  } finally {
    cena.encerrar();
  }
});

test('limite=2: duas Conversas e um proximo; antes=proximo traz as outras duas; juntas, as quatro sem repetir', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const todas = j((await cena.pedir('/conversas', cena.chave.valor)).corpo).conversas.map((c: { id: string }) => c.id);
    const p1 = j((await cena.pedir('/conversas?limite=2', cena.chave.valor)).corpo);
    assert.equal(p1.conversas.length, 2);
    assert.equal(typeof p1.proximo, 'string');
    const p2 = j((await cena.pedir(`/conversas?limite=2&antes=${encodeURIComponent(p1.proximo)}`, cena.chave.valor)).corpo);
    assert.equal(p2.conversas.length, 2);
    assert.equal('proximo' in p2, false, 'a ultima pagina nao tem proximo');
    assert.deepEqual([...p1.conversas, ...p2.conversas].map((c: { id: string }) => c.id), todas);
  } finally {
    cena.encerrar();
  }
});

test('sem limite, a pagina e de 500: 502 Conversas viram 500 e um proximo, e o proximo traz as 2 restantes', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo) => {
      for (let n = 0; n < 498; n += 1) {
        registrarConversa(acervo, { fonte: 'whatsapp', idExterno: `55659${String(n).padStart(8, '0')}@s.whatsapp.net`, coletiva: false, configuracao: CFG_WHATSAPP });
      }
    },
  });
  try {
    const p1 = j((await cena.pedir('/conversas', cena.chave.valor)).corpo);
    assert.equal(p1.conversas.length, 500);
    assert.equal(typeof p1.proximo, 'string');
    const p2 = j((await cena.pedir(`/conversas?antes=${encodeURIComponent(p1.proximo)}`, cena.chave.valor)).corpo);
    assert.equal(p2.conversas.length, 2);
    assert.equal('proximo' in p2, false);
  } finally {
    cena.encerrar();
  }
});

test('cursor invalido, de outra ordem ou vazio e 400, nunca a primeira pagina', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const porCriacao = j((await cena.pedir('/conversas?limite=1', cena.chave.valor)).corpo).proximo as string;
    const porAtividade = codificarCursorDeConversas({ ordem: 'atividade', valor: 1, id: 'x' });
    assert.equal((await cena.pedir('/conversas?antes=lixo', cena.chave.valor)).status, 400);
    assert.equal((await cena.pedir('/conversas?antes=', cena.chave.valor)).status, 400);
    assert.equal((await cena.pedir(`/conversas?desde=2026-01-01&antes=${encodeURIComponent(porCriacao)}`, cena.chave.valor)).status, 400);
    assert.equal((await cena.pedir(`/conversas?antes=${encodeURIComponent(porAtividade)}`, cena.chave.valor)).status, 400);
    assert.equal((await cena.pedir('/conversas?limite=0', cena.chave.valor)).status, 400);
  } finally {
    cena.encerrar();
  }
});

test('com desde a ordem e por atividade, e pagina pelo seu proprio cursor', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const todas = j((await cena.pedir('/conversas?desde=2026-01-01', cena.chave.valor)).corpo).conversas.map((c: { id: string }) => c.id);
    assert.ok(todas.length >= 3);
    const vistos: string[] = [];
    let antes = '';
    for (let i = 0; i < 10; i += 1) {
      const caminho = `/conversas?desde=2026-01-01&limite=1${antes === '' ? '' : `&antes=${encodeURIComponent(antes)}`}`;
      const p = j((await cena.pedir(caminho, cena.chave.valor)).corpo);
      vistos.push(...p.conversas.map((c: { id: string }) => c.id));
      if (p.proximo === undefined) break;
      antes = p.proximo;
    }
    assert.deepEqual(vistos, todas);
  } finally {
    cena.encerrar();
  }
});
