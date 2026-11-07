// tests/reenvios.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import {
  criarGravadorDosReenvios,
  lerReenvios,
  linhaDoEventoDeReenvio,
  montarGanchoDoReenvio,
  type ContagemDeReenvios,
} from '../src/cli/reenvios.js';
import type { EventoDeReenvio } from '../src/adaptadores/whatsapp/conexao.js';

const T0 = Date.parse('2026-11-10T12:00:00Z');
const DIA = '2026-11-10';

const ZERO: ContagemDeReenvios = {
  pedidos: 0,
  achadosNaMemoria: 0,
  achadosNoAcervo: 0,
  naoAchados: 0,
  erros: 0,
  enderecoDiferente: 0,
  reciboFalhou: 0,
  recusadosPorLimite: 0,
  recusadosNaoPropria: 0,
};

const pedido = (
  resultado: 'achada-na-memoria' | 'achada-no-acervo' | 'nao-achada' | 'erro',
  enderecoDoRecibo: 'igual' | 'diferente' | 'desconhecido' = 'igual',
): EventoDeReenvio => ({ tipo: 'pedido', resultado, idadeSegundos: 30, enderecoDoRecibo });

/** Relogio e agenda manuais: o teste manda no tempo. */
function cenario(): {
  caminho: string;
  limpar: () => void;
  relogio: { t: number };
  agendadas: Array<{ f: () => void; ms: number; cancelada: boolean }>;
  avisos: string[];
  novo: (extra?: { intervaloMs?: number }) => ReturnType<typeof criarGravadorDosReenvios>;
} {
  const { raiz, limpar } = instalacaoTemporaria();
  const caminho = join(raiz, 'reenvios.json');
  const relogio = { t: T0 };
  const agendadas: Array<{ f: () => void; ms: number; cancelada: boolean }> = [];
  const avisos: string[] = [];
  return {
    caminho,
    limpar,
    relogio,
    agendadas,
    avisos,
    novo: (extra = {}) =>
      criarGravadorDosReenvios({
        caminho,
        agora: () => relogio.t,
        avisar: (l) => avisos.push(l),
        agendar: (f, ms) => {
          const a = { f, ms, cancelada: false };
          agendadas.push(a);
          return () => {
            a.cancelada = true;
          };
        },
        ...extra,
      }),
  };
}

const lido = (c: { caminho: string }): ReturnType<typeof lerReenvios> => lerReenvios(c.caminho);

test('lerReenvios: ausente, ilegivel, sem `desde` ou fora do contrato e null (indisponivel)', () => {
  const c = cenario();
  try {
    assert.equal(lido(c), null, 'ausente');
    writeFileSync(c.caminho, '{ nao e json');
    assert.equal(lido(c), null, 'ilegivel');
    writeFileSync(c.caminho, JSON.stringify({ dias: {} }));
    assert.equal(lido(c), null, 'sem desde');
    writeFileSync(c.caminho, JSON.stringify({ desde: 'ontem', dias: {} }));
    assert.equal(lido(c), null, 'desde que nao e instante');
    writeFileSync(c.caminho, JSON.stringify({ desde: '2026-11-10T00:00:00.000Z' }));
    assert.equal(lido(c), null, 'sem dias');
    writeFileSync(
      c.caminho,
      JSON.stringify({ desde: '2026-11-10T00:00:00.000Z', dias: { [DIA]: { ...ZERO, pedidos: 'x' } } }),
    );
    assert.equal(lido(c), null, 'contagem que nao e inteiro');
    writeFileSync(
      c.caminho,
      JSON.stringify({ desde: '2026-11-10T00:00:00.000Z', dias: { 'hoje': { ...ZERO } } }),
    );
    assert.equal(lido(c), null, 'chave de dia que nao e dia');
  } finally {
    c.limpar();
  }
});

