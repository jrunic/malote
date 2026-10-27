import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { GRUPO, LID_DE_OUTRO, TEL_DE_OUTRO, LID_DA_CONTA, JID_DA_CONTA } from './ajuda/etiqueta-ao-vivo.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo, type Acervo } from '../src/nucleo/acervo.js';
import { executar } from '../src/cli/index.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { declararEnderecosDaConta } from '../src/nucleo/endereco-da-conta.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { aplicarCitacao, removerCitacao } from '../src/nucleo/citacao.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';
import { extrairCitacoes } from '../src/adaptadores/whatsapp/extrair-citacoes.js';
import { consultaDeCandidatas } from '../src/nucleo/citacao.js';

const AGORA = Date.parse('2026-10-21T13:00:00Z');
const DIA = Date.parse('2026-10-20T10:00:00Z');

function evento(id: string, message: Record<string, unknown>, participant = LID_DE_OUTRO): string {
  return JSON.stringify({ key: { remoteJid: GRUPO, id, fromMe: false, participant }, messageTimestamp: 1, message });
}

function citando(id: string, stanzaId: string, participant?: string): string {
  return evento(id, { extendedTextMessage: { text: 'sim', contextInfo: { stanzaId, ...(participant !== undefined ? { participant } : {}) } } });
}

function gravar(acervo: Acervo, cv: string, idExterno: string, bruto: string | undefined, quando = DIA, direcao: 'enviada' | 'recebida' = 'recebida'): string {
  return registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId: cv, fonte: 'whatsapp', idExterno, ocorridaEm: quando, agora: AGORA, direcao, ...(bruto !== undefined ? { bruto } : {}),
  });
}

function comAcervo(fn: (acervo: Acervo, cv: string) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    const cv = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: GRUPO, coletiva: true });
    fn(acervo, cv);
  } finally {
    c.limpar();
  }
}

const colunas = (acervo: Acervo, idExterno: string) =>
  acervo.preparar('SELECT citada_id, citada_id_externo, citada_autor_id, citada_direcao FROM mensagens WHERE id_externo = ?').get(idExterno) as {
    citada_id: string | null; citada_id_externo: string | null; citada_autor_id: string | null; citada_direcao: string | null;
  };

const SEM_CONTA = { enderecosDaConta: (): readonly string[] => [JID_DA_CONTA] };

test('o ensaio conta e NAO escreve: nem coluna, nem Operacao, nem Identificador', () => {
  comAcervo((acervo, cv) => {
    gravar(acervo, cv, 'ORIG', evento('ORIG', { conversation: 'x' }));
    gravar(acervo, cv, 'R1', citando('R1', 'ORIG', LID_DE_OUTRO));
    gravar(acervo, cv, 'R2', citando('R2', 'FORA', '108888888888888@lid'));
    const identificadoresAntes = (acervo.preparar('SELECT COUNT(*) AS n FROM identificadores').get() as { n: number }).n;
    const operacoesAntes = listarOperacoesCruas(acervo).length;

    const r = extrairCitacoes(acervo, { comEfeito: false, ...SEM_CONTA });
    assert.deepEqual(
      { citam: r.citam, comVinculo: r.comVinculo, soPeloIdExterno: r.soPeloIdExterno, gravadas: r.gravadas, gravou: r.gravou },
      { citam: 2, comVinculo: 1, soPeloIdExterno: 1, gravadas: 0, gravou: false },
    );
    assert.equal(colunas(acervo, 'R1').citada_id_externo, null);
    assert.equal((acervo.preparar('SELECT COUNT(*) AS n FROM identificadores').get() as { n: number }).n, identificadoresAntes);
    assert.equal(listarOperacoesCruas(acervo).length, operacoesAntes, 'o ensaio nao abre Operacao');
  });
});

