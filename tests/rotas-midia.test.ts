import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subirCenaDeIdentidade, BRUNO, BRUNO_LID } from './ajuda/identidade.js';
import { semearMidia, subirCenaDeMidia } from './ajuda/midia.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (corpo: string): any => JSON.parse(corpo);

test('GET /conversas/<id>/anexos lista os Anexos do grupo, com presenca e a Mensagem de origem (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const r = await cena.pedir(`/conversas/${cena.s.grupo}/anexos`, cena.chave.valor);
    assert.equal(r.status, 200);
    const corpo = j(r.corpo);
    assert.equal(corpo.anexos.length, 5);
    assert.equal(corpo.proximo, undefined, 'sem limite nao ha pagina');
    const doc = corpo.anexos.find((a: { id: string }) => a.id === cena.extra.documentoDeBruno);
    assert.deepEqual(
      [doc.tipo, doc.presenca, doc.nomeOriginal, doc.autorId],
      ['document', 'nunca-obtido', 'contrato.pdf', cena.s.bruno],
    );
    assert.ok(doc.mensagemId && doc.ocorridaEm);
    assert.ok(!corpo.anexos.some((a: { id: string }) => a.id === cena.extra.imagemNaDireta));
  } finally {
    cena.encerrar();
  }
});

test('filtros por query: tipo exato, presenca, periodo, remetente por valor alternativo (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const ids = async (qs: string): Promise<string[]> =>
      j((await cena.pedir(`/conversas/${cena.s.grupo}/anexos?${qs}`, cena.chave.valor)).corpo).anexos
        .map((a: { id: string }) => a.id)
        .sort();
    assert.deepEqual(await ids('tipo=image'), [cena.extra.imagemDeBruno, cena.extra.imagemSoltaDeBruno].sort());
    assert.deepEqual(await ids('tipo=imagem'), [], 'a rota e exata; o apelido e da CLI');
    assert.deepEqual(await ids('presenca=presente'), [cena.extra.imagemDeBruno, cena.extra.audioDeAna].sort());
    assert.equal((await ids(`remetente=${encodeURIComponent(BRUNO_LID)}`)).length, 3, 'o LID alcanca o canonico');
    assert.deepEqual(await ids('remetente=000%40lid'), [], 'valor desconhecido: vazio, nao erro');
    assert.equal((await ids('ate=2026-06-01')).length, 5, 'ate e o fim do dia');
    assert.equal((await ids('desde=2026-06-02')).length, 0);
  } finally {
    cena.encerrar();
  }
});

test('paginacao por cursor composto: as paginas, juntas, sao a lista inteira (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const inteira = j((await cena.pedir(`/conversas/${cena.s.grupo}/anexos`, cena.chave.valor)).corpo).anexos.map(
      (a: { id: string }) => a.id,
    );
    const vistos: string[] = [];
    let antes = '';
    for (let i = 0; i < 10; i += 1) {
      const r = j((await cena.pedir(`/conversas/${cena.s.grupo}/anexos?limite=2${antes}`, cena.chave.valor)).corpo);
      vistos.push(...r.anexos.map((a: { id: string }) => a.id));
      if (r.proximo === undefined) break;
      antes = `&antes=${encodeURIComponent(r.proximo)}`;
    }
    assert.deepEqual(vistos, inteira);
  } finally {
    cena.encerrar();
  }
});

test('404 so para Conversa inexistente ou de outro Inquilino, igual nos dois casos; filtro sem achado e 200 (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const inexistente = await cena.pedir('/conversas/nao-existe/anexos', cena.chave.valor);
    const deOutro = await cena.pedir(`/conversas/${cena.s.grupo}/anexos`, cena.chaveDoOutro.valor);
    assert.equal(inexistente.status, 404);
    assert.equal(deOutro.status, 404);
    assert.equal(inexistente.corpo, deOutro.corpo, 'indistinguiveis');
    const vazia = await cena.pedir(`/conversas/${cena.s.grupo}/anexos?tipo=sticker`, cena.chave.valor);
    assert.equal(vazia.status, 200);
    assert.deepEqual(j(vazia.corpo).anexos, []);
    assert.equal((await cena.pedir(`/conversas/${cena.s.grupo}/anexos`)).status, 401);
  } finally {
    cena.encerrar();
  }
});

test('parametro invalido e 400: presenca, data, cursor, limite, ordem, remetente e tipo vazios (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    for (const qs of [
      'presenca=talvez',
      'desde=ontem',
      'antes=lixo',
      'limite=0',
      'limite=abc',
      'ordem=recentes',
      'remetente=',
      'tipo=',
    ]) {
      const r = await cena.pedir(`/conversas/${cena.s.grupo}/anexos?${qs}`, cena.chave.valor);
      assert.equal(r.status, 400, qs);
    }
  } finally {
    cena.encerrar();
  }
});

