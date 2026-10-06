import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import {
  GRUPO, LID_DE_OUTRO, TEL_DE_OUTRO, LID_DA_CONTA, JID_DA_CONTA, mudancaDeEtiqueta,
} from './ajuda/etiqueta-ao-vivo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { declararEnderecosDaConta } from '../src/nucleo/endereco-da-conta.js';

const AGORA = Date.parse('2026-10-05T16:00:00Z');
const OPCOES = { agora: AGORA, configuracao: CFG_WHATSAPP };

function contar(acervo: { db: { prepare: (s: string) => { get: () => unknown } } }, tabela: string): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

test('o evento vira 1 Etiqueta e NENHUMA Mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const mensagensAntes = contar(acervo, 'mensagens');
    const r = receberEvento(acervo, [mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A', autorPn: TEL_DE_OUTRO })], OPCOES);
    assert.equal(r.etiquetas, 1);
    assert.equal(r.gravados, 0, 'o evento nao e Mensagem');
    assert.equal(contar(acervo, 'etiquetas_de_participacao'), 1);
    assert.equal(contar(acervo, 'mensagens'), mensagensAntes, 'o numero de Mensagens mudou');
    assert.equal(r.ignorados['protocolMessage'], undefined, 'o evento nao conta mais como protocolMessage ignorado');
    assert.deepEqual(r.recusados, []);
  } finally {
    c.limpar();
  }
});

test('outro tipo de protocolo segue ignorado e contado por tipo — nao vira etiqueta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const r = receberEvento(acervo, [mudancaDeEtiqueta({ id: 'E1', texto: 'x', tipo: 'REVOKE' })], OPCOES);
    assert.equal(r.etiquetas, 0);
    assert.equal(r.ignorados['protocolMessage'], 1);
    assert.equal(contar(acervo, 'etiquetas_de_participacao'), 0);
  } finally {
    c.limpar();
  }
});

test('as quatro formas medidas gravam 1 linha por evento', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    const r = receberEvento(
      acervo,
      [
        mudancaDeEtiqueta({ id: 'F1', texto: 'pelo nome', autorPn: TEL_DE_OUTRO }),
        mudancaDeEtiqueta({ id: 'F2', texto: 'pelo numero', tipo: 30, autorPn: TEL_DE_OUTRO }),
        mudancaDeEtiqueta({ id: 'F3', texto: '', autorPn: TEL_DE_OUTRO }),
        mudancaDeEtiqueta({ id: 'F4', texto: 'propria', fromMe: true, autor: LID_DA_CONTA }),
      ],
      OPCOES,
    );
    assert.equal(r.etiquetas, 4);
    assert.equal(contar(acervo, 'etiquetas_de_participacao'), 4);
  } finally {
    c.limpar();
  }
});

test('o autor entra na forma CANONICA: LID com telefone grava o Identificador do telefone', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    receberEvento(acervo, [mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A', autorPn: TEL_DE_OUTRO })], OPCOES);
    const linha = acervo.db
      .prepare(
        `SELECT i.valor FROM etiquetas_de_participacao e
           JOIN identificadores i ON i.id = e.identificador_id`,
      )
      .get() as { valor: string };
    assert.equal(linha.valor, TEL_DE_OUTRO);
  } finally {
    c.limpar();
  }
});

test('autor sem par conhecido grava o endereco que a Fonte deu', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    receberEvento(acervo, [mudancaDeEtiqueta({ id: 'E1', texto: 'x' })], OPCOES);
    const linha = acervo.db
      .prepare(`SELECT i.valor FROM etiquetas_de_participacao e JOIN identificadores i ON i.id = e.identificador_id`)
      .get() as { valor: string };
    assert.equal(linha.valor, LID_DE_OUTRO);
  } finally {
    c.limpar();
  }
});

