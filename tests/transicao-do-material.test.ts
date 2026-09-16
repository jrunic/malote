import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { gravarMaterialLido } from '../src/adaptadores/whatsapp/importar.js';
import type { Material } from '../src/adaptadores/whatsapp/material.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

/**
 * Material com a MESMA forma que `lerMaterial` devolve, montado à mão.
 *
 * Existe para exercitar a guarda central sem depender de backup: montar dois
 * retratos que diferem custa três linhas aqui e um arquivo de 1,2 GB do outro
 * lado.
 */
function material(m: Partial<Material>): Material {
  return {
    conversas: [],
    mensagens: [],
    eventos: [],
    correspondencias: [],
    descartes: { mensagens: {}, eventos: {} },
    linhasRepetidasNoMaterial: 0,
    fechar: () => {},
    ...m,
  };
}

test('membro que SOME do roster entre dois materiais não produz Transição', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    // Retrato A: dois membros, nenhum evento declarado.
    const a = material({
      conversas: [
        {
          idExterno: 'grupo-1@g.us',
          nome: 'Grupo',
          coletiva: true,
          bruto: '{}',
          participantesConhecidos: [
            { endereco: '5565911111', ativaNaFonte: true },
            { endereco: '5565922222', ativaNaFonte: true },
          ],
        },
      ],
    });
    gravarMaterialLido(acervo, a, { agora: 1_700_000_000_000, configuracao: CFG_WHATSAPP });

    // Retrato B: o segundo membro SUMIU. Nenhum evento declarado.
    const b = material({
      conversas: [
        {
          idExterno: 'grupo-1@g.us',
          nome: 'Grupo',
          coletiva: true,
          bruto: '{}',
          participantesConhecidos: [{ endereco: '5565911111', ativaNaFonte: true }],
        },
      ],
    });
    const r = gravarMaterialLido(acervo, b, { agora: 1_700_000_100_000, configuracao: CFG_WHATSAPP });

    // O cenário CHEGOU onde precisava: a segunda passagem processou a Conversa
    // e o membro que sobrou. Sem esta contagem, o teste passaria verde mesmo
    // se a importação não tivesse feito nada — foi assim que o critério 14 do
    // ciclo 8 passou DUAS vezes com a guarda removida.
    assert.ok(
      r.participacoesJaExistentes + r.participacoesCriadas > 0,
      `o cenário não processou participante nenhum: ${JSON.stringify(r)}`,
    );

    const n = acervo.db.prepare('SELECT COUNT(*) n FROM transicoes_de_participacao').get() as {
      n: number;
    };
    assert.equal(n.n, 0, 'a diferença entre dois retratos NUNCA produz Transição');

    // E a Participação de quem sumiu PERMANECE — retrato não afirma saída.
    const p = acervo.db.prepare('SELECT COUNT(*) n FROM participacoes').get() as { n: number };
    assert.equal(p.n, 2, 'quem sumiu do retrato continua na Participação');
  } finally {
    c.limpar();
  }
});

test('só o evento DECLARADO produz Transição, e o código desconhecido é contado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const m = material({
      conversas: [
        {
          idExterno: 'grupo-2@g.us',
          nome: 'Outro',
          coletiva: true,
          bruto: '{}',
          participantesConhecidos: [{ endereco: '5565933333', ativaNaFonte: false }],
        },
      ],
      eventos: [
        {
          idExterno: 'stanza-1',
          conversaIdExterno: 'grupo-2@g.us',
          membroExterno: '5565933333',
          codigo: 7,
          ocorridoEm: 1_600_000_000_000,
        },
        {
          idExterno: 'stanza-2',
          conversaIdExterno: 'grupo-2@g.us',
          membroExterno: '5565933333',
          codigo: 30,
          ocorridoEm: 1_600_000_100_000,
        },
      ],
    });

    const r = gravarMaterialLido(acervo, m, { agora: 1_700_000_000_000, configuracao: CFG_WHATSAPP });

    assert.equal(r.transicoesCriadas, 1, 'o código 7 está no mapa; o 30 não');
    assert.deepEqual(
      r.eventosDesconhecidos,
      { '30': 1 },
      'o código 30 é CONTADO por código, nunca descartado em silêncio',
    );

    const linha = acervo.db
      .prepare('SELECT natureza, ocorrida_em FROM transicoes_de_participacao')
      .get() as { natureza: string; ocorrida_em: number };
    assert.equal(linha.natureza, 'saiu');
    assert.equal(linha.ocorrida_em, 1_600_000_000_000, 'o instante é o da Fonte');
  } finally {
    c.limpar();
  }
});