test('lerReenvios: `desde` com `dias` vazio e "nenhum pedido", e NAO null; chave extra nao passa', () => {
  const c = cenario();
  try {
    writeFileSync(c.caminho, JSON.stringify({ desde: '2026-11-10T00:00:00.000Z', dias: {} }));
    assert.deepEqual(lido(c), { desde: '2026-11-10T00:00:00.000Z', dias: {} });
    writeFileSync(
      c.caminho,
      JSON.stringify({
        desde: '2026-11-10T00:00:00.000Z',
        jid: '5599900000000@s.whatsapp.net',
        dias: { [DIA]: { ...ZERO, pedidos: 1, texto: 'plantado' } },
      }),
    );
    const e = lido(c);
    assert.deepEqual(e, { desde: '2026-11-10T00:00:00.000Z', dias: { [DIA]: { ...ZERO, pedidos: 1 } } });
    assert.ok(!JSON.stringify(e).includes('plantado'));
    assert.ok(!JSON.stringify(e).includes('5599900000000'));
  } finally {
    c.limpar();
  }
});

test('abrir grava `desde` uma vez: com zero pedidos a leitura e "nenhum pedido", e a segunda abertura nao o muda', () => {
  const c = cenario();
  try {
    c.novo().abrir();
    assert.deepEqual(lido(c), { desde: new Date(T0).toISOString(), dias: {} });
    c.relogio.t = T0 + 3 * 86_400_000;
    c.novo().abrir();
    assert.equal(lido(c)?.desde, new Date(T0).toISOString(), 'o `desde` e de quando comecou a contar');
  } finally {
    c.limpar();
  }
});

test('abrir nao reescreve o arquivo que ja tem contagem', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.abrir();
    g.aoEvento(pedido('nao-achada'));
    g.parar();
    c.novo().abrir();
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 1);
  } finally {
    c.limpar();
  }
});

test('cada evento soma ao campo certo do balde do dia; pedidos e a soma dos quatro resultados', () => {
  const c = cenario();
  try {
    const g = c.novo({ intervaloMs: 0 });
    g.abrir();
    g.aoEvento(pedido('achada-na-memoria'));
    g.aoEvento(pedido('achada-no-acervo', 'diferente'));
    g.aoEvento(pedido('achada-no-acervo'));
    g.aoEvento(pedido('nao-achada', 'desconhecido'));
    g.aoEvento(pedido('erro'));
    g.aoEvento({ tipo: 'recibo-falhou' });
    g.aoEvento({ tipo: 'recusa', motivo: 'limite' });
    g.aoEvento({ tipo: 'recusa', motivo: 'limite' });
    g.aoEvento({ tipo: 'recusa', motivo: 'nao-propria' });
    g.parar();
    assert.deepEqual(lido(c)?.dias[DIA], {
      pedidos: 5,
      achadosNaMemoria: 1,
      achadosNoAcervo: 2,
      naoAchados: 1,
      erros: 1,
      enderecoDiferente: 1,
      reciboFalhou: 1,
      recusadosPorLimite: 2,
      recusadosNaoPropria: 1,
    });
  } finally {
    c.limpar();
  }
});

test('o balde e do dia UTC do EVENTO, mesmo que a escrita aconteca depois da virada', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.abrir();
    c.relogio.t = Date.parse('2026-11-10T23:59:58Z');
    g.aoEvento(pedido('nao-achada'));
    c.relogio.t = Date.parse('2026-11-10T23:59:59Z');
    g.aoEvento(pedido('nao-achada')); // estrangulado: so entra na escrita seguinte
    c.relogio.t = Date.parse('2026-11-11T00:00:01Z');
    g.aoEvento(pedido('nao-achada'));
    g.parar();
    const dias = lido(c)!.dias;
    assert.equal(dias['2026-11-10']?.pedidos, 2, 'o segundo pedido e do dia 10, gravado depois da virada');
    assert.equal(dias['2026-11-11']?.pedidos, 1);
  } finally {
    c.limpar();
  }
});

test('acumula ENTRE Conexoes e reinicios: um gravador novo soma ao que o anterior deixou, e o `desde` fica', () => {
  const c = cenario();
  try {
    const a = c.novo();
    a.abrir();
    a.aoEvento(pedido('achada-na-memoria'));
    a.aoEvento(pedido('nao-achada'));
    a.parar();
    c.relogio.t = T0 + 3_600_000;
    const b = c.novo();
    b.abrir();
    b.aoEvento(pedido('achada-no-acervo'));
    b.parar();
    const e = lido(c)!;
    assert.equal(e.desde, new Date(T0).toISOString());
    assert.equal(e.dias[DIA]?.pedidos, 3, 'o dia nao recomeca em zero a cada Conexao');
    assert.equal(e.dias[DIA]?.achadosNaMemoria, 1);
    assert.equal(e.dias[DIA]?.achadosNoAcervo, 1);
  } finally {
    c.limpar();
  }
});