test('com efeito grava as colunas, vincula a citada, e a segunda passada nao encontra mais nada', () => {
  comAcervo((acervo, cv) => {
    const orig = gravar(acervo, cv, 'ORIG', evento('ORIG', { conversation: 'x' }));
    gravar(acervo, cv, 'R1', citando('R1', 'ORIG', LID_DE_OUTRO));
    gravar(acervo, cv, 'R2', citando('R2', 'FORA', LID_DA_CONTA));
    const r = extrairCitacoes(acervo, { comEfeito: true, ...SEM_CONTA });
    assert.equal(r.gravadas, 2);
    assert.equal(r.gravou, true);
    const r1 = colunas(acervo, 'R1');
    assert.equal(r1.citada_id, orig);
    assert.equal(r1.citada_id_externo, 'ORIG');
    assert.equal(r1.citada_direcao, 'recebida', 'a direcao da citada vem dela, que o Acervo tem');
    const r2 = colunas(acervo, 'R2');
    assert.deepEqual(r2, { citada_id: null, citada_id_externo: 'FORA', citada_autor_id: null, citada_direcao: 'enviada' });

    const de_novo = extrairCitacoes(acervo, { comEfeito: true, ...SEM_CONTA });
    assert.equal(de_novo.citam, 0);
    assert.equal(de_novo.gravou, false);
  });
});

test('edicao, reacao, Mensagem de importacao e outra Fonte nao entram', () => {
  comAcervo((acervo, cv) => {
    gravar(acervo, cv, 'EDIT', evento('EDIT', { protocolMessage: { type: 'MESSAGE_EDIT', editedMessage: { extendedTextMessage: { text: 'x', contextInfo: { stanzaId: 'ORIG' } } } } }));
    gravar(acervo, cv, 'REACAO', evento('REACAO', { reactionMessage: { text: '👍', contextInfo: { stanzaId: 'ORIG' } } }));
    gravar(acervo, cv, 'BACKUP', JSON.stringify({ ZTEXT: 'x', ZSTANZAID: 'ORIG' }));
    gravar(acervo, cv, 'SEMBRUTO', undefined);
    const ig = registrarConversa(acervo, { fonte: 'instagram', idExterno: 'ig-1', coletiva: false, configuracao: { id: 'cfg-ig', fonte: 'instagram' } });
    registrarMensagem(acervo, { origemDaChegada: 'importacao', conversaId: ig, fonte: 'instagram', idExterno: 'IG', ocorridaEm: DIA, agora: AGORA, direcao: 'recebida', bruto: citando('IG', 'X') });
    const r = extrairCitacoes(acervo, { comEfeito: true, ...SEM_CONTA });
    assert.equal(r.citam, 0);
    assert.equal(r.gravou, false);
    // O pre-filtro deixa passar a edicao e a reacao (trazem o id), que a leitura recusa; o bruto de importacao nem chega la
    // e vai para a contagem a parte. A Mensagem sem bruto e a de outra Fonte nao contam.
    assert.equal(r.examinadas, 2);
    assert.equal(r.semContexto, 1);
  });
});

test('o bruto que nao e JSON, mas passa no pre-filtro, e contado como ilegivel e segue candidato', () => {
  comAcervo((acervo, cv) => {
    gravar(acervo, cv, 'RUIM', 'nao e json "stanzaId"');
    const r = extrairCitacoes(acervo, { comEfeito: true, ...SEM_CONTA });
    assert.equal(r.ilegiveis, 1);
    assert.equal(r.citam, 0);
    assert.equal(extrairCitacoes(acervo, { comEfeito: false, ...SEM_CONTA }).ilegiveis, 1, 'segue candidata em toda passada');
  });
});

test('a consulta de candidatas anda pelo rowid, nao pelo indice da Fonte: cada pagina custa a pagina, nao o Acervo', () => {
  comAcervo((acervo) => {
    for (const filtro of [
      { fonte: 'whatsapp' as const, contem: '"stanzaId"', depoisDe: 0, limite: 500 },
      { fonte: 'whatsapp' as const, contem: '"stanzaId"', depoisDe: 7, limite: 500, de: 1, ate: 2 },
    ]) {
      const { sql, valores } = consultaDeCandidatas(filtro);
      const plano = (acervo.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...valores) as Array<{ detail: string }>).map((l) => l.detail).join(' | ');
      assert.doesNotMatch(plano, /sqlite_autoindex_mensagens/, plano);
      // Com recorte de datas o indice do instante delimita a faixa e a ordenacao e so dela; sem recorte, e o rowid.
      if (filtro.de === undefined) assert.doesNotMatch(plano, /USE TEMP B-TREE FOR ORDER BY/, plano);
    }
  });
});