test('reimportar o MESMO material não duplica Transição, e o relatório diz isso', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const m = material({
      conversas: [
        {
          idExterno: 'grupo-3@g.us',
          nome: 'Terceiro',
          coletiva: true,
          bruto: '{}',
          participantesConhecidos: [{ endereco: '5565944444', ativaNaFonte: false }],
        },
      ],
      eventos: [
        {
          idExterno: 'stanza-3',
          conversaIdExterno: 'grupo-3@g.us',
          membroExterno: '5565944444',
          codigo: 3,
          ocorridoEm: 1_600_000_000_000,
        },
      ],
    });

    const primeira = gravarMaterialLido(acervo, m, { agora: 1_700_000_000_000, configuracao: CFG_WHATSAPP });
    const segunda = gravarMaterialLido(acervo, m, { agora: 1_700_000_100_000, configuracao: CFG_WHATSAPP });

    assert.equal(primeira.transicoesCriadas, 1);
    const n = acervo.db.prepare('SELECT COUNT(*) n FROM transicoes_de_participacao').get() as {
      n: number;
    };
    assert.equal(n.n, 1, 'a segunda passagem reencontra a linha');
    assert.equal(
      segunda.transicoesCriadas,
      0,
      'e o RELATÓRIO diz que não criou nada — contar por chamada mentiria aqui',
    );
  } finally {
    c.limpar();
  }
});

test('a atividade declarada pela Fonte entra no retrato SEM virar data', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('R2-D2');
    const m = material({
      conversas: [
        {
          idExterno: 'grupo-4@g.us',
          nome: 'Quarto',
          coletiva: true,
          bruto: '{}',
          participantesConhecidos: [
            { endereco: '5565955555', ativaNaFonte: true },
            { endereco: '5565966666', ativaNaFonte: false },
          ],
        },
      ],
    });
    gravarMaterialLido(acervo, m, { agora: 1_700_000_000_000, configuracao: CFG_WHATSAPP });

    const linhas = acervo.db
      .prepare('SELECT ativa_na_fonte, terminou_em FROM participacoes ORDER BY ativa_na_fonte')
      .all() as Array<{ ativa_na_fonte: number | null; terminou_em: string | null }>;
    assert.deepEqual(
      linhas.map((l) => l.ativa_na_fonte),
      [0, 1],
      'a distinção que a Fonte declara sobrevive à importação',
    );
    assert.ok(
      linhas.every((l) => l.terminou_em === null),
      'atividade NÃO vira terminou_em — o campo é booleano e não tem data',
    );
  } finally {
    c.limpar();
  }
});

test('Conversa direta não declara atividade, e o campo fica NULO', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    const m = material({
      conversas: [
        {
          idExterno: '5565977777',
          nome: 'Alguém',
          coletiva: false,
          bruto: '{}',
          participantesConhecidos: [],
        },
      ],
    });
    gravarMaterialLido(acervo, m, { agora: 1_700_000_000_000, configuracao: CFG_WHATSAPP });

    const linhas = acervo.db
      .prepare('SELECT ativa_na_fonte FROM participacoes')
      .all() as Array<{ ativa_na_fonte: number | null }>;
    assert.equal(linhas.length, 2, 'Conversa direta tem exatamente duas Participações');
    assert.ok(
      linhas.every((l) => l.ativa_na_fonte === null),
      'sem roster, ninguém declara — preencher com `true` afirmaria o que a Fonte não disse',
    );
  } finally {
    c.limpar();
  }
});
