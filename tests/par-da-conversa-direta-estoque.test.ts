import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { linhasDaOperacao, listarOperacoesCruas } from '../src/nucleo/trilha.js';
import {
  aprenderParesDaConversaDireta,
  EstoqueDoParInterrompidoError,
} from '../src/adaptadores/whatsapp/aprender-pares-da-conversa-direta.js';

// #1439, Plano 2: o estoque aprende o par da forma opaca com o telefone do companheiro. Enderecos sinteticos; cada um e um caso.

const OP_SEM9 = '100000000000021@lid'; // o cru traz as duas formas do numero; nenhuma gravada: nasce o par do celular
const OP_GRAVADO = '100000000000022@lid'; // o cru traz a forma com o 9; a sem o 9 e Identificador: o canonico e a gravada
const OP_ESTRANGEIRO = '100000000000023@lid'; // outro pais: sem par do celular
const OP_CONFLITO_CRU = '100000000000024@lid'; // dois numeros no cru, o diferente na Mensagem mais antiga
const OP_JA = '100000000000025@lid'; // ja tem par com a outra forma do mesmo numero
const OP_OUTRO = '100000000000026@lid'; // ja tem par com outro numero
const OP_DUAS = '100000000000027@lid'; // o telefone tem as duas formas gravadas
const OP_SO_ENVIADAS = '100000000000028@lid';
const OP_SEM_CAMPO = '100000000000029@lid';
const OP_JA_DUAS = '100000000000030@lid'; // ja tem par, e o telefone tem as duas formas gravadas: o par existente vence
const OP_CELULAR_CONFLITO = '100000000000031@lid'; // a outra forma do celular e alternativa de um terceiro
const OP_CANONICO = '100000000000032@lid'; // o opaco ja e canonico de outro par

const N1_SEM = '556599991111@s.whatsapp.net';
const N1_COM = '5565999991111@s.whatsapp.net';
const N2_SEM = '556599992222@s.whatsapp.net'; // Identificador
const N2_COM = '5565999992222@s.whatsapp.net';
const ESTRANGEIRO = '14155550123@s.whatsapp.net';
const N4 = '556599994444@s.whatsapp.net';
const N5 = '556599995555@s.whatsapp.net';
const N5_COM = '5565999995555@s.whatsapp.net';
const N6_SEM = '556599996666@s.whatsapp.net';
const N7_SEM = '556599997777@s.whatsapp.net';
const N7_COM = '5565999997777@s.whatsapp.net';
const N8 = '556599998888@s.whatsapp.net';
const N10_SEM = '556599990010@s.whatsapp.net';
const N10_COM = '5565999990010@s.whatsapp.net';
const N11_SEM = '556599990011@s.whatsapp.net';
const N11_COM = '5565999990011@s.whatsapp.net';
const TERCEIRO = '556599990099@s.whatsapp.net';
const N12 = '556599990012@s.whatsapp.net';
const AGORA = 1_790_000_000_000;

let seq = 0;
const cru = (opaco: string, senderPn?: string): string =>
  JSON.stringify({
    key: { remoteJid: opaco, fromMe: false, id: `CRU${(seq += 1)}`, ...(senderPn === undefined ? {} : { senderPn }) },
    messageTimestamp: 1_789_000_000,
    message: { conversation: 'texto sintetico' },
  });

