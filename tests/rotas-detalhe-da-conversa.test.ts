import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarConversa, registrarMetadadosDeColetiva } from '../src/nucleo/escrita.js';
import { join } from 'node:path';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';

// #1203: GET /conversas/<id>/detalhe. O Inquilino vem da Chave; id inexistente e id de OUTRO Inquilino respondem a
// MESMA coisa (404 de corpo vazio), para a resposta nao dizer que o id existe em outro lugar.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (corpo: string): any => JSON.parse(corpo);

test('GET /conversas/<id>/detalhe devolve a coletiva com os Metadados de Coletiva por inteiro', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo, s) => {
      registrarMetadadosDeColetiva(acervo, s.grupo, {
        descricao: 'Avisos da familia',
        alteradoPor: 'AUTOR@lid',
        alteradoEm: '2026-06-01T12:30:00.000Z',
      });
    },
  });
  try {
    const r = await cena.pedir(`/conversas/${cena.s.grupo}/detalhe`, cena.chave.valor);
    assert.equal(r.status, 200);
    const d = j(r.corpo);
    assert.equal(d.id, cena.s.grupo);
    assert.equal(d.coletiva, true);
    assert.equal(d.mensagens, 5);
    assert.deepEqual(d.metadados, {
      assunto: 'Grupo da Familia',
      descricao: 'Avisos da familia',
      alteradoPor: 'AUTOR@lid',
      alteradoEm: '2026-06-01T12:30:00.000Z',
    });
  } finally {
    cena.encerrar();
  }
});

test('GET /conversas/<id>/detalhe da direta traz o nome pela precedencia do Inquilino e nenhum campo de grupo', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const r = await cena.pedir(`/conversas/${cena.s.diretaDeBruno}/detalhe`, cena.chave.valor);
    assert.equal(r.status, 200);
    const d = j(r.corpo);
    assert.equal(d.nome, 'Bruno Contato');
    assert.equal(d.origemDoNome, 'contatos');
    assert.equal('metadados' in d, false);
  } finally {
    cena.encerrar();
  }
});

test('id inexistente, id de OUTRO Inquilino e Conversa de outro Inquilino respondem 404 identico e vazio', async () => {
  let idDoOutro = '';
  const cena = await subirCenaDeIdentidade({
    semearNoOutro: (acervo) => {
      idDoOutro = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'grupo-do-outro@g.us', coletiva: true, bruto: '{}' });
    },
  });
  try {
    const nenhum = await cena.pedir('/conversas/nao-existe/detalhe', cena.chave.valor);
    const alheio = await cena.pedir(`/conversas/${idDoOutro}/detalhe`, cena.chave.valor);
    assert.equal(nenhum.status, 404);
    assert.equal(alheio.status, 404);
    assert.equal(alheio.corpo, nenhum.corpo, 'a resposta nao pode distinguir o id que existe em outro Inquilino');
    // E o dono do id o ve.
    assert.equal((await cena.pedir(`/conversas/${idDoOutro}/detalhe`, cena.chaveDoOutro.valor)).status, 200);
  } finally {
    cena.encerrar();
  }
});

test('sem credencial e 401, e ?inquilino= nao muda o alcance', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    assert.equal((await cena.pedir(`/conversas/${cena.s.grupo}/detalhe`)).status, 401);
    const tentativa = await cena.pedir(`/conversas/${cena.s.grupo}/detalhe?inquilino=${cena.inquilinoId}`, cena.chaveDoOutro.valor);
    assert.equal(tentativa.status, 404);
  } finally {
    cena.encerrar();
  }
});

test('a listagem /conversas NAO mudou: nenhum campo novo, e a descricao fica fora dela', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo, s) => {
      registrarMetadadosDeColetiva(acervo, s.grupo, { descricao: 'Avisos da familia' });
    },
  });
  try {
    const r = await cena.pedir('/conversas', cena.chave.valor);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.corpo, /Avisos da familia/);
    const campos = new Set(j(r.corpo).conversas.flatMap((c: object) => Object.keys(c)));
    assert.deepEqual([...campos].sort(), ['assunto', 'coletiva', 'configuracao', 'fonte', 'id', 'mensagens', 'nome', 'origemDoNome']);
  } finally {
    cena.encerrar();
  }
});

test('a direta com Configuracao do Registro traz o APELIDO dela, como a listagem, e nunca o id interno', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const registro = abrirRegistro(cena.raiz);
    const cfg = resolverConfiguracao(registro, cena.inquilinoId, 'whatsapp', 'conta-principal');
    registro.fechar();
    const acervo = abrirAcervo(join(cena.raiz, 'acervos'), cena.inquilinoId);
    const direta = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '5565999999999@s.whatsapp.net', coletiva: false, configuracao: { id: cfg.id, fonte: 'whatsapp' }, bruto: '{}' });
    acervo.fechar();
    const r = await cena.pedir(`/conversas/${direta}/detalhe`, cena.chave.valor);
    assert.equal(j(r.corpo).configuracao, 'conta-principal');
    assert.doesNotMatch(r.corpo, new RegExp(cfg.id), 'o id interno da Configuracao nao sai');
  } finally {
    cena.encerrar();
  }
});
