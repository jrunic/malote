import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { PRECEDENCIA } from './ajuda/identidade.js';
import {
  AGORA,
  contarTrilha,
  fotografar,
  montarAcervoDaUniao,
  OP_MOVER,
  OP_PROMOVER,
  TEL_MOVER,
  TEL_OUTRA_CFG,
  TEL_PROMOVER,
  TEL_PROMOVER_SEM9,
  type Montagem,
} from './ajuda/uniao-das-conversas.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { listarConversas } from '../src/nucleo/consulta.js';
import { detalharConversa } from '../src/nucleo/detalhe-da-conversa.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { removerCorrespondencia } from '../src/nucleo/correspondencia.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { linhasDaOperacao, listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import {
  unirConversasDoContato,
  UniaoInterrompidaError,
  type RelatorioDaUniao,
} from '../src/adaptadores/whatsapp/unir-conversas-do-contato.js';

// #1440, Plano 2: a uniao das Conversas do contato no Adaptador. Enderecos sinteticos; cada um e um caso.

function comUniao(corpo: (acervo: Acervo, m: Montagem) => void): void {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Teste').acervo;
    corpo(acervo, montarAcervoDaUniao(acervo));
  } finally {
    c.limpar();
  }
}

const NATUREZA = 'unir-conversas-do-contato';
const linha = (acervo: Acervo, sql: string, ...args: unknown[]): Record<string, unknown> | undefined =>
  acervo.db.prepare(sql).get(...args) as Record<string, unknown> | undefined;
const contarMensagens = (acervo: Acervo, conversaId: string): number =>
  (linha(acervo, 'SELECT COUNT(*) AS n FROM mensagens WHERE conversa_id = ?', conversaId) as { n: number }).n;
const enderecoDe = (acervo: Acervo, conversaId: string): string | undefined =>
  linha(acervo, 'SELECT id_externo FROM conversas WHERE id = ?', conversaId)?.['id_externo'] as string | undefined;
/** As Mensagens sem a coluna da Conversa: o que a uniao NAO pode mudar (identidade externa, conteudo, cru, instante, autor). */
const mensagensSemConversa = (acervo: Acervo): Record<string, string> =>
  Object.fromEntries(
    (acervo.db.prepare('SELECT * FROM mensagens ORDER BY id').all() as Array<Record<string, unknown>>).map((l) => {
      const { conversa_id: _c, ...resto } = l;
      return [l['id'] as string, JSON.stringify(resto)];
    }),
  );
const conflitosOrdenados = (r: RelatorioDaUniao): string[] =>
  r.conflitos.map((c) => `${c.motivo}|${c.configuracaoId}|${c.conversas.join(',')}`).sort();

test('o ensaio relata por caso, por Configuracao, e NAO escreve nada (hash por chave e trilha)', () => {
  comUniao((acervo, m) => {
    const antes = fotografar(acervo);
    const trilha = contarTrilha(acervo);
    const r = unirConversasDoContato(acervo, { comEfeito: false });
    assert.equal(r.opacasComPar, 8, 'a sem par fica de fora');
    assert.deepEqual(r.aMover, { conversas: 2, mensagens: 4 }, 'a opaca vazia sem marca nao entra');
    assert.deepEqual(r.aPromover, { conversas: 2, mensagens: 3, identificadoresARegistrar: 2, perdemONome: 1 });
    assert.equal(r.marcasALevar, 1);
    assert.deepEqual(
      conflitosOrdenados(r),
      [
        `alvo-ambiguo|${CFG_WHATSAPP.id}|${[m.conversa['opAmbiguo'], ...[m.conversa['ambiguoCom9']!, m.conversa['ambiguoSem9']!].sort()].join(',')}`,
        `varias-opacas-para-o-numero|${CFG_WHATSAPP.id}|${m.conversa['opDuas1']},${m.conversa['opDuas2']}`,
        `varias-opacas-para-o-numero|${CFG_WHATSAPP.id}|${m.conversa['opDuas2']},${m.conversa['opDuas1']}`,
      ].sort(),
    );
    assert.deepEqual(r.porConfiguracao, { [CFG_WHATSAPP.id]: { aMover: 2, aPromover: 2, conflitos: 3 } });
    assert.deepEqual(
      [r.movidas, r.mensagensMovidas, r.promovidas, r.identificadoresRegistrados, r.marcasLevadas, r.promovidasQueViraramMover],
      [0, 0, 0, 0, 0, 0],
    );
    assert.equal(r.operacaoId, null);
    assert.equal(r.gravou, false);
    assert.deepEqual(fotografar(acervo), antes);
    assert.deepEqual(contarTrilha(acervo), trilha);
  });
});