test('o par que OUTRA mensagem do mesmo lote traz e aprendido ANTES do laco (a segunda passagem cria 0)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    // O evento de etiqueta vem SEM o telefone; a Mensagem seguinte, do mesmo
    // autor, traz o par. Aprendendo dentro do laco, o primeiro evento gravaria
    // o LID e a segunda passagem gravaria o telefone: uma linha a mais sem o
    // mundo ter mudado.
    const lote = [
      mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A' }),
      {
        key: { remoteJid: GRUPO, id: 'M1', fromMe: false, participant: LID_DE_OUTRO, participantPn: TEL_DE_OUTRO },
        messageTimestamp: 1_791_215_001,
        message: { conversation: 'oi' },
      },
    ];
    receberEvento(acervo, lote, OPCOES);
    const depoisDaPrimeira = contar(acervo, 'etiquetas_de_participacao');
    const r2 = receberEvento(acervo, lote, OPCOES);
    assert.equal(contar(acervo, 'etiquetas_de_participacao'), depoisDaPrimeira, 'a segunda passagem criou linha');
    assert.equal(r2.etiquetas, 0);
    const valor = acervo.db
      .prepare(`SELECT i.valor FROM etiquetas_de_participacao e JOIN identificadores i ON i.id = e.identificador_id`)
      .get() as { valor: string };
    assert.equal(valor.valor, TEL_DE_OUTRO, 'o evento gravou sob a forma ainda nao resolvida');
  } finally {
    c.limpar();
  }
});

test('reentregar o mesmo evento deixa 1 linha e NAO conta de novo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const e = mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A', autorPn: TEL_DE_OUTRO });
    const primeira = receberEvento(acervo, [e], OPCOES);
    const segunda = receberEvento(acervo, [e], OPCOES);
    assert.equal(primeira.etiquetas, 1);
    assert.equal(segunda.etiquetas, 0);
    assert.equal(contar(acervo, 'etiquetas_de_participacao'), 1);
    // Idempotencia NAO e recusa silenciosa: sem o `ON CONFLICT` a porta lancaria `UNIQUE`, o
    // `catch` por evento a viraria `recusado`, `etiquetas` ficaria 0 e o COUNT seguiria 1 —
    // as tres assercoes acima passariam. So esta separa as duas coisas.
    assert.deepEqual(segunda.recusados, [], 'a reentrega virou recusa em vez de ser reconhecida como ja existente');
  } finally {
    c.limpar();
  }
});

test('a remocao grava texto vazio e e contada a parte', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const r = receberEvento(
      acervo,
      [
        mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A', autorPn: TEL_DE_OUTRO, labelTimestamp: 1_791_215_000 }),
        mudancaDeEtiqueta({ id: 'E2', texto: '', autorPn: TEL_DE_OUTRO, labelTimestamp: 1_791_215_100 }),
      ],
      OPCOES,
    );
    assert.equal(r.etiquetas, 2);
    assert.equal(r.etiquetasRemovidas, 1);
    const vazias = acervo.db.prepare("SELECT COUNT(*) AS n FROM etiquetas_de_participacao WHERE texto = ''").get() as { n: number };
    assert.equal(vazias.n, 1);
  } finally {
    c.limpar();
  }
});

test('o instante e o declarado pela etiqueta, em milissegundos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    receberEvento(
      acervo,
      [mudancaDeEtiqueta({ id: 'E1', texto: 'x', labelTimestamp: '1791215028', messageTimestamp: 1_791_215_029 })],
      OPCOES,
    );
    const linha = acervo.db.prepare('SELECT ocorrida_em AS em FROM etiquetas_de_participacao').get() as { em: number };
    assert.equal(linha.em, 1_791_215_028_000);
  } finally {
    c.limpar();
  }
});

test('grupo desconhecido: a Conversa nasce COLETIVA pela etiqueta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    receberEvento(acervo, [mudancaDeEtiqueta({ id: 'E1', texto: 'x', grupo: '120363000000000077@g.us' })], OPCOES);
    const conversa = acervo.db
      .prepare("SELECT coletiva FROM conversas WHERE id_externo = '120363000000000077@g.us'")
      .get() as { coletiva: number };
    assert.equal(conversa.coletiva, 1);
  } finally {
    c.limpar();
  }
});