/** O Acervo do estoque: um caso por resposta do ensaio. */
function montar(acervo: Acervo): void {
  let n = 0;
  const conversa = (idExterno: string, cfg: typeof CFG_WHATSAPP | typeof CFG_WHATSAPP_SEGUNDA = CFG_WHATSAPP): string =>
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: false, configuracao: cfg });
  const recebida = (conversaId: string, opaco: string, bruto: string | undefined, instante: number): void => {
    n += 1;
    registrarMensagem(acervo, {
      origemDaChegada: 'ao-vivo',
      direcao: 'recebida',
      conversaId,
      fonte: 'whatsapp',
      idExterno: `r${n}`,
      autorId: registrarIdentificador(acervo, { fonte: 'whatsapp', valor: opaco }).id,
      ocorridaEm: instante,
      agora: AGORA,
      ...(bruto === undefined ? {} : { bruto }),
    });
  };
  const enviada = (conversaId: string, opaco: string): void => {
    n += 1;
    registrarMensagem(acervo, {
      origemDaChegada: 'ao-vivo',
      direcao: 'enviada',
      conversaId,
      fonte: 'whatsapp',
      idExterno: `e${n}`,
      ocorridaEm: AGORA - 10,
      agora: AGORA,
      // A biblioteca pode preencher o campo em qualquer Mensagem: a enviada nunca ensina.
      bruto: JSON.stringify({ key: { remoteJid: opaco, fromMe: true, id: `E${n}`, senderPn: N8 } }),
    });
  };

  const sem9 = conversa(OP_SEM9);
  recebida(sem9, OP_SEM9, cru(OP_SEM9, N1_SEM), AGORA - 900);
  recebida(sem9, OP_SEM9, cru(OP_SEM9, N1_COM), AGORA - 800); // a mais recente: a forma com o 9
  enviada(conversa(OP_SEM9, CFG_WHATSAPP_SEGUNDA), OP_SEM9); // o mesmo opaco na outra Configuracao

  registrarIdentificador(acervo, { fonte: 'whatsapp', valor: N2_SEM });
  conversa(N2_SEM); // a Conversa por telefone da mesma Configuracao: a partida
  recebida(conversa(OP_GRAVADO), OP_GRAVADO, cru(OP_GRAVADO, N2_COM), AGORA - 700);

  recebida(conversa(OP_ESTRANGEIRO), OP_ESTRANGEIRO, cru(OP_ESTRANGEIRO, ESTRANGEIRO), AGORA - 600);
  conversa(ESTRANGEIRO, CFG_WHATSAPP_SEGUNDA); // Conversa por telefone de OUTRA Configuracao: nao e partida

  const conflito = conversa(OP_CONFLITO_CRU);
  recebida(conflito, OP_CONFLITO_CRU, cru(OP_CONFLITO_CRU, N8), AGORA - 599);
  for (let i = 0; i < 6; i++) recebida(conflito, OP_CONFLITO_CRU, cru(OP_CONFLITO_CRU, N4), AGORA - 500 + i);

  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OP_JA, canonico: N5 });
  recebida(conversa(OP_JA), OP_JA, cru(OP_JA, N5_COM), AGORA - 400);

  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OP_OUTRO, canonico: N4 });
  recebida(conversa(OP_OUTRO), OP_OUTRO, cru(OP_OUTRO, N6_SEM), AGORA - 300);

  registrarIdentificador(acervo, { fonte: 'whatsapp', valor: N7_SEM });
  registrarIdentificador(acervo, { fonte: 'whatsapp', valor: N7_COM });
  recebida(conversa(OP_DUAS), OP_DUAS, cru(OP_DUAS, N7_COM), AGORA - 200);

  enviada(conversa(OP_SO_ENVIADAS), OP_SO_ENVIADAS);

  const semCampo = conversa(OP_SEM_CAMPO);
  recebida(semCampo, OP_SEM_CAMPO, cru(OP_SEM_CAMPO), AGORA - 100);
  // O cru de importacao: as colunas do backup, sem chave nem campo.
  recebida(semCampo, OP_SEM_CAMPO, JSON.stringify({ Z_PK: 7, ZTEXT: 'texto sintetico', ZFROMJID: OP_SEM_CAMPO }), AGORA - 90);
  recebida(semCampo, OP_SEM_CAMPO, undefined, AGORA - 80);
  recebida(semCampo, OP_SEM_CAMPO, 'nao e json', AGORA - 70);
  // Com sufixo de dispositivo: nao e o telefone do companheiro na forma que a spec aceita.
  recebida(semCampo, OP_SEM_CAMPO, cru(OP_SEM_CAMPO, '556599993333:7@s.whatsapp.net'), AGORA - 60);

  registrarIdentificador(acervo, { fonte: 'whatsapp', valor: N10_SEM });
  registrarIdentificador(acervo, { fonte: 'whatsapp', valor: N10_COM });
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OP_JA_DUAS, canonico: N10_COM });
  recebida(conversa(OP_JA_DUAS), OP_JA_DUAS, cru(OP_JA_DUAS, N10_COM), AGORA - 50);

  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: N11_COM, canonico: TERCEIRO });
  recebida(conversa(OP_CELULAR_CONFLITO), OP_CELULAR_CONFLITO, cru(OP_CELULAR_CONFLITO, N11_SEM), AGORA - 40);

  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: '100000000000099@lid', canonico: OP_CANONICO });
  recebida(conversa(OP_CANONICO), OP_CANONICO, cru(OP_CANONICO, N12), AGORA - 30);
}

function comEstoque(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    montar(acervo);
    corpo(acervo);
  } finally {
    c.limpar();
  }
}

const pares = (acervo: Acervo): Array<{ alternativo: string; canonico: string }> =>
  acervo.db.prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo').all() as Array<{
    alternativo: string;
    canonico: string;
  }>;