test('mover: toda Mensagem da opaca passa ao alvo, so a Conversa muda, a opaca fica vazia com as Participacoes, a marca vai junto', () => {
  comUniao((acervo, m) => {
    const antes = fotografar(acervo);
    const semConversa = mensagensSemConversa(acervo);
    const alvoAntes = contarMensagens(acervo, m.conversa['alvoMover']!);
    const opacaAntes = contarMensagens(acervo, m.conversa['opMover']!);
    const r = unirConversasDoContato(acervo, { comEfeito: true });
    assert.equal(r.movidas, 2);
    assert.equal(r.mensagensMovidas, 4);
    assert.equal(r.marcasLevadas, 1);
    assert.equal(contarMensagens(acervo, m.conversa['alvoMover']!), alvoAntes + opacaAntes);
    assert.equal(contarMensagens(acervo, m.conversa['opMover']!), 0);
    assert.equal(enderecoDe(acervo, m.conversa['opMover']!), OP_MOVER, 'a opaca nunca e apagada nem renomeada');
    assert.equal(contarMensagens(acervo, m.conversa['alvoOutraForma']!), 1, 'o alvo achado pela outra forma do numero');
    assert.deepEqual(mensagensSemConversa(acervo), semConversa, 'nas Mensagens so a Conversa muda');
    const depois = fotografar(acervo);
    for (const t of ['anexos', 'edicoes', 'chegadas', 'envios', 'participacoes', 'atribuicoes_de_nome', 'correspondencias_de_endereco']) {
      assert.deepEqual(depois[t], antes[t], `${t} igual`);
    }
    assert.deepEqual(
      acervo.db.prepare('SELECT conversa_id, marca FROM marcas_de_conversa').all(),
      [{ conversa_id: m.conversa['alvoMover'], marca: 'fixada' }],
    );
    assert.equal(linha(acervo, 'SELECT conversa_id FROM envios')?.['conversa_id'], m.conversa['opMover'], 'o Envio segue apontando para a opaca');
  });
});

test('a marca que o alvo ja tem fica na opaca: a do alvo vale, e nada e levado', () => {
  comUniao((acervo, m) => {
    acervo.db
      .prepare("INSERT INTO marcas_de_conversa (conversa_id, marca, configuracao_id, observada_em) VALUES (?, 'fixada', ?, ?)")
      .run(m.conversa['alvoMover'], CFG_WHATSAPP.id, AGORA);
    assert.equal(unirConversasDoContato(acervo, { comEfeito: false }).marcasALevar, 0);
    const r = unirConversasDoContato(acervo, { comEfeito: true });
    assert.equal(r.marcasLevadas, 0);
    assert.equal((linha(acervo, 'SELECT COUNT(*) AS n FROM marcas_de_conversa WHERE conversa_id = ?', m.conversa['opMover']) as { n: number }).n, 1);
  });
});

