import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';
import { buscarMensagens } from '../src/nucleo/consulta.js';
import { indiceDeBuscaEstaIntegro } from '../src/nucleo/texto-da-mensagem.js';
import {
  EstoqueDeLegendaInterrompidoError,
  extrairLegendas,
  IndiceDeBuscaDefasadoError,
} from '../src/adaptadores/whatsapp/extrair-legenda.js';
import { registrarEdicao, lerEdicoes, textoAtualDe } from '../src/nucleo/edicao.js';
import type { Acervo } from '../src/nucleo/acervo.js';

/**
 * O estoque da legenda (#1530): grava como texto da Mensagem a legenda das ja gravadas, mantem a busca consistente, abre uma
 * Operacao com volta e nunca mexe no que ja tem texto. Fixtures SINTETICAS na forma medida: o evento ao vivo (`{"key"...`) e a
 * linha do backup (`{"Z...`) com o registro de midia no Anexo.
 */

const AGORA = Date.parse('2026-11-18T12:00:00Z');
const DIA = Date.parse('2026-11-10T10:00:00Z');
const CONTATO = '5511900000001@s.whatsapp.net';
const LEGENDA = 'Legenda sintetica de teste';

const aoVivo = (id: string, message: Record<string, unknown>): string =>
  JSON.stringify({ key: { remoteJid: CONTATO, id, fromMe: false }, messageTimestamp: 1, message });

function comAcervo(corpo: (acervo: Acervo, conversa: string) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const conversa = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: CONTATO, coletiva: false, configuracao: { id: 'cfg-teste', fonte: 'whatsapp' } });
    corpo(acervo, conversa);
  } finally {
    c.limpar();
  }
}

function gravar(acervo: Acervo, conversa: string, idExterno: string, bruto: string, conteudo?: string): string {
  return registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId: conversa,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm: DIA,
    agora: AGORA,
    direcao: 'recebida',
    bruto,
    ...(conteudo === undefined ? {} : { conteudo }),
  });
}

/** Uma Mensagem do backup do iPhone: a linha comeca com `{"Z`, e a legenda esta no registro de midia do Anexo. */
function gravarDoBackup(acervo: Acervo, conversa: string, idExterno: string, tipo: string, titulo: string | null): string {
  const id = gravar(acervo, conversa, idExterno, JSON.stringify({ ZSTANZAID: idExterno, ZMESSAGETYPE: 1 }));
  registrarAnexo(acervo, {
    origemDaChegada: 'importacao',
    mensagemId: id,
    tipo,
    presenca: 'nunca-obtido',
    bruto: JSON.stringify({ Z_PK: 1, ...(titulo === null ? {} : { ZTITLE: titulo }) }),
  });
  return id;
}

const texto = (acervo: Acervo, idExterno: string): string | null =>
  (acervo.db.prepare('SELECT conteudo FROM mensagens WHERE id_externo = ?').get(idExterno) as { conteudo: string | null }).conteudo;

/** O estoque tipico: duas ao vivo (imagem e video), uma documento ao vivo, duas do backup (imagem e video). */
function semear(acervo: Acervo, conversa: string): void {
  gravar(acervo, conversa, 'AI', aoVivo('AI', { imageMessage: { caption: LEGENDA } }));
  gravar(acervo, conversa, 'AV', aoVivo('AV', { videoMessage: { caption: LEGENDA + ' video' } }));
  gravar(acervo, conversa, 'AD', aoVivo('AD', { documentMessage: { caption: LEGENDA + ' doc' } }));
  gravarDoBackup(acervo, conversa, 'BI', 'image', LEGENDA + ' foto do iphone');
  gravarDoBackup(acervo, conversa, 'BV', 'video', LEGENDA + ' video do iphone');
}

const operacoesDoComando = (acervo: Acervo) => listarOperacoesCruas(acervo).filter((o) => o.natureza === 'extrair-legenda-da-midia');