const DO_PRODUTO = ['conversas', 'mensagens', 'identificadores', 'participacoes', 'anexos', 'chegadas', 'diario_de_chegadas'];
const contagens = (acervo: Acervo, tabelas: string[]): Record<string, number> =>
  Object.fromEntries(tabelas.map((t) => [t, (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
const brutos = (acervo: Acervo): string => {
  const h = createHash('sha256');
  for (const t of ['conversas', 'mensagens']) {
    for (const l of acervo.db.prepare(`SELECT id, bruto FROM ${t} ORDER BY id`).all() as Array<{ id: string; bruto: string | null }>) {
      h.update(`${t}|${l.id}|${l.bruto ?? ''}\n`);
    }
  }
  return h.digest('hex');
};

/** Os cinco pares do efeito, em ordem de alternativo: dois do celular e tres do opaco. */
const OS_CINCO = [
  { alternativo: OP_SEM9, canonico: N1_COM },
  { alternativo: OP_GRAVADO, canonico: N2_SEM },
  { alternativo: OP_ESTRANGEIRO, canonico: ESTRANGEIRO },
  { alternativo: N1_SEM, canonico: N1_COM },
  { alternativo: N2_COM, canonico: N2_SEM },
];
const ordenar = <T extends { alternativo: string }>(l: T[]): T[] => [...l].sort((a, b) => (a.alternativo < b.alternativo ? -1 : 1));

test('o ensaio relata cada caso e nao escreve: nem par, nem Operacao, nem linha de efeito', () => {
  comEstoque((acervo) => {
    const antes = contagens(acervo, ['correspondencias_de_endereco', 'operacoes', 'linhas_de_efeito', ...DO_PRODUTO]);
    const r = aprenderParesDaConversaDireta(acervo, { comEfeito: false });
    assert.deepEqual(contagens(acervo, ['correspondencias_de_endereco', 'operacoes', 'linhas_de_efeito', ...DO_PRODUTO]), antes);
    assert.equal(r.examinadas, 13);
    assert.equal(r.comRecebida, 11);
    assert.equal(r.soComEnviadas, 2, 'a so de enviadas e a do mesmo opaco na outra Configuracao');
    assert.equal(r.recebidasSemOCampo, 5, 'sem o campo, de importacao, sem cru, cru ilegivel e com sufixo de dispositivo');
    assert.equal(r.conversasSemOCampo, 1);
    assert.equal(r.enderecosOpacos, 12);
    assert.equal(r.enderecosComTelefone, 10);
    assert.equal(r.paresDoOpacoJaIguais, 2, 'o par com a outra forma do mesmo numero e o mesmo par; e o par existente vence as duas formas');
    assert.equal(r.paresDoOpacoACriar, 3);
    assert.equal(r.paresDoCelularACriar, 2, 'o estrangeiro nao tem par do celular');
    assert.deepEqual(r.conflitos, [
      { opaco: OP_CONFLITO_CRU, motivo: 'mais-de-um-telefone-no-cru', telefones: [N4, N8] },
      { opaco: OP_OUTRO, motivo: 'par-existente-com-outro-canonico', telefones: [N4, N6_SEM] },
      { opaco: OP_CELULAR_CONFLITO, motivo: 'celular-em-conflito', telefones: [N11_SEM] },
      { opaco: OP_CANONICO, motivo: 'opaco-ja-canonico', telefones: [N12] },
    ]);
    assert.deepEqual(r.duasFormasGravadas, [{ opaco: OP_DUAS, formas: [N7_SEM, N7_COM] }]);
    assert.deepEqual(r.conversasOpacasQueCongelam, { [CFG_WHATSAPP.id]: 3, [CFG_WHATSAPP_SEGUNDA.id]: 1 });
    assert.equal(r.conversasPartidas.length, 1);
    assert.equal(r.conversasPartidas[0]?.configuracaoId, CFG_WHATSAPP.id);
    assert.deepEqual(r.criados, { doOpaco: 0, doCelular: 0 });
    assert.equal(r.operacaoId, null);
    assert.equal(r.gravou, false);
  });
});

test('com efeito, UMA Operacao por-efeito cria so as duas especies de par, contadas a parte, na direcao opaco para telefone resolvido', () => {
  comEstoque((acervo) => {
    const antes = pares(acervo);
    const r = aprenderParesDaConversaDireta(acervo, { comEfeito: true });
    assert.deepEqual(r.criados, { doOpaco: 3, doCelular: 2 });
    assert.equal(r.gravou, true);
    const depois = pares(acervo);
    assert.deepEqual(
      depois.filter((d) => !antes.some((a) => a.alternativo === d.alternativo)),
      ordenar(OS_CINCO),
    );
    for (const p of antes) assert.ok(depois.some((d) => d.alternativo === p.alternativo && d.canonico === p.canonico), 'par antigo intacto');
    for (const o of [OP_CONFLITO_CRU, OP_DUAS, OP_SEM_CAMPO, OP_SO_ENVIADAS, OP_CELULAR_CONFLITO, OP_CANONICO]) assert.ok(!depois.some((d) => d.alternativo === o), `${o}: sem par`);

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'aprender-pares-da-conversa-direta');
    assert.equal(operacoes.length, 1, 'uma Operacao para o estoque inteiro, nao uma por contato');
    assert.equal(operacoes[0]?.reversibilidade, 'por-efeito');
    assert.equal(r.operacaoId, operacoes[0]?.id);
    const linhas = linhasDaOperacao(acervo, r.operacaoId as string);
    assert.equal(linhas.length, 5);
    assert.ok(linhas.every((l) => l.tabela === 'correspondencias_de_endereco'));
  });
});

test('o estoque nao altera nada alem do par: contagens, Conteudo Bruto e Diario de Chegadas iguais', () => {
  comEstoque((acervo) => {
    const antes = contagens(acervo, DO_PRODUTO);
    const hash = brutos(acervo);
    aprenderParesDaConversaDireta(acervo, { comEfeito: true });
    assert.deepEqual(contagens(acervo, DO_PRODUTO), antes);
    assert.equal(brutos(acervo), hash);
  });
});

test('o desfazer remove as duas especies, e os pares que ja existiam ficam', () => {
  comEstoque((acervo) => {
    const antes = pares(acervo);
    const r = aprenderParesDaConversaDireta(acervo, { comEfeito: true });
    const d = desfazerOperacao(acervo, r.operacaoId as string);
    assert.equal(d.desfeitos, 5);
    assert.deepEqual(d.recusados, []);
    assert.deepEqual(pares(acervo), antes);
  });
});

test('repetir o comando nao cria linha nem abre Operacao', () => {
  comEstoque((acervo) => {
    aprenderParesDaConversaDireta(acervo, { comEfeito: true });
    const antes = contagens(acervo, ['correspondencias_de_endereco', 'operacoes', 'linhas_de_efeito']);
    const r = aprenderParesDaConversaDireta(acervo, { comEfeito: true });
    assert.equal(r.paresDoOpacoACriar, 0);
    assert.equal(r.paresDoOpacoJaIguais, 5);
    assert.deepEqual(r.criados, { doOpaco: 0, doCelular: 0 });
    assert.equal(r.operacaoId, null);
    assert.deepEqual(contagens(acervo, ['correspondencias_de_endereco', 'operacoes', 'linhas_de_efeito']), antes);
  });
});

test('em lotes de um, com o limite, o resultado se completa na segunda rodada', () => {
  comEstoque((acervo) => {
    const lotes: number[] = [];
    const r = aprenderParesDaConversaDireta(acervo, { comEfeito: true, tamanhoDoLote: 1, limite: 2, aoTerminarLote: (n) => lotes.push(n) });
    assert.equal(r.paresDoOpacoACriar, 2);
    assert.deepEqual(r.criados, { doOpaco: 2, doCelular: 2 });
    assert.deepEqual(lotes, [1, 1]);
    const resto = aprenderParesDaConversaDireta(acervo, { comEfeito: true });
    assert.deepEqual(resto.criados, { doOpaco: 1, doCelular: 0 });
  });
});

/** Uma segunda conexao que segura o escritor (`BEGIN IMMEDIATE`): o ouvinte gravando no meio do estoque. */
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

test('o escritor de fora toma o banco no meio dos lotes: interrompe com a Operacao e as duas contagens, e o desfazer da parcial remove o que entrou', () => {
  comEstoque((acervo) => {
    acervo.db.pragma('busy_timeout = 50');
    const antes = pares(acervo);
    const fora = escritorDeFora(acervo);
    let erro: unknown;
    try {
      aprenderParesDaConversaDireta(acervo, { comEfeito: true, tamanhoDoLote: 1, aoTerminarLote: (() => {
        let lotes = 0;
        return () => {
          lotes += 1;
          if (lotes === 1) fora.tomar();
        };
      })() });
    } catch (e) {
      erro = e;
    } finally {
      fora.soltar();
    }
    assert.ok(erro instanceof EstoqueDoParInterrompidoError, String(erro));
    assert.match(String(erro.causa), /locked|busy/i);
    assert.deepEqual(erro.criados, { doOpaco: 1, doCelular: 1 }, 'o primeiro lote ja estava gravado');
    assert.equal(linhasDaOperacao(acervo, erro.operacaoId).length, 2);
    desfazerOperacao(acervo, erro.operacaoId);
    assert.deepEqual(pares(acervo), antes);
  });
});

test('o banco ocupado na ABERTURA da Operacao sai cru, sem Operacao e sem par: nada foi escrito', () => {
  comEstoque((acervo) => {
    acervo.db.pragma('busy_timeout = 50');
    const antes = pares(acervo);
    const fora = escritorDeFora(acervo);
    let erro: unknown;
    try {
      aprenderParesDaConversaDireta(acervo, { comEfeito: true, ganchoDeTeste: { antesDosLotes: () => fora.tomar() } });
    } catch (e) {
      erro = e;
    } finally {
      fora.soltar();
    }
    assert.ok(erro instanceof Error && !(erro instanceof EstoqueDoParInterrompidoError), String(erro));
    assert.match(String(erro), /locked|busy/i);
    assert.equal(listarOperacoesCruas(acervo).filter((o) => o.natureza === 'aprender-pares-da-conversa-direta').length, 0);
    assert.deepEqual(pares(acervo), antes);
  });
});

test('o ouvinte aprende o mesmo opaco com OUTRO numero entre o plano e o lote: achado listado, e o lote continua', () => {
  comEstoque((acervo) => {
    const r = aprenderParesDaConversaDireta(acervo, {
      comEfeito: true,
      ganchoDeTeste: {
        antesDosLotes: () => aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OP_SEM9, canonico: N8 }),
      },
    });
    assert.deepEqual(r.conflitos.filter((c) => c.motivo === 'conflito-na-escrita'), [
      { opaco: OP_SEM9, motivo: 'conflito-na-escrita', telefones: [N8, N1_COM] },
    ]);
    assert.deepEqual(r.criados, { doOpaco: 2, doCelular: 1 });
    assert.ok(pares(acervo).some((p) => p.alternativo === OP_SEM9 && p.canonico === N8), 'o primeiro par fica');
  });
});

test('o ouvinte aprende o mesmo opaco com o MESMO numero no intervalo: nada a criar para ele, e nao e conflito', () => {
  comEstoque((acervo) => {
    const r = aprenderParesDaConversaDireta(acervo, {
      comEfeito: true,
      ganchoDeTeste: {
        antesDosLotes: () => aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OP_SEM9, canonico: N1_SEM }),
      },
    });
    assert.equal(r.conflitos.filter((c) => c.motivo === 'conflito-na-escrita').length, 0);
    assert.deepEqual(r.criados, { doOpaco: 2, doCelular: 1 });
  });
});