test('promover: o endereco vira o numero, o id, o cru, as Mensagens e as Participacoes ficam, e o Identificador do numero nasce sem Pessoa e sem nome', () => {
  comUniao((acervo, m) => {
    const antes = fotografar(acervo);
    const cruAntes = linha(acervo, 'SELECT bruto FROM conversas WHERE id = ?', m.conversa['opPromover'])?.['bruto'];
    const r = unirConversasDoContato(acervo, { comEfeito: true });
    assert.equal(r.promovidas, 2);
    assert.equal(r.identificadoresRegistrados, 2);
    assert.equal(enderecoDe(acervo, m.conversa['opPromover']!), TEL_PROMOVER);
    assert.equal(linha(acervo, 'SELECT bruto FROM conversas WHERE id = ?', m.conversa['opPromover'])?.['bruto'], cruAntes);
    const depois = fotografar(acervo);
    for (const id of Object.keys(antes['mensagens']!)) {
      const conversa = linha(acervo, 'SELECT conversa_id FROM mensagens WHERE id = ?', id)?.['conversa_id'];
      if (conversa === m.conversa['opPromover'] || conversa === m.conversa['opOutraCfg']) assert.equal(depois['mensagens']![id], antes['mensagens']![id]);
    }
    assert.deepEqual(depois['participacoes'], antes['participacoes']);
    assert.deepEqual(depois['chegadas'], antes['chegadas']);
    const numero = linha(acervo, "SELECT id, pessoa_id FROM identificadores WHERE fonte = 'whatsapp' AND valor = ?", TEL_PROMOVER);
    assert.equal(numero?.['pessoa_id'], null);
    assert.equal((linha(acervo, 'SELECT COUNT(*) AS n FROM atribuicoes_de_nome WHERE identificador_id = ?', numero?.['id']) as { n: number }).n, 0);
    // So dentro da Configuracao: a Conversa do numero da outra Configuracao nao recebe nada, e a opaca e promovida.
    assert.equal(enderecoDe(acervo, m.conversa['opOutraCfg']!), TEL_OUTRA_CFG);
    assert.equal(contarMensagens(acervo, m.conversa['outraCfgTel']!), 1);
    assert.equal(depois['conversas']![m.conversa['outraCfgTel']!], antes['conversas']![m.conversa['outraCfgTel']!]);
  });
});

test('conflito nao escreve: ambiguo e duas opacas ficam como estao, e a execucao segue com as demais', () => {
  comUniao((acervo, m) => {
    const antes = fotografar(acervo);
    unirConversasDoContato(acervo, { comEfeito: true });
    const depois = fotografar(acervo);
    for (const k of ['opAmbiguo', 'ambiguoCom9', 'ambiguoSem9', 'opDuas1', 'opDuas2', 'opSemPar', 'opVazia', 'alvoVazia']) {
      assert.equal(depois['conversas']![m.conversa[k]!], antes['conversas']![m.conversa[k]!], k);
    }
    for (const [id, h] of Object.entries(antes['mensagens']!)) {
      const c = linha(acervo, 'SELECT conversa_id FROM mensagens WHERE id = ?', id)?.['conversa_id'] as string;
      if ([m.conversa['opAmbiguo'], m.conversa['ambiguoSem9'], m.conversa['opDuas1'], m.conversa['opDuas2']].includes(c)) {
        assert.equal(depois['mensagens']![id], h);
      }
    }
  });
});

test('UMA Operacao por-efeito, com uma linha por Mensagem, marca, endereco e Identificador; e o nada-a-fazer nao abre Operacao', () => {
  comUniao((acervo) => {
    const r = unirConversasDoContato(acervo, { comEfeito: true });
    const ops = listarOperacoesCruas(acervo).filter((o) => o.natureza === NATUREZA);
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.reversibilidade, 'por-efeito');
    assert.equal(ops[0]!.id, r.operacaoId);
    const porTipo = new Map<string, number>();
    for (const l of linhasDaOperacao(acervo, r.operacaoId!)) porTipo.set(`${l.tabela}.${l.campo}`, (porTipo.get(`${l.tabela}.${l.campo}`) ?? 0) + 1);
    assert.deepEqual(Object.fromEntries(porTipo), {
      'mensagens.conversa_id': 4,
      'marcas_de_conversa.conversa_id': 1,
      'identificadores.id': 2,
      'conversas.id_externo': 2,
    });
    // Convergencia (criterio 9): o segundo ensaio acha 0 a mover e 0 a promover; os conflitos continuam la.
    const segundo = unirConversasDoContato(acervo, { comEfeito: false });
    assert.deepEqual([segundo.aMover.conversas, segundo.aPromover.conversas, segundo.marcasALevar], [0, 0, 0]);
    assert.equal(segundo.conflitos.length, 3);
    const terceiro = unirConversasDoContato(acervo, { comEfeito: true });
    assert.equal(terceiro.gravou, false);
    assert.equal(terceiro.operacaoId, null);
    assert.equal(listarOperacoesCruas(acervo).filter((o) => o.natureza === NATUREZA).length, 1, 'sem plano, sem Operacao');
  });
});

