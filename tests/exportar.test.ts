import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  conferirDestino,
  criarExportador,
  esperarEscoamento,
  lerPedidoDeExport,
  type AutorDeExport,
} from '../src/cli/exportar.js';
import type { MensagemLida } from '../src/nucleo/consulta.js';

const T = Date.parse('2026-06-01T12:30:05Z');

function msg(sobre: Partial<MensagemLida>): MensagemLida {
  return {
    id: 'm1',
    conversaId: 'c1',
    fonte: 'whatsapp',
    autorId: 'i-ana',
    conteudo: 'oi',
    ocorridaEm: T,
    direcao: 'recebida',
    anexos: [],
    ...sobre,
  };
}

const AUTORES: AutorDeExport[] = [
  { identificadorId: 'i-ana', valor: '5565111111111@s.whatsapp.net', nome: 'Ana' },
  { identificadorId: 'i-sem-nome', valor: '999@lid', nome: null },
];

function exportar(formato: 'txt' | 'json', mensagens: MensagemLida[], saida?: string) {
  const linhas: string[] = [];
  const e = criarExportador({
    formato,
    conversaId: 'c1',
    filtros: { remetente: '999@lid' },
    exportadoEm: '2026-10-04T12:00:00.000Z',
    autores: AUTORES,
    escrever: (l) => linhas.push(l),
    ...(saida !== undefined ? { saida } : {}),
  });
  e.acrescentar(mensagens);
  const r = e.concluir();
  return { linhas, r };
}

test('txt: o remetente e o nome, o valor sem nome, Eu, (sistema) e (remetente desconhecido) (#1129)', () => {
  // `(remetente desconhecido)` e so o autor que nao veio de `autores`: Mensagem que chegou depois da chamada.
  const { linhas } = exportar('txt', [
    msg({ id: 'a', conteudo: 'da Ana' }),
    msg({ id: 'b', autorId: 'i-sem-nome', conteudo: 'sem nome' }),
    msg({ id: 'c', direcao: 'enviada', conteudo: 'minha' }),
    msg({ id: 'd', autorId: null, conteudo: 'evento' }),
    msg({ id: 'e', autorId: 'i-ninguem', conteudo: 'quem?' }),
  ]);
  assert.deepEqual(linhas, [
    '2026-06-01 12:30:05  Ana: da Ana',
    '2026-06-01 12:30:05  999@lid: sem nome',
    '2026-06-01 12:30:05  Eu: minha',
    '2026-06-01 12:30:05  (sistema): evento',
    '2026-06-01 12:30:05  (remetente desconhecido): quem?',
  ]);
});

test('Mensagem enviada sem autor continua sendo (sistema): o evento nao e o Titular (#1129)', () => {
  const { linhas } = exportar('txt', [msg({ autorId: null, direcao: 'enviada', conteudo: 'evento meu' })]);
  assert.deepEqual(linhas, ['2026-06-01 12:30:05  (sistema): evento meu']);
});

test('txt: Mensagem multilinha recua as linhas seguintes, sem texto vira (sem texto), Anexo ganha linha com id (#1129)', () => {
  const { linhas } = exportar('txt', [
    msg({ conteudo: 'primeira\nsegunda\nterceira' }),
    msg({ id: 'x', conteudo: null }),
    msg({
      id: 'y',
      conteudo: 'olha',
      anexos: [
        { id: 'anx-1', tipo: 'document', presenca: 'nunca-obtido', nomeOriginal: 'contrato.pdf' },
        { id: 'anx-2', tipo: 'image', presenca: 'presente', nomeOriginal: null },
      ] as never,
    }),
  ]);
  assert.deepEqual(linhas, [
    '2026-06-01 12:30:05  Ana: primeira',
    '    segunda',
    '    terceira',
    '2026-06-01 12:30:05  Ana: (sem texto)',
    '2026-06-01 12:30:05  Ana: olha',
    '    [document nunca-obtido anx-1 contrato.pdf]',
    '    [image presente anx-2]',
  ]);
});

test('json: documento valido com a Conversa, os filtros, o instante e as Mensagens como a rota as devolve (#1129)', () => {
  const m = msg({ id: 'a' });
  const { linhas, r } = exportar('json', [m, msg({ id: 'b' })]);
  const doc = JSON.parse(linhas.join('\n'));
  assert.equal(doc.conversa, 'c1');
  assert.deepEqual(doc.filtros, { remetente: '999@lid' });
  assert.equal(doc.exportadoEm, '2026-10-04T12:00:00.000Z');
  assert.equal(doc.mensagens.length, 2);
  assert.deepEqual(doc.mensagens[0], JSON.parse(JSON.stringify(m)));
  assert.equal(r.mensagens, 2);
});