test('o ensaio conta por origem e tipo e NAO escreve: nem texto, nem Operacao, e o indice segue integro', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    const operacoesAntes = listarOperacoesCruas(acervo).length;
    const r = extrairLegendas(acervo, { comEfeito: false });
    assert.deepEqual(r.aoVivo, { imagem: 1, video: 1, documento: 1 });
    assert.deepEqual(r.backup, { imagem: 1, video: 1 });
    assert.equal(r.aGravar, 5);
    assert.deepEqual({ gravadas: r.gravadas, gravou: r.gravou, operacaoId: r.operacaoId, indiceIntegro: r.indiceIntegro }, { gravadas: 0, gravou: false, operacaoId: null, indiceIntegro: null });
    assert.equal(texto(acervo, 'AI'), null);
    assert.equal(listarOperacoesCruas(acervo).length, operacoesAntes, 'o ensaio nao abre Operacao');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  });
});

test('o efeito grava o texto, abre UMA Operacao por-efeito com uma linha por Mensagem, a busca ACHA e o indice fica integro', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    const r = extrairLegendas(acervo, { comEfeito: true });
    assert.equal(r.gravadas, 5);
    assert.equal(r.gravou, true);
    assert.equal(r.indiceIntegro, true);
    assert.equal(texto(acervo, 'AI'), LEGENDA);
    assert.equal(texto(acervo, 'BV'), LEGENDA + ' video do iphone');
    const ops = operacoesDoComando(acervo);
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.reversibilidade, 'por-efeito');
    assert.equal(linhasDaOperacao(acervo, ops[0]!.id).length, 5);
    assert.equal(r.operacaoId, ops[0]!.id);
    assert.equal(buscarMensagens(acervo, { texto: 'sintetica' }).length, 5, 'a legenda recuperada e achada pela busca');
    assert.equal(buscarMensagens(acervo, { texto: 'iphone' }).length, 2);
  });
});

test('idempotente: rodar de novo nao grava, nao abre Operacao e nao muda o indice', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    extrairLegendas(acervo, { comEfeito: true });
    const r = extrairLegendas(acervo, { comEfeito: true });
    assert.deepEqual({ aGravar: r.aGravar, gravadas: r.gravadas, gravou: r.gravou, operacaoId: r.operacaoId }, { aGravar: 0, gravadas: 0, gravou: false, operacaoId: null });
    assert.equal(operacoesDoComando(acervo).length, 1);
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  });
});

test('o que NAO entra: a legenda so da citada, documento do backup, titulo vazio, mensagem que JA tem texto', () => {
  comAcervo((acervo, cv) => {
    gravar(acervo, cv, 'Q1', aoVivo('Q1', { imageMessage: { contextInfo: { quotedMessage: { imageMessage: { caption: LEGENDA } } } } }));
    gravarDoBackup(acervo, cv, 'BD', 'document', 'relatorio-de-teste.pdf');
    gravarDoBackup(acervo, cv, 'BX', 'image', '  ');
    gravarDoBackup(acervo, cv, 'BN', 'image', null);
    gravar(acervo, cv, 'JA', aoVivo('JA', { imageMessage: { caption: LEGENDA } }), 'texto que ja estava');
    const r = extrairLegendas(acervo, { comEfeito: true });
    assert.equal(r.aGravar, 0);
    for (const id of ['Q1', 'BD', 'BX', 'BN']) assert.equal(texto(acervo, id), null, id);
    assert.equal(texto(acervo, 'JA'), 'texto que ja estava', 'nunca sobrescreve');
    assert.deepEqual(operacoesDoComando(acervo), []);
  });
});

test('a contagem por tipo vem da midia de que a legenda SAIU, nao de texto do bruto: um video que cita uma imagem e video', () => {
  comAcervo((acervo, cv) => {
    gravar(
      acervo,
      cv,
      'VC',
      aoVivo('VC', { videoMessage: { caption: LEGENDA, contextInfo: { quotedMessage: { imageMessage: { caption: 'outra' } } } } }),
    );
    const r = extrairLegendas(acervo, { comEfeito: false });
    assert.deepEqual(r.aoVivo, { imagem: 0, video: 1, documento: 0 });
  });
});

test('a Mensagem com texto VAZIO conta como sem texto: a legenda entra e o desfazer devolve o vazio', () => {
  comAcervo((acervo, cv) => {
    gravar(acervo, cv, 'VZ', aoVivo('VZ', { imageMessage: { caption: LEGENDA } }), '');
    gravar(acervo, cv, 'NL', aoVivo('NL', { imageMessage: { caption: LEGENDA + ' nulo' } }));
    const r = extrairLegendas(acervo, { comEfeito: true });
    assert.equal(r.gravadas, 2);
    assert.equal(texto(acervo, 'VZ'), LEGENDA);
    const d = desfazerOperacao(acervo, r.operacaoId!);
    assert.equal(d.desfeitos, 2);
    assert.deepEqual(d.recusados, []);
    assert.equal(texto(acervo, 'VZ'), '', 'o que era vazio volta vazio');
    assert.equal(texto(acervo, 'NL'), null, 'o que era nulo volta nulo');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  });
});

