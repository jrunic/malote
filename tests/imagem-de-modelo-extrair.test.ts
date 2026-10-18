import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { linhasDaOperacao, listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { extrairImagensDeModelo } from '../src/adaptadores/whatsapp/extrair-imagem-de-modelo.js';

const AGORA = Date.parse('2026-10-18T12:00:00Z');
const IMAGEM = { mimetype: 'image/jpeg', mediaKey: 'AAECAwQFBgcICQoLDA0ODw==', directPath: '/v/t62/sintetico', fileLength: '81572' };

const modelo = (cabecalho: unknown): string =>
  JSON.stringify({ key: { remoteJid: 'x@s.whatsapp.net', id: 'E' }, message: { templateMessage: { interactiveMessageTemplate: { body: { text: 'oferta' }, header: cabecalho } } } });
const COM_IMAGEM = modelo({ imageMessage: IMAGEM });
const SEM_IMAGEM = modelo({ title: 'so texto' });
const NAO_RECONHECIDA = JSON.stringify({ message: { templateMessage: { hydratedTemplate: { hydratedHeader: { imageMessage: IMAGEM } } } } });
const TEXTO = JSON.stringify({ message: { conversation: 'oi' } });

function comAcervo(corpo: (acervo: Acervo, nova: (id: string, bruto: string) => string) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '5565900000001@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP });
    corpo(acervo, (idExterno, bruto) =>
      registrarMensagem(acervo, { conversaId, fonte: 'whatsapp', idExterno, ocorridaEm: Date.parse('2026-10-14T10:00:00Z'), agora: AGORA, direcao: 'recebida', bruto }),
    );
  } finally {
    c.limpar();
  }
}

const anexos = (acervo: Acervo) =>
  acervo.db.prepare('SELECT id, mensagem_id AS mensagemId, tipo, presenca, bruto FROM anexos ORDER BY rowid').all() as Array<{ id: string; mensagemId: string; tipo: string; presenca: string; bruto: string }>;

test('o ensaio conta e nao escreve nada, nem Anexo nem Operacao', () => {
  comAcervo((acervo, nova) => {
    nova('M1', COM_IMAGEM);
    nova('M2', COM_IMAGEM);
    nova('M3', SEM_IMAGEM);
    nova('M4', NAO_RECONHECIDA);
    nova('M5', TEXTO);
    const comAnexo = nova('M6', COM_IMAGEM);
    registrarAnexo(acervo, { mensagemId: comAnexo, tipo: 'image', presenca: 'nunca-obtido', bruto: '{}' });
    const antes = anexos(acervo).length;

    const r = extrairImagensDeModelo(acervo, { comEfeito: false });

    assert.deepEqual(r, { mensagensDeModelo: 5, jaComAnexo: 1, comImagem: 2, formaNaoReconhecida: 1, aCriar: 2, criados: 0, gravou: false });
    assert.equal(anexos(acervo).length, antes);
    assert.equal(listarOperacoesCruas(acervo).filter((o) => o.natureza === 'extrair-imagem-de-modelo').length, 0);
  });
});

test('com efeito cria UM Anexo image nunca-obtido por Mensagem com imagem, com o conteudo da imagem como bruto, em UMA Operacao', () => {
  comAcervo((acervo, nova) => {
    const m1 = nova('M1', COM_IMAGEM);
    nova('M3', SEM_IMAGEM);
    nova('M4', NAO_RECONHECIDA);

    const r = extrairImagensDeModelo(acervo, { comEfeito: true });

    assert.equal(r.criados, 1);
    assert.equal(r.gravou, true);
    const lidos = anexos(acervo);
    assert.equal(lidos.length, 1, 'so a que tem imagem reconhecida ganha Anexo');
    assert.equal(lidos[0]?.mensagemId, m1);
    assert.equal(lidos[0]?.tipo, 'image');
    assert.equal(lidos[0]?.presenca, 'nunca-obtido');
    assert.deepEqual(JSON.parse(lidos[0]?.bruto as string), IMAGEM);
    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'extrair-imagem-de-modelo');
    assert.equal(operacoes.length, 1);
    assert.equal(operacoes[0]?.reversibilidade, 'por-efeito');
    assert.equal(linhasDaOperacao(acervo, operacoes[0]?.id as string).length, 1, 'um efeito por Anexo criado');
  });
});

test('rodar de novo nao cria nada e nao abre outra Operacao', () => {
  comAcervo((acervo, nova) => {
    nova('M1', COM_IMAGEM);
    extrairImagensDeModelo(acervo, { comEfeito: true });
    const r = extrairImagensDeModelo(acervo, { comEfeito: true });
    assert.equal(r.criados, 0);
    assert.equal(r.gravou, false);
    assert.equal(r.jaComAnexo, 1);
    assert.equal(anexos(acervo).length, 1);
    assert.equal(listarOperacoesCruas(acervo).filter((o) => o.natureza === 'extrair-imagem-de-modelo').length, 1);
  });
});

test('desfazer remove os Anexos criados e deixa os outros', () => {
  comAcervo((acervo, nova) => {
    nova('M1', COM_IMAGEM);
    nova('M2', COM_IMAGEM);
    const alheio = registrarAnexo(acervo, { mensagemId: nova('M7', TEXTO), tipo: 'image', presenca: 'nunca-obtido', bruto: '{}' });
    extrairImagensDeModelo(acervo, { comEfeito: true });
    const operacao = listarOperacoesCruas(acervo).find((o) => o.natureza === 'extrair-imagem-de-modelo');
    assert.ok(operacao);

    const r = desfazerOperacao(acervo, operacao.id);

    assert.equal(r.desfeitos, 2);
    assert.deepEqual(r.recusados, []);
    assert.deepEqual(anexos(acervo).map((a) => a.id), [alheio]);
  });
});

test('desfazer recusa o Anexo que ja foi baixado, com a causa, e mantem a midia', () => {
  comAcervo((acervo, nova) => {
    nova('M1', COM_IMAGEM);
    nova('M2', COM_IMAGEM);
    extrairImagensDeModelo(acervo, { comEfeito: true });
    const baixado = anexos(acervo)[0] as { id: string };
    acervo.db.prepare("UPDATE anexos SET presenca = 'presente', caminho = 'a/b', tamanho = 3 WHERE id = ?").run(baixado.id);
    const operacao = listarOperacoesCruas(acervo).find((o) => o.natureza === 'extrair-imagem-de-modelo');
    assert.ok(operacao);

    const r = desfazerOperacao(acervo, operacao.id);

    assert.equal(r.desfeitos, 1);
    assert.equal(r.recusados.length, 1);
    assert.match(JSON.stringify(r.recusados[0]), /baixad/);
    assert.deepEqual(anexos(acervo).map((a) => a.id), [baixado.id], 'o presente ficou');
  });
});