test('etiqueta em Conversa DIRETA nao se grava e e contada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const r = receberEvento(
      acervo,
      [mudancaDeEtiqueta({ id: 'E1', texto: 'x', grupo: '5565911110002@s.whatsapp.net' })],
      OPCOES,
    );
    assert.equal(r.etiquetas, 0);
    assert.equal(r.ignorados['etiqueta-fora-de-coletiva'], 1);
    assert.equal(contar(acervo, 'etiquetas_de_participacao'), 0);
    assert.equal(contar(acervo, 'conversas'), 0, 'a Conversa direta nao pode nascer de uma etiqueta');
  } finally {
    c.limpar();
  }
});

test('a etiqueta PROPRIA grava sob o JID da conta quando o Endereco da Conta esta declarado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    const r = receberEvento(
      acervo,
      [mudancaDeEtiqueta({ id: 'E1', texto: 'propria', fromMe: true, autor: LID_DA_CONTA })],
      OPCOES,
    );
    assert.equal(r.etiquetas, 1);
    const linha = acervo.db
      .prepare(`SELECT i.valor FROM etiquetas_de_participacao e JOIN identificadores i ON i.id = e.identificador_id`)
      .get() as { valor: string };
    assert.equal(linha.valor, JID_DA_CONTA);
  } finally {
    c.limpar();
  }
});

test('a etiqueta propria sem endereco conferido nao e gravada, e o relatorio a conta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const r = receberEvento(
      acervo,
      [mudancaDeEtiqueta({ id: 'E1', texto: 'propria', fromMe: true, autor: LID_DA_CONTA })],
      OPCOES,
    );
    assert.equal(r.etiquetas, 0);
    assert.equal(r.etiquetasDaContaSemEndereco, 1);
    assert.equal(contar(acervo, 'etiquetas_de_participacao'), 0);
  } finally {
    c.limpar();
  }
});

test('a etiqueta nunca vira Atribuicao de Nome nem Participacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    receberEvento(acervo, [mudancaDeEtiqueta({ id: 'E1', texto: 'Torre A', autorPn: TEL_DE_OUTRO })], OPCOES);
    assert.equal(contar(acervo, 'atribuicoes_de_nome'), 0, 'a etiqueta entrou na precedencia de nome');
    assert.equal(contar(acervo, 'participacoes'), 0, 'a etiqueta virou Participacao');
  } finally {
    c.limpar();
  }
});

test('o relatorio so CONTA: nenhum campo dele carrega o texto da etiqueta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const texto = 'TEXTO-SINTETICO-QUE-NAO-PODE-VAZAR';
    const r = receberEvento(acervo, [mudancaDeEtiqueta({ id: 'E1', texto, autorPn: TEL_DE_OUTRO })], OPCOES);
    assert.equal(JSON.stringify(r).includes(texto), false);
  } finally {
    c.limpar();
  }
});

test('falha de leitura ao decidir uma etiqueta vira recusado e NAO derruba o resto do lote', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    // Evento sem remoteJid nao serve de fixture: ele estoura ANTES, na contagem inicial do lote
    // (heranca da recepcao). O que o `try` do ramo novo cobre e erro de banco que nao e ocupado:
    // a primeira leitura de correspondencia falha uma vez, e so. O evento bom NAO traz telefone: com
    // ele, o aprendizado do par (que le a mesma tabela) consumiria a falha antes do ramo.
    const original = acervo.preparar.bind(acervo);
    let falhou = false;
    acervo.preparar = ((sql: string) => {
      if (!falhou && sql.includes('correspondencias_de_endereco')) {
        falhou = true;
        throw new Error('leitura falhou');
      }
      return original(sql);
    }) as typeof acervo.preparar;
    const r = receberEvento(
      acervo,
      [mudancaDeEtiqueta({ id: 'RUIM', texto: 'x' }), mudancaDeEtiqueta({ id: 'BOM', texto: 'Torre A' })],
      OPCOES,
    );
    assert.equal(falhou, true, 'a fixture nao provocou a falha');
    assert.equal(r.recusados.length, 1, 'o evento cuja leitura falhou tem de virar recusado');
    assert.equal(r.recusados[0]?.idExterno, 'RUIM');
    assert.equal(r.etiquetas, 1, 'o evento bom do mesmo lote se perdeu');
  } finally {
    c.limpar();
  }
});