test('corrida: a Mensagem que chega a opaca entre o plano e a escrita tambem e movida (lida sob o lock)', () => {
  comUniao((acervo, m) => {
    const r = unirConversasDoContato(acervo, {
      comEfeito: true,
      ganchoDeTeste: {
        antesDeUma: (id) => {
          if (id !== m.conversa['opMover']) return;
          registrarMensagem(acervo, {
            origemDaChegada: 'ao-vivo',
            direcao: 'recebida',
            conversaId: id,
            fonte: 'whatsapp',
            idExterno: 'UNIAO-NO-MEIO',
            ocorridaEm: AGORA - 100,
            agora: AGORA,
          });
        },
      },
    });
    assert.equal(r.mensagensMovidas, 5);
    assert.equal(contarMensagens(acervo, m.conversa['opMover']!), 0);
  });
});

test('corrida: a Conversa do numero nasce entre o plano e a promocao: promover vira mover, sem erro de indice', () => {
  comUniao((acervo, m) => {
    let nova = '';
    const r = unirConversasDoContato(acervo, {
      comEfeito: true,
      ganchoDeTeste: {
        aposOPlano: () => {
          nova = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: TEL_PROMOVER, coletiva: false, configuracao: CFG_WHATSAPP });
        },
      },
    });
    assert.equal(r.promovidasQueViraramMover, 1);
    assert.equal(r.promovidas, 1, 'so a da outra Configuracao');
    assert.equal(r.movidas, 3);
    assert.equal(contarMensagens(acervo, nova), 2);
    assert.equal(enderecoDe(acervo, m.conversa['opPromover']!), OP_PROMOVER);
  });
});

test('corrida: a segunda forma do numero nasce entre o plano e o mover: vira alvo-ambiguo e nada e tocado', () => {
  comUniao((acervo, m) => {
    const r = unirConversasDoContato(acervo, {
      comEfeito: true,
      ganchoDeTeste: {
        aposOPlano: () => {
          registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '556599990041@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP });
        },
      },
    });
    assert.equal(contarMensagens(acervo, m.conversa['opMover']!), 3);
    assert.ok(r.conflitos.some((c) => c.motivo === 'alvo-ambiguo' && c.conversas[0] === m.conversa['opMover']));
  });
});

test('corrida: o par sai entre o plano e a escrita: a opaca nao e tocada, e nada vira mover para si mesma', () => {
  comUniao((acervo, m) => {
    const r = unirConversasDoContato(acervo, {
      comEfeito: true,
      ganchoDeTeste: { aposOPlano: () => void removerCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OP_PROMOVER, canonico: TEL_PROMOVER }) },
    });
    assert.equal(enderecoDe(acervo, m.conversa['opPromover']!), OP_PROMOVER);
    assert.equal(contarMensagens(acervo, m.conversa['opPromover']!), 2);
    assert.equal(r.promovidas, 1, 'so a da outra Configuracao');
    assert.ok(linhasDaOperacao(acervo, r.operacaoId!).every((l) => l.antes !== l.depois));
  });
});

test('corrida: outra execucao une no intervalo: a promovida ja nao e opaca e nao e tocada de novo', () => {
  comUniao((acervo, m) => {
    const r = unirConversasDoContato(acervo, {
      comEfeito: true,
      ganchoDeTeste: { aposOPlano: () => void unirConversasDoContato(acervo, { comEfeito: true }) },
    });
    assert.deepEqual([r.promovidas, r.movidas, r.mensagensMovidas, r.gravou, r.operacaoId], [0, 0, 0, false, null]);
    assert.equal(enderecoDe(acervo, m.conversa['opPromover']!), TEL_PROMOVER);
  });
});

test('--limite corta o plano em Conversas opacas, e repetir completa', () => {
  comUniao((acervo) => {
    const r = unirConversasDoContato(acervo, { comEfeito: true, limite: 1 });
    assert.equal(r.aMover.conversas + r.aPromover.conversas, 1);
    assert.equal(r.movidas + r.promovidas, 1);
    const resto = unirConversasDoContato(acervo, { comEfeito: true });
    assert.equal(resto.movidas + resto.promovidas, 3);
    for (const limite of [0, -1, 1.5]) assert.throws(() => unirConversasDoContato(acervo, { comEfeito: false, limite }), RangeError);
  });
});

/** Uma segunda conexao que segura o escritor (`BEGIN IMMEDIATE`): o ouvinte gravando no meio da uniao. */
function escritorDeFora(acervo: Acervo): { tomar: () => void; soltar: () => void } {
  const outra = new Database(acervo.db.name);
  return {
    tomar: () => {
      outra.exec('BEGIN IMMEDIATE');
    },
    soltar: () => {
      if (outra.inTransaction) outra.exec('ROLLBACK');
      outra.close();
    },
  };
}