test('o ouvinte aprende tudo no intervalo: nada criado e nenhuma Operacao devolvida', () => {
  comEstoque((acervo) => {
    const r = aprenderParesDaConversaDireta(acervo, {
      comEfeito: true,
      ganchoDeTeste: {
        antesDosLotes: () => {
          for (const p of OS_CINCO) aprenderCorrespondencia(acervo, { fonte: 'whatsapp', ...p });
        },
      },
    });
    assert.deepEqual(r.criados, { doOpaco: 0, doCelular: 0 });
    assert.equal(r.operacaoId, null, 'nao ha o que desfazer');
    assert.equal(r.gravou, false);
    // A Operacao ja estava aberta quando o primeiro lote viu que nao havia o que criar: fica VAZIA na trilha (declarado).
    const vazias = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'aprender-pares-da-conversa-direta');
    assert.equal(vazias.length, 1);
    assert.equal(linhasDaOperacao(acervo, vazias[0]?.id as string).length, 0);
  });
});

test('limite e tamanho de lote invalidos lancam antes de ler', () => {
  comEstoque((acervo) => {
    for (const o of [{ limite: 0 }, { limite: 1.5 }, { tamanhoDoLote: 0 }]) {
      assert.throws(() => aprenderParesDaConversaDireta(acervo, { comEfeito: false, ...o }), RangeError);
    }
  });
});

test('sem Conversa opaca, o ensaio e o efeito sao vazios', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const r = aprenderParesDaConversaDireta(acervo, { comEfeito: true });
    assert.equal(r.examinadas, 0);
    assert.equal(r.operacaoId, null);
    assert.equal(listarOperacoesCruas(acervo).filter((o) => o.natureza === 'aprender-pares-da-conversa-direta').length, 0);
  } finally {
    c.limpar();
  }
});