test('--limite invalido recusa com codigo 2 e nao escreve nada', () => {
  const i = instalacaoComCitacao();
  try {
    for (const valor of ['abc', '0', '-3', '1.5']) {
      const r = rodar(i.raiz, ['citacao', 'extrair', '--inquilino', i.inquilino, '--limite', valor, '--com-efeito', '--confirmo']);
      assert.equal(r.codigo, 2, `--limite ${valor}`);
      assert.match(r.saida, /inteiro maior que zero/);
    }
    const acervo = abrirAcervo(join(i.raiz, 'acervos'), i.inquilino);
    try {
      assert.equal(colunas(acervo, 'R1').citada_id_externo, null);
    } finally {
      acervo.fechar();
    }
  } finally {
    i.limpar();
  }
});

test('o ensaio da CLI conta a parte o que ignora', () => {
  const i = instalacaoComCitacao();
  try {
    const r = rodar(i.raiz, ['citacao', 'extrair', '--inquilino', i.inquilino, '--json']);
    const relatorio = JSON.parse(r.saida) as { semContexto: number; citam: number };
    assert.equal(relatorio.citam, 1);
    assert.equal(relatorio.semContexto, 0);
    assert.match(rodar(i.raiz, ['citacao', 'extrair', '--inquilino', i.inquilino]).saida, /sem o contexto de citacao/);
  } finally {
    i.limpar();
  }
});

test('a funcao de enderecos recebe a Configuracao dona da Conversa: nula na coletiva', () => {
  comAcervo((acervo, cv) => {
    gravar(acervo, cv, 'R1', citando('R1', 'ANTIGA', LID_DE_OUTRO));
    const vistas: Array<string | null> = [];
    extrairCitacoes(acervo, {
      comEfeito: false,
      enderecosDaConta: (cfg) => {
        vistas.push(cfg);
        return [];
      },
    });
    assert.deepEqual(vistas, [null]);
  });
});

test('o limite invalido tambem e recusado pela funcao', () => {
  comAcervo((acervo) => {
    for (const limite of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => extrairCitacoes(acervo, { comEfeito: true, ...SEM_CONTA, limite }), RangeError);
    }
  });
});

test('o recorte por datas e o limite valem', () => {
  comAcervo((acervo, cv) => {
    gravar(acervo, cv, 'VELHA', citando('VELHA', 'A', LID_DE_OUTRO), Date.parse('2026-09-01T10:00:00Z'));
    gravar(acervo, cv, 'M1', citando('M1', 'B', LID_DE_OUTRO), Date.parse('2026-10-10T10:00:00Z'));
    gravar(acervo, cv, 'M2', citando('M2', 'C', LID_DE_OUTRO), Date.parse('2026-10-11T10:00:00Z'));
    gravar(acervo, cv, 'NOVA', citando('NOVA', 'D', LID_DE_OUTRO), Date.parse('2026-10-20T10:00:00Z'));
    const r = extrairCitacoes(acervo, { comEfeito: false, ...SEM_CONTA, de: Date.parse('2026-10-01T00:00:00Z'), ate: Date.parse('2026-10-15T00:00:00Z') });
    assert.equal(r.citam, 2);
    const l = extrairCitacoes(acervo, { comEfeito: true, ...SEM_CONTA, limite: 1 });
    assert.equal(l.gravadas, 1, 'o limite conta Mensagens que ganham Citacao');
    const restantes = extrairCitacoes(acervo, { comEfeito: false, ...SEM_CONTA });
    assert.equal(restantes.citam, 3);
  });
});

test('a passada atravessa mais de uma pagina de candidatas', () => {
  comAcervo((acervo, cv) => {
    for (let i = 0; i < 7; i += 1) gravar(acervo, cv, `P${i}`, citando(`P${i}`, `C${i}`, LID_DE_OUTRO), DIA + i);
    const r = extrairCitacoes(acervo, { comEfeito: true, ...SEM_CONTA, tamanhoDaPagina: 3 });
    assert.equal(r.gravadas, 7);
  });
});