test('o desfazer devolve o texto ao de antes, a busca deixa de achar e o indice segue integro, mesmo apagando a Mensagem depois', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    const r = extrairLegendas(acervo, { comEfeito: true });
    const d = desfazerOperacao(acervo, r.operacaoId!);
    assert.equal(d.desfeitos, 5);
    assert.deepEqual(d.recusados, []);
    for (const id of ['AI', 'AV', 'AD', 'BI', 'BV']) assert.equal(texto(acervo, id), null, id);
    assert.equal(buscarMensagens(acervo, { texto: 'sintetica' }).length, 0);
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
    // O defeito que a ordem errada produz aparece AQUI: apagar a Mensagem depois de um desfazer mal feito da "malformed".
    acervo.preparar('DELETE FROM mensagens WHERE id_externo = ?').run('AI');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
    assert.doesNotThrow(() => buscarMensagens(acervo, { texto: 'sintetica' }));
  });
});

test('o desfazer RECUSA a linha cujo texto ja nao e o que a Operacao gravou, e mantem o que outro caminho escreveu', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    const r = extrairLegendas(acervo, { comEfeito: true });
    acervo.preparar('UPDATE mensagens SET conteudo = ? WHERE id_externo = ?').run('texto de outro caminho', 'AI');
    const d = desfazerOperacao(acervo, r.operacaoId!);
    assert.equal(d.desfeitos, 4);
    assert.equal(d.recusados.length, 1);
    assert.equal(texto(acervo, 'AI'), 'texto de outro caminho');
  });
});

test('falha no meio de um lote: a Operacao fica aberta com os lotes anteriores, repetir cria uma SEGUNDA, e o desfazer pede as duas', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    let lotes = 0;
    assert.throws(
      () =>
        extrairLegendas(acervo, {
          comEfeito: true,
          tamanhoDoLote: 2,
          aoTerminarLote: () => {
            lotes += 1;
            if (lotes === 2) throw new Error('o escritor nao liberou');
          },
        }),
      (erro: unknown) => erro instanceof EstoqueDeLegendaInterrompidoError && erro.gravadas === 4,
    );
    const gravadasAntes = (acervo.db.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE conteudo IS NOT NULL").get() as { n: number }).n;
    assert.equal(gravadasAntes, 4, 'os dois primeiros lotes (4 Mensagens) ficaram gravados');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true, 'e o indice acompanha o que ficou');

    const r = extrairLegendas(acervo, { comEfeito: true });
    assert.equal(r.gravadas, 1, 'completa so o que falta');
    const ops = operacoesDoComando(acervo);
    assert.equal(ops.length, 2, 'uma SEGUNDA Operacao');
    for (const op of ops) desfazerOperacao(acervo, op.id);
    for (const id of ['AI', 'AV', 'AD', 'BI', 'BV']) assert.equal(texto(acervo, id), null, id);
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  });
});

test('o indice de busca DEFASADO: o comando RECUSA antes de escrever (o ensaio nao), e a verificacao simples nao o veria', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    // Defasa o indice de proposito: atualiza o texto sem refazer a entrada (o estado que a ordem errada deixaria).
    const id = gravar(acervo, cv, 'DEF', aoVivo('DEF', { conversation: 'x' }));
    acervo.preparar('UPDATE mensagens SET conteudo = ? WHERE id = ?').run('texto sem entrada no indice', id);
    // A forma SIMPLES do integrity-check nao detecta a divergencia (medido pelo revisor); so a que compara.
    assert.doesNotThrow(() => acervo.preparar(`INSERT INTO mensagens_texto(mensagens_texto) VALUES ('integrity-check')`).run());
    assert.equal(indiceDeBuscaEstaIntegro(acervo), false, 'a verificacao com comparacao ve');

    assert.doesNotThrow(() => extrairLegendas(acervo, { comEfeito: false }), 'o ensaio nao verifica nem escreve');
    assert.throws(() => extrairLegendas(acervo, { comEfeito: true }), IndiceDeBuscaDefasadoError);
    assert.equal(texto(acervo, 'AI'), null, 'nada foi escrito');
    assert.deepEqual(operacoesDoComando(acervo), []);
  });
});