test('o escritor de fora toma o banco no meio: interrompe com a Operacao parcial, o desfazer a desfaz, e repetir converge', () => {
  comUniao((acervo) => {
    acervo.db.pragma('busy_timeout = 50');
    const inicial = fotografar(acervo);
    const fora = escritorDeFora(acervo);
    let n = 0;
    let erro: unknown;
    try {
      unirConversasDoContato(acervo, { comEfeito: true, ganchoDeTeste: { antesDeUma: () => { n += 1; if (n === 2) fora.tomar(); } } });
    } catch (e) {
      erro = e;
    } finally {
      fora.soltar();
    }
    assert.ok(erro instanceof UniaoInterrompidaError, String(erro));
    assert.match(String(erro.causa), /locked|busy/i);
    assert.equal(erro.relatorio.movidas + erro.relatorio.promovidas, 1, 'a primeira Conversa ja estava gravada');
    assert.equal(erro.relatorio.operacaoId, erro.operacaoId);
    desfazerOperacao(acervo, erro.operacaoId);
    assert.deepEqual(fotografar(acervo), inicial);
    unirConversasDoContato(acervo, { comEfeito: true });
    const depois = unirConversasDoContato(acervo, { comEfeito: false });
    assert.deepEqual([depois.aMover.conversas, depois.aPromover.conversas], [0, 0]);
  });
});

test('uma transacao curta por Conversa: o que a primeira gravou ja esta visivel a outra conexao quando a segunda comeca', () => {
  comUniao((acervo) => {
    const leitor = new Database(acervo.db.name, { readonly: true });
    const vistas: number[] = [];
    try {
      unirConversasDoContato(acervo, {
        comEfeito: true,
        ganchoDeTeste: {
          antesDeUma: () => {
            vistas.push((leitor.prepare("SELECT COUNT(*) AS n FROM linhas_de_efeito l JOIN operacoes o ON o.id = l.operacao_id WHERE o.natureza = 'unir-conversas-do-contato'").get() as { n: number }).n);
          },
        },
      });
    } finally {
      leitor.close();
    }
    assert.equal(vistas.length, 4);
    assert.equal(vistas[0], 0);
    assert.ok(vistas[1]! > 0, `o ouvinte veria a primeira Conversa gravada: ${JSON.stringify(vistas)}`);
  });
});

test('o desfazer devolve o estado inicial (hash por chave) numa instalacao sem trafego novo', () => {
  comUniao((acervo) => {
    const inicial = fotografar(acervo);
    const r = unirConversasDoContato(acervo, { comEfeito: true });
    const d = desfazerOperacao(acervo, r.operacaoId!);
    assert.equal(d.recusados.length, 0, JSON.stringify(d.recusados));
    assert.equal(d.desfeitos, 9);
    assert.deepEqual(fotografar(acervo), inicial);
  });
});