test('o desfazer devolve as quatro colunas a nulo, inclusive o vinculo tardio sobre essas linhas', () => {
  comAcervo((acervo, cv) => {
    gravar(acervo, cv, 'R1', citando('R1', 'ORIG', LID_DE_OUTRO));
    extrairCitacoes(acervo, { comEfeito: true, ...SEM_CONTA });
    // A citada chega DEPOIS do comando, e o vinculo tardio preenche citada_id na linha que o comando escreveu.
    gravar(acervo, cv, 'ORIG', evento('ORIG', { conversation: 'x' }));
    assert.notEqual(colunas(acervo, 'R1').citada_id, null);

    const operacao = listarOperacoesCruas(acervo).find((o) => o.natureza === 'extrair-citacoes');
    assert.ok(operacao, 'a Operacao nao foi gravada');
    assert.equal(operacao.reversibilidade, 'por-efeito');
    assert.equal(linhasDaOperacao(acervo, operacao.id).length, 1, 'um efeito por Mensagem');

    const r = desfazerOperacao(acervo, operacao.id);
    assert.equal(r.desfeitos, 1);
    assert.deepEqual(r.recusados, []);
    assert.deepEqual(colunas(acervo, 'R1'), { citada_id: null, citada_id_externo: null, citada_autor_id: null, citada_direcao: null });
  });
});

function instalacaoComCitacao(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  const cv = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: GRUPO, coletiva: true });
  gravar(acervo, cv, 'R1', citando('R1', 'ANTIGA', TEL_DE_OUTRO));
  acervo.fechar();
  return { raiz, inquilino, limpar };
}

const rodar = (raiz: string, args: string[]): { codigo: number; saida: string } => {
  const linhas: string[] = [];
  const codigo = executar(args, { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) });
  return { codigo, saida: linhas.join('\n') };
};

test('malote citacao extrair: ensaio por padrao, e so com --com-efeito --confirmo escreve', () => {
  const i = instalacaoComCitacao();
  try {
    const ensaio = rodar(i.raiz, ['citacao', 'extrair', '--inquilino', i.inquilino]);
    assert.equal(ensaio.codigo, 0);
    assert.match(ensaio.saida, /Ensaio: 1 Mensagem\(ns\) com Cita/);
    assert.match(ensaio.saida, /Nada foi escrito/);

    const semConfirmo = (() => {
      try {
        return rodar(i.raiz, ['citacao', 'extrair', '--inquilino', i.inquilino, '--com-efeito']);
      } catch (e) {
        return { codigo: 1, saida: String(e) };
      }
    })();
    assert.notEqual(semConfirmo.codigo, 0);

    const feito = rodar(i.raiz, ['citacao', 'extrair', '--inquilino', i.inquilino, '--com-efeito', '--confirmo', '--json']);
    assert.equal(feito.codigo, 0);
    const relatorio = JSON.parse(feito.saida) as { gravadas: number; gravou: boolean; soPeloIdExterno: number };
    assert.deepEqual({ gravadas: relatorio.gravadas, gravou: relatorio.gravou, soPeloIdExterno: relatorio.soPeloIdExterno }, { gravadas: 1, gravou: true, soPeloIdExterno: 1 });
    const acervo = abrirAcervo(join(i.raiz, 'acervos'), i.inquilino);
    try {
      assert.equal(colunas(acervo, 'R1').citada_id_externo, 'ANTIGA');
    } finally {
      acervo.fechar();
    }
  } finally {
    i.limpar();
  }
});

test('aplicarCitacao nunca sobrescreve uma Citacao que a Mensagem ja tem, e removerCitacao so remove a que confere', () => {
  comAcervo((acervo, cv) => {
    const sem = gravar(acervo, cv, 'SEM', undefined);
    const com = registrarMensagem(acervo, {
      origemDaChegada: 'importacao',
      conversaId: cv, fonte: 'whatsapp', idExterno: 'COM', ocorridaEm: DIA, agora: AGORA, direcao: 'recebida',
      citacao: { idExterno: 'PRIMEIRA', direcao: 'recebida' },
    });
    const alvo = { fonte: 'whatsapp' as const, conversaId: cv };

    assert.equal(aplicarCitacao(acervo, com, alvo, { idExterno: 'SEGUNDA' }), null, 'a Citacao existente nao e sobrescrita');
    assert.equal(colunas(acervo, 'COM').citada_id_externo, 'PRIMEIRA');
    assert.notEqual(aplicarCitacao(acervo, sem, alvo, { idExterno: 'NOVA' }), null);
    assert.equal(colunas(acervo, 'SEM').citada_id_externo, 'NOVA');

    assert.equal(removerCitacao(acervo, com, 'OUTRA'), false, 'outro id externo nao e a Citacao que o comando gravou');
    assert.equal(colunas(acervo, 'COM').citada_id_externo, 'PRIMEIRA');
    assert.equal(removerCitacao(acervo, com, 'PRIMEIRA'), true);
    assert.equal(colunas(acervo, 'COM').citada_id_externo, null);
  });
});