test('estrangula: no maximo uma escrita a cada 5 s; o resto espera a agenda, que escreve ao vencer', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.abrir();
    g.aoEvento(pedido('nao-achada'));
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 1, 'o primeiro evento escreve na hora');
    c.relogio.t = T0 + 1_000;
    g.aoEvento(pedido('nao-achada'));
    c.relogio.t = T0 + 2_000;
    g.aoEvento(pedido('nao-achada'));
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 1, 'dentro da janela nao escreve');
    const pendentes = c.agendadas.filter((a) => !a.cancelada);
    assert.equal(pendentes.length, 1, 'UMA agenda para o que ficou, e nao uma por evento');
    assert.equal(pendentes[0]!.ms, 4_000, 'vence quando a janela de 5 s (contada do T0) fecha');
    c.relogio.t = T0 + 5_000;
    pendentes[0]!.f();
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 3, 'a agenda escreve o que ficou: sem ela um pedido isolado esperaria o proximo evento');
    c.relogio.t = T0 + 7_000;
    g.aoEvento(pedido('nao-achada'));
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 3, 'a janela conta da ultima TENTATIVA (T0+5000): ainda dentro');
    c.relogio.t = T0 + 10_000;
    g.aoEvento(pedido('nao-achada'));
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 5, 'fora da janela escreve na hora, com o que estava esperando');
  } finally {
    c.limpar();
  }
});

test('`kill` entre duas escritas perde so o que estava estrangulado', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.abrir();
    g.aoEvento(pedido('nao-achada'));
    c.relogio.t = T0 + 1_000;
    g.aoEvento(pedido('nao-achada'));
    g.aoEvento(pedido('nao-achada'));
    // sem parar(), sem a agenda: o processo morreu. O arquivo e o que ficou.
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 1);
    // O processo seguinte soma a partir do que ficou, sem zerar.
    const seguinte = c.novo();
    seguinte.abrir();
    seguinte.aoEvento(pedido('nao-achada'));
    seguinte.parar();
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 2);
  } finally {
    c.limpar();
  }
});

test('parar grava o que estiver pendente, cancela a agenda e e idempotente', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.abrir();
    g.aoEvento(pedido('nao-achada'));
    c.relogio.t = T0 + 1_000;
    g.aoEvento(pedido('erro'));
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 1);
    g.parar();
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 2, 'parar escreve o estrangulado');
    assert.equal(lido(c)?.dias[DIA]?.erros, 1);
    assert.ok(c.agendadas.every((a) => a.cancelada), 'a agenda pendente foi cancelada');
    g.parar();
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 2, 'segunda parada nao soma de novo');
  } finally {
    c.limpar();
  }
});

test('Conexao sem pedido nao escreve nada alem da abertura: parar sem evento nao toca o arquivo', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.abrir();
    const antes = readFileSync(c.caminho, 'utf8');
    c.relogio.t = T0 + 10 * 60_000;
    g.parar();
    assert.equal(readFileSync(c.caminho, 'utf8'), antes);
    assert.equal(c.agendadas.length, 0);
  } finally {
    c.limpar();
  }
});

test('poda o balde de mais de 30 dias e guarda o de 30', () => {
  const c = cenario();
  try {
    const dia = (n: number): string => new Date(T0 - n * 86_400_000).toISOString().slice(0, 10);
    writeFileSync(
      c.caminho,
      JSON.stringify({
        desde: '2026-09-01T00:00:00.000Z',
        dias: { [dia(31)]: { ...ZERO, pedidos: 7 }, [dia(30)]: { ...ZERO, pedidos: 5 }, [dia(1)]: { ...ZERO, pedidos: 2 } },
      }),
    );
    const g = c.novo();
    g.aoEvento(pedido('nao-achada'));
    g.parar();
    const dias = lido(c)!.dias;
    assert.ok(!(dia(31) in dias), 'o de 31 dias saiu');
    assert.equal(dias[dia(30)]?.pedidos, 5, 'o de 30 dias fica');
    assert.equal(dias[dia(1)]?.pedidos, 2);
    assert.equal(dias[DIA]?.pedidos, 1);
  } finally {
    c.limpar();
  }
});