test('json sem Mensagem continua sendo um documento valido (#1129)', () => {
  const { linhas } = exportar('json', []);
  assert.deepEqual(JSON.parse(linhas.join('\n')).mensagens, []);
});

test('com --saida o arquivo nasce parcial e so vira definitivo no fim (#1129)', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'exportar-'));
  const saida = join(pasta, 'conversa.txt');
  const e = criarExportador({
    formato: 'txt',
    conversaId: 'c1',
    filtros: {},
    exportadoEm: 'x',
    autores: AUTORES,
    escrever: () => assert.fail('com --saida nada vai para a saida padrao'),
    saida,
  });
  e.acrescentar([msg({ conteudo: 'um' })]);
  assert.ok(existsSync(`${saida}.parcial`), 'durante o export so existe o parcial');
  assert.ok(!existsSync(saida));
  const r = e.concluir();
  assert.ok(existsSync(saida));
  assert.ok(!existsSync(`${saida}.parcial`));
  assert.equal(r.mensagens, 1);
  assert.equal(readFileSync(saida, 'utf8'), '2026-06-01 12:30:05  Ana: um\n');
});

test('falhar deixa o parcial, nunca o arquivo que parece completo, e diz onde esta o parcial (#1129)', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'exportar-'));
  const saida = join(pasta, 'conversa.json');
  const e = criarExportador({
    formato: 'json',
    conversaId: 'c1',
    filtros: {},
    exportadoEm: 'x',
    autores: AUTORES,
    escrever: () => undefined,
    saida,
  });
  e.acrescentar([msg({})]);
  const parcial = e.falhar();
  assert.equal(parcial, `${saida}.parcial`);
  assert.ok(existsSync(parcial!));
  assert.ok(!existsSync(saida));
});

test('--saida que ja existe e recusada, salvo --sobrescrever; o parcial de uma falha antiga nao atrapalha (#1129)', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'exportar-'));
  const saida = join(pasta, 'conversa.txt');
  assert.equal(conferirDestino(saida, false), undefined);
  writeFileSync(saida, 'antigo');
  assert.match(conferirDestino(saida, false) as string, /ja existe/);
  assert.equal(conferirDestino(saida, true), undefined);
  assert.equal(conferirDestino(undefined, false), undefined);
  writeFileSync(`${saida}.parcial`, 'resto de uma falha');
  assert.equal(conferirDestino(saida, true), undefined);
  const e = criarExportador({
    formato: 'txt',
    conversaId: 'c1',
    filtros: {},
    exportadoEm: 'x',
    autores: AUTORES,
    escrever: () => undefined,
    saida,
  });
  e.acrescentar([msg({ conteudo: 'novo' })]);
  e.concluir();
  assert.equal(readFileSync(saida, 'utf8'), '2026-06-01 12:30:05  Ana: novo\n', 'sobrescreveu o definitivo');
});

test('lerPedidoDeExport: padroes, --json, conflito de formato e datas invalidas (#1129)', () => {
  const ok = lerPedidoDeExport(['exportar', '--conversa', 'c1']);
  assert.ok('pedido' in ok);
  assert.deepEqual([ok.pedido.formato, ok.pedido.saida, ok.pedido.sobrescrever], ['txt', undefined, false]);
  assert.equal(
    (lerPedidoDeExport(['exportar', '--conversa', 'c1', '--json']) as { pedido: { formato: string } }).pedido.formato,
    'json',
  );
  assert.equal(
    (lerPedidoDeExport(['exportar', '--conversa', 'c1', '--formato', 'json']) as { pedido: { formato: string } }).pedido
      .formato,
    'json',
  );
  for (const argumentos of [
    ['exportar'],
    ['exportar', '--conversa', 'c1', '--formato', 'html'],
    ['exportar', '--conversa', 'c1', '--formato', 'txt', '--json'],
    ['exportar', '--conversa', 'c1', '--desde', 'ontem'],
    ['exportar', '--conversa', 'c1', '--remetente', ''],
  ]) {
    assert.ok('erro' in lerPedidoDeExport(argumentos), argumentos.join(' '));
  }
});

test('esperarEscoamento so volta depois do drain quando o buffer esta cheio, e volta na hora quando nao (#1129)', async () => {
  const cheio = Object.assign(new EventEmitter(), { writableNeedDrain: true }) as unknown as NodeJS.WriteStream;
  let voltou = false;
  const espera = esperarEscoamento(cheio).then(() => {
    voltou = true;
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(voltou, false, 'buffer cheio: segura ate o drain');
  cheio.emit('drain');
  await espera;
  assert.equal(voltou, true);
  const livre = Object.assign(new EventEmitter(), { writableNeedDrain: false }) as unknown as NodeJS.WriteStream;
  await esperarEscoamento(livre);
});