test('--limite corta a lista e o lote e respeitado; limite invalido e recusado', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    const r = extrairLegendas(acervo, { comEfeito: true, limite: 2, tamanhoDoLote: 1 });
    assert.equal(r.aGravar, 2);
    assert.equal(r.gravadas, 2);
    assert.throws(() => extrairLegendas(acervo, { comEfeito: false, limite: 0 }), RangeError);
    assert.throws(() => extrairLegendas(acervo, { comEfeito: false, tamanhoDoLote: 0 }), RangeError);
  });
});

const chegadas = (acervo: Acervo): number => (acervo.db.prepare('SELECT COUNT(*) AS n FROM chegadas').get() as { n: number }).n;

test('E5: o estoque NAO emite Chegada: nem o ensaio, nem o efeito, nem o desfazer mexem no Diario de Chegadas', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    const antes = chegadas(acervo);
    assert.ok(antes >= 5, 'as Mensagens semeadas deixaram as suas Chegadas');
    extrairLegendas(acervo, { comEfeito: false });
    assert.equal(chegadas(acervo), antes, 'o ensaio');
    const r = extrairLegendas(acervo, { comEfeito: true });
    assert.equal(r.gravadas, 5);
    assert.equal(chegadas(acervo), antes, 'o efeito: quem acompanha pelo Marcador nao ve a legenda aparecer');
    desfazerOperacao(acervo, r.operacaoId!);
    assert.equal(chegadas(acervo), antes, 'o desfazer');
  });
});

test('a Mensagem EDITADA: o texto original vira texto da Mensagem, a Edicao segue separada, a busca acha pelas duas e a Mensagem conta uma vez', () => {
  comAcervo((acervo, cv) => {
    const id = gravar(acervo, cv, 'ED', aoVivo('ED', { imageMessage: { caption: LEGENDA } }));
    registrarEdicao(acervo, {
      mensagemId: id,
      fonte: 'whatsapp',
      idExterno: 'ED-1',
      texto: 'legenda corrigida depois',
      editadaEm: DIA + 60_000,
      origem: 'aberta',
      bruto: '{}',
      origemDaChegada: 'ao-vivo',
      agora: AGORA,
    });
    const chegadasAntes = chegadas(acervo);
    extrairLegendas(acervo, { comEfeito: true });
    assert.equal(texto(acervo, 'ED'), LEGENDA, 'o texto original vira o texto da Mensagem');
    assert.equal(chegadas(acervo), chegadasAntes, 'e a Edicao e a Chegada dela nao mudam');
    const edicoes = lerEdicoes(acervo, [id]).get(id) ?? [];
    assert.equal(edicoes.length, 1);
    assert.equal(textoAtualDe(texto(acervo, 'ED'), edicoes), 'legenda corrigida depois', 'o texto atual segue sendo o da ultima Edicao');
    assert.equal(buscarMensagens(acervo, { texto: 'sintetica' }).length, 1, 'pelo texto original');
    assert.equal(buscarMensagens(acervo, { texto: 'corrigida' }).length, 1, 'pelo texto da Edicao');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  });
});

test('cada lote corre em transacao IMMEDIATE: a leitura do texto antigo e a escrita ficam sob o mesmo bloqueio de escrita', () => {
  comAcervo((acervo, cv) => {
    semear(acervo, cv);
    let imediatas = 0;
    const original = acervo.db.transaction.bind(acervo.db);
    (acervo.db as unknown as { transaction: unknown }).transaction = (fn: (...a: unknown[]) => unknown) => {
      const t = (original as (f: unknown) => { (...a: unknown[]): unknown; immediate: (...a: unknown[]) => unknown })(fn);
      // A funcao da transacao tem `immediate` somente leitura: a copia leva o contador.
      const copia = Object.assign((...a: unknown[]) => t(...a), {
        immediate: (...a: unknown[]) => {
          imediatas += 1;
          return t.immediate(...a);
        },
      });
      return copia;
    };
    extrairLegendas(acervo, { comEfeito: true, tamanhoDoLote: 2 });
    assert.equal(imediatas, 3, 'cinco legendas em lotes de dois sao tres transacoes IMMEDIATE');
  });
});
