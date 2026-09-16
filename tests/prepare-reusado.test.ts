import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { backupFalso, paraCoreData, type MensagemFalsa } from './ajuda/material-falso.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

/**
 * O custo de compilar SQL nao aparece no heap do V8: um `sqlite3_stmt` vive em
 * memoria NATIVA, e o `better-sqlite3` mantem os statements referenciados na
 * conexao para finaliza-los no `close()`. Coleta de lixo nao os alcanca.
 *
 * Medido em 06/09/2026: cada `prepare` custa ~3,8 KB de RSS que nunca voltam, e
 * o caminho de escrita compilava QUATRO por Mensagem. Num material de 1,23
 * milhao de Mensagens isso projeta ~18,7 GB so em statements — a importacao nao
 * terminaria em maquina nenhuma. O processo real morreu pelo OOM killer com
 * 6,58 GB depois de 210.882 Mensagens.
 *
 * Este teste conta COMPILACOES, nao memoria. Contar prepare e estavel; medir RSS
 * varia com a maquina, com o coletor e com o que mais estiver rodando.
 */
test('importar N Mensagens compila um numero CONSTANTE de statements, nao proporcional', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const N = 300;

  const mensagens: MensagemFalsa[] = [];
  for (let i = 0; i < N; i += 1) {
    mensagens.push({
      stanzaId: `M${i}`,
      chatSessionPk: 1,
      texto: `mensagem ${i}`,
      dataCoreData: paraCoreData('2026-01-01T00:00:00Z') + i,
    });
  }
  const backup = backupFalso({
    conversas: [
      { pk: 1, endereco: '5500000000000@s.whatsapp.net', nome: 'Conversa', tipoDeSessao: 0 },
    ],
    mensagens,
  });

  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);

    let compilacoes = 0;
    const original = acervo.db.prepare.bind(acervo.db);
    (acervo.db as unknown as { prepare: unknown }).prepare = (sql: string) => {
      compilacoes += 1;
      return original(sql);
    };

    const relatorio = importarMaterial(acervo, backup.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });

    // Primeiro o teste prova que EXERCITOU o caminho: suite verde por vacuidade
    // — laco que nao itera e asserção que nao mede nada — foi defeito real desta
    // frota, e a contagem e o que separa verde de vazio.
    assert.equal(relatorio.mensagensCriadas, N, 'o cenario nao importou as Mensagens');

    // O limite e CONSTANTE de proposito. Com compilacao por chamada dariam mais
    // de 4 x N; o numero exato de SQLs distintos nao importa e vai mudar com o
    // codigo, entao a folga e larga e o sinal continua inequivoco.
    assert.ok(
      compilacoes < 100,
      `compilou ${compilacoes} statements para ${N} Mensagens — deveria ser constante, ` +
        `nao proporcional (por chamada seriam ~${4 * N})`,
    );

    acervo.fechar();
  } finally {
    backup.limpar();
    limpar();
  }
});