test('remetente em mensagens: rota global e por Conversa, desconhecido vazio, e Pessoa x remetente se intersectam (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const global = j((await cena.pedir(`/mensagens?remetente=${encodeURIComponent(BRUNO_LID)}`, cena.chave.valor)).corpo);
    assert.equal(global.mensagens.length, 4 + 3, 'quatro de texto e tres com Anexo, todas do Bruno');
    const doGrupo = j(
      (await cena.pedir(`/conversas/${cena.s.grupo}/mensagens?remetente=${encodeURIComponent(BRUNO)}`, cena.chave.valor))
        .corpo,
    );
    assert.equal(doGrupo.mensagens.length, 1 + 2);
    assert.deepEqual(j((await cena.pedir('/mensagens?remetente=000%40lid', cena.chave.valor)).corpo).mensagens, []);
    const cruzado = j(
      (
        await cena.pedir(
          `/mensagens?remetente=${encodeURIComponent(BRUNO)}&autor=${cena.s.pessoaDeAna}`,
          cena.chave.valor,
        )
      ).corpo,
    );
    assert.deepEqual(cruzado.mensagens, []);
    assert.equal((await cena.pedir('/mensagens?remetente=', cena.chave.valor)).status, 400);
    assert.equal((await cena.pedir(`/conversas/${cena.s.grupo}/mensagens?remetente=`, cena.chave.valor)).status, 400);
  } finally {
    cena.encerrar();
  }
});

test('sem remetente as rotas de mensagens devolvem o de sempre: conjunto e ordem de uma consulta independente (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const acervo = abrirAcervoSomenteLeitura(`${cena.raiz}/acervos`, cena.inquilinoId);
    let doGrupo: string[];
    let todas: string[];
    try {
      const ids = (sql: string, ...v: string[]): string[] =>
        (acervo.preparar(sql).all(...v) as Array<{ id: string }>).map((l) => l.id);
      doGrupo = ids('SELECT id FROM mensagens WHERE conversa_id = ? ORDER BY ocorrida_em, id', cena.s.grupo);
      todas = ids('SELECT id FROM mensagens ORDER BY ocorrida_em, id');
    } finally {
      acervo.fechar();
    }
    assert.equal(doGrupo.length, 9);
    const porConversa = j((await cena.pedir(`/conversas/${cena.s.grupo}/mensagens`, cena.chave.valor)).corpo).mensagens;
    assert.deepEqual(porConversa.map((x: { id: string }) => x.id), doGrupo);
    const global = j((await cena.pedir('/mensagens?ordem=cronologica', cena.chave.valor)).corpo).mensagens;
    assert.deepEqual(global.map((x: { id: string }) => x.id), todas);
  } finally {
    cena.encerrar();
  }
});

test('o mesmo valor de remetente em dois Inquilinos devolve, a cada chave, so o dele (#1129)', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: semearMidia,
    semearNoOutro: (acervo, intruso) => {
      const conversa = registrarConversa(acervo, {
        fonte: 'whatsapp',
        idExterno: 'outro@g.us',
        coletiva: true,
        metadadosDeColetiva: { assunto: 'Do Outro' },
        bruto: '{}',
      });
      const msg = registrarMensagem(acervo, {
        conversaId: conversa,
        fonte: 'whatsapp',
        idExterno: 'x-1',
        autorId: intruso,
        conteudo: 'segredo do outro',
        ocorridaEm: Date.now(),
        agora: Date.now(),
        direcao: 'recebida',
      });
      registrarAnexo(acervo, { mensagemId: msg, tipo: 'image', presenca: 'nunca-obtido' });
    },
  });
  try {
    const nosso = await cena.pedir(`/mensagens?remetente=${encodeURIComponent(BRUNO)}`, cena.chave.valor);
    assert.ok(!nosso.corpo.includes('segredo do outro'));
    const dele = await cena.pedir(`/mensagens?remetente=${encodeURIComponent(BRUNO)}`, cena.chaveDoOutro.valor);
    assert.ok(dele.corpo.includes('segredo do outro'));
    assert.ok(!dele.corpo.includes('com anexo'), 'nada do Acervo do Titular');
    const tentativa = await cena.pedir(
      `/mensagens?remetente=${encodeURIComponent(BRUNO)}&inquilino=${cena.inquilinoId}`,
      cena.chaveDoOutro.valor,
    );
    assert.ok(!tentativa.corpo.includes('com anexo'), '?inquilino= nao muda o alcance');
  } finally {
    cena.encerrar();
  }
});

test('as leituras novas nao gravam Operacao (#1129)', async () => {
  const cena = await subirCenaDeMidia();
  try {
    const antes = cena.operacoes();
    await cena.pedir(`/conversas/${cena.s.grupo}/anexos?limite=2`, cena.chave.valor);
    await cena.pedir(`/mensagens?remetente=${encodeURIComponent(BRUNO)}`, cena.chave.valor);
    await cena.pedir(`/conversas/${cena.s.grupo}/mensagens?remetente=${encodeURIComponent(BRUNO)}`, cena.chave.valor);
    assert.equal(cena.operacoes(), antes);
  } finally {
    cena.encerrar();
  }
});