test('escrita por troca atomica: nao sobra o arquivo parcial', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.abrir();
    g.aoEvento(pedido('nao-achada'));
    g.parar();
    assert.ok(!existsSync(`${c.caminho}.parcial`));
  } finally {
    c.limpar();
  }
});

test('falha de gravacao nunca derruba: avisa UMA vez so com o codigo, e o que ficou e gravado quando o destino volta', () => {
  const c = cenario();
  try {
    const { raiz, limpar } = instalacaoTemporaria();
    try {
      const sumido = join(raiz, 'nao-existe', 'reenvios.json');
      const avisos: string[] = [];
      const g = criarGravadorDosReenvios({
        caminho: sumido,
        agora: () => c.relogio.t,
        avisar: (l) => avisos.push(l),
        agendar: () => () => undefined,
      });
      assert.doesNotThrow(() => g.abrir());
      assert.doesNotThrow(() => g.aoEvento(pedido('nao-achada')));
      c.relogio.t += 6_000;
      assert.doesNotThrow(() => g.aoEvento(pedido('nao-achada')));
      assert.doesNotThrow(() => g.parar());
      assert.equal(avisos.length, 1, 'um aviso so, e nao um por tentativa');
      assert.match(avisos[0]!, /ENOENT/);
      assert.ok(!avisos[0]!.includes(raiz), 'a mensagem nao carrega caminho');
      mkdirSync(join(raiz, 'nao-existe'));
      c.relogio.t += 6_000;
      g.aoEvento(pedido('nao-achada'));
      g.parar();
      assert.equal(lerReenvios(sumido)?.dias[DIA]?.pedidos, 3, 'nada do que falhou se perdeu');
    } finally {
      limpar();
    }
  } finally {
    c.limpar();
  }
});

test('primeiro evento sem abertura (arquivo ausente) ou com arquivo ilegivel recomeca com `desde` de agora', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.aoEvento(pedido('nao-achada'));
    g.parar();
    assert.equal(lido(c)?.desde, new Date(T0).toISOString());
    writeFileSync(c.caminho, '{ corrompido');
    c.relogio.t = T0 + 86_400_000;
    const h = c.novo();
    h.aoEvento(pedido('erro'));
    h.parar();
    const e = lido(c)!;
    assert.equal(e.desde, new Date(T0 + 86_400_000).toISOString());
    assert.equal(e.dias['2026-11-11']?.erros, 1);
  } finally {
    c.limpar();
  }
});

test('relogio que volta para tras nao congela a escrita', () => {
  const c = cenario();
  try {
    const g = c.novo();
    g.abrir();
    g.aoEvento(pedido('nao-achada'));
    c.relogio.t = T0 - 60_000;
    g.aoEvento(pedido('nao-achada'));
    assert.equal(lido(c)?.dias[DIA]?.pedidos, 2);
  } finally {
    c.limpar();
  }
});

test('evento malformado ou de tipo desconhecido nao lanca nem conta', () => {
  const c = cenario();
  try {
    const g = c.novo({ intervaloMs: 0 });
    g.abrir();
    for (const ruim of [undefined, null, 7, {}, { tipo: 'outra-coisa' }, { tipo: 'pedido', resultado: 'inventado' }, { tipo: 'recusa', motivo: 'x' }]) {
      assert.doesNotThrow(() => g.aoEvento(ruim as unknown as EventoDeReenvio));
    }
    g.parar();
    assert.deepEqual(lido(c), { desde: new Date(T0).toISOString(), dias: {} });
  } finally {
    c.limpar();
  }
});