test('o desfazer recusa, com a causa, o que mudou depois: a Mensagem movida de novo e o Identificador do numero que ganhou uso', () => {
  comUniao((acervo, m) => {
    const r = unirConversasDoContato(acervo, { comEfeito: true });
    const movidaDeNovo = (linha(acervo, 'SELECT id FROM mensagens WHERE conversa_id = ? ORDER BY id LIMIT 1', m.conversa['alvoOutraForma']) as { id: string }).id;
    acervo.db.prepare('UPDATE mensagens SET conversa_id = ? WHERE id = ?').run(m.conversa['opSemPar'], movidaDeNovo);
    receberEvento(
      acervo,
      [{ key: { remoteJid: TEL_PROMOVER, id: 'DEPOIS1', fromMe: false }, messageTimestamp: Math.floor(AGORA / 1000), message: { conversation: 'nova' } }],
      { origemDaChegada: 'ao-vivo', agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    const d = desfazerOperacao(acervo, r.operacaoId!);
    const causas = d.recusados.map((x) => x.causa).sort();
    assert.equal(causas.length, 2, JSON.stringify(d.recusados));
    assert.match(causas.join('\n'), /Mensagem ja nao esta na Conversa/);
    assert.match(causas.join('\n'), /Identificador ja tem uso/);
    assert.equal(linha(acervo, 'SELECT conversa_id FROM mensagens WHERE id = ?', movidaDeNovo)?.['conversa_id'], m.conversa['opSemPar']);
  });
});

test('recepcao real: depois de promover, a Mensagem nova pelo numero (as duas formas) e pelo endereco opaco cai na MESMA Conversa', () => {
  comUniao((acervo, m) => {
    unirConversasDoContato(acervo, { comEfeito: true });
    const opcoes = { origemDaChegada: 'ao-vivo' as const, agora: AGORA, configuracao: CFG_WHATSAPP };
    const quando = Math.floor(AGORA / 1000);
    const antes = contarMensagens(acervo, m.conversa['opPromover']!);
    receberEvento(
      acervo,
      [
        { key: { remoteJid: TEL_PROMOVER, id: 'REC1', fromMe: false }, messageTimestamp: quando, message: { conversation: 'pelo numero' } },
        { key: { remoteJid: TEL_PROMOVER_SEM9, id: 'REC2', fromMe: false }, messageTimestamp: quando, message: { conversation: 'sem o nove' } },
        { key: { remoteJid: OP_PROMOVER, id: 'REC3', fromMe: false, senderPn: TEL_PROMOVER }, messageTimestamp: quando, message: { conversation: 'pelo opaco' } },
        { key: { remoteJid: OP_MOVER, id: 'REC4', fromMe: false }, messageTimestamp: quando, message: { conversation: 'opaco movido' } },
        { key: { remoteJid: TEL_MOVER, id: 'REC5', fromMe: true }, messageTimestamp: quando, message: { conversation: 'numero movido' } },
      ],
      opcoes,
    );
    assert.equal(contarMensagens(acervo, m.conversa['opPromover']!), antes + 3);
    assert.equal(contarMensagens(acervo, m.conversa['alvoMover']!), 2 + 3 + 2);
    assert.equal(contarMensagens(acervo, m.conversa['opMover']!), 0, 'a opaca vazia nao recebe');
    assert.equal(
      (linha(acervo, "SELECT COUNT(*) AS n FROM conversas WHERE fonte = 'whatsapp' AND coletiva = 0 AND configuracao_id = ? AND id_externo IN (?, ?)", CFG_WHATSAPP.id, TEL_PROMOVER, TEL_PROMOVER_SEM9) as { n: number }).n,
      1,
      'nenhuma Conversa nova do numero',
    );
  });
});

test('o nome nao piora sem dizer: as promovidas que perdem o nome na listagem, no detalhe e na busca sao as que o ensaio contou', () => {
  comUniao((acervo, m) => {
    const nomes = (): Record<string, string | null> =>
      Object.fromEntries(listarConversas(acervo, { precedencia: PRECEDENCIA }).map((c) => [c.id, c.nome]));
    const buscar = (termo: string): string[] => listarConversas(acervo, { precedencia: PRECEDENCIA, busca: termo }).map((c) => c.id);
    const antes = nomes();
    assert.equal(antes[m.conversa['opPromover']!], 'Contato Promovido');
    assert.deepEqual(buscar('Promovido'), [m.conversa['opPromover']]);
    const ensaio = unirConversasDoContato(acervo, { comEfeito: false });
    unirConversasDoContato(acervo, { comEfeito: true });
    const depois = nomes();
    const perderam = [m.conversa['opPromover']!, m.conversa['opOutraCfg']!].filter((id) => antes[id] !== null && depois[id] === null);
    assert.equal(perderam.length, ensaio.aPromover.perdemONome);
    assert.equal(detalharConversa(acervo, m.conversa['opPromover']!, PRECEDENCIA)?.nome, null);
    assert.deepEqual(buscar('Promovido'), []);
    assert.equal(depois[m.conversa['alvoMover']!], 'Contato Movido', 'o alvo do mover nao perde');
  });
});

test('fronteira: o modulo nao toca tabela, nao chama o resolvedor que escreve e acha o endereco da promocao pelo par gravado', () => {
  const texto = readFileSync('src/adaptadores/whatsapp/unir-conversas-do-contato.ts', 'utf8');
  assert.doesNotMatch(texto, /\.prepare\(|\.preparar\(|\.exec\(/);
  assert.doesNotMatch(texto, /resolver-celular|resolverEnderecoDeWhatsapp|aprenderCorrespondencia/);
  assert.match(texto, /const destino = resolverEndereco\(acervo, FONTE, item\.opaco\)/);
});