test('a linha de log do pedido: resultado, idade e igualdade do endereco, e NADA mais', () => {
  assert.equal(
    linhaDoEventoDeReenvio({ tipo: 'pedido', resultado: 'achada-no-acervo', idadeSegundos: 42.6, enderecoDoRecibo: 'igual' }),
    '[ouvinte] pedido de reenvio: achada-no-acervo idade=43s endereco=igual',
  );
  assert.equal(
    linhaDoEventoDeReenvio({ tipo: 'pedido', resultado: 'nao-achada', idadeSegundos: undefined, enderecoDoRecibo: 'desconhecido' }),
    '[ouvinte] pedido de reenvio: nao-achada idade=desconhecida endereco=desconhecido',
  );
  assert.equal(linhaDoEventoDeReenvio({ tipo: 'recibo-falhou' }), '[ouvinte] reenvio: o recibo falhou');
  assert.equal(
    linhaDoEventoDeReenvio({ tipo: 'recusa', motivo: 'nao-propria' }),
    '[ouvinte] reenvio: recusado pela biblioteca (nao-propria)',
  );
});

test('a linha de log nao carrega endereco, nome, texto nem identificador, mesmo que o evento traga campos a mais', () => {
  const JID = '5599900000000@s.whatsapp.net';
  const evento = {
    tipo: 'pedido',
    resultado: 'achada-na-memoria',
    idadeSegundos: 5,
    enderecoDoRecibo: 'igual',
    jid: JID,
    remoteJid: JID,
    id: '3EB0ABCDEF0123456789',
    nome: 'Fulana de Tal',
    texto: 'conteudo da conversa',
  } as unknown as EventoDeReenvio;
  const linha = linhaDoEventoDeReenvio(evento);
  assert.ok(linha !== undefined, 'o evento do contrato tem linha');
  for (const proibido of ['5599900000000', '@s.whatsapp.net', '3EB0ABCDEF', 'Fulana', 'conteudo da conversa']) {
    assert.ok(!linha.includes(proibido), `a linha carrega "${proibido}": ${linha}`);
  }
  assert.match(linha, /^\[ouvinte\] pedido de reenvio: achada-na-memoria idade=5s endereco=igual$/);
  // Valor fora da enumeracao nunca vira texto da linha.
  assert.equal(
    linhaDoEventoDeReenvio({ tipo: 'pedido', resultado: JID, idadeSegundos: -3, enderecoDoRecibo: 'x' } as unknown as EventoDeReenvio),
    undefined,
  );
});

test('o gancho do ouvir pergunta a porta com a Configuracao DO OUVINTE e a referencia pedida', () => {
  const perguntas: Array<[string, string]> = [];
  const gancho = montarGanchoDoReenvio({
    configuracaoId: 'cfg-do-ouvinte',
    lerBruto: (cfg, ref) => {
      perguntas.push([cfg, ref]);
      return ref === 'REF-DA-MENSAGEM-ENVIADA' ? '{"bruto":true}' : undefined;
    },
    gravador: { aoEvento: () => undefined },
    escrever: () => undefined,
  });
  assert.equal(gancho.lerDoAcervo('REF-DA-MENSAGEM-ENVIADA'), '{"bruto":true}');
  assert.equal(gancho.lerDoAcervo('OUTRA'), undefined);
  assert.deepEqual(perguntas, [
    ['cfg-do-ouvinte', 'REF-DA-MENSAGEM-ENVIADA'],
    ['cfg-do-ouvinte', 'OUTRA'],
  ]);
});

test('o gancho do ouvir leva o evento ao contador E ao log, e evento fora do contrato nao escreve linha', () => {
  const contados: EventoDeReenvio[] = [];
  const linhas: string[] = [];
  const gancho = montarGanchoDoReenvio({
    configuracaoId: 'cfg',
    lerBruto: () => undefined,
    gravador: { aoEvento: (e) => contados.push(e) },
    escrever: (l) => linhas.push(l),
  });
  gancho.aoEvento(pedido('achada-na-memoria'));
  gancho.aoEvento({ tipo: 'recibo-falhou' });
  gancho.aoEvento({ tipo: 'nada-disso' } as unknown as EventoDeReenvio);
  assert.equal(contados.length, 3, 'o contador decide o que conta');
  assert.deepEqual(linhas, [
    '[ouvinte] pedido de reenvio: achada-na-memoria idade=30s endereco=igual',
    '[ouvinte] reenvio: o recibo falhou',
  ]);
});
