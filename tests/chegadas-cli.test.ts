import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatarChegadas, lerPedidoDeChegadas } from '../src/cli/chegadas.js';
import { BANDEIRAS } from '../src/cli/bandeiras.js';
import type { ChegadaComConteudo } from '../src/nucleo/chegadas-com-conteudo.js';
import type { MensagemLida } from '../src/nucleo/consulta.js';

test('--ponto-de-partida e --com-conteudo sao bandeiras: nao consomem o argumento seguinte', () => {
  assert.equal(BANDEIRAS.has('ponto-de-partida'), true);
  assert.equal(BANDEIRAS.has('com-conteudo'), true);
  const r = lerPedidoDeChegadas(['chegadas', '--ponto-de-partida', '--json']);
  assert.deepEqual(r, {
    ok: true,
    pedido: { pontoDePartida: true, semRemetente: [], tipos: [], origens: [], comConteudo: false },
  });
});

test('os filtros entram no pedido', () => {
  const r = lerPedidoDeChegadas([
    'chegadas', '--depois', 'M1', '--conversa', 'c1', '--configuracao', 'principal', '--direcao', 'recebida',
    '--remetente', '5565911110001@s.whatsapp.net', '--sem-remetente', 'a@s.whatsapp.net', '--sem-remetente', 'b@s.whatsapp.net',
    '--tipo', 'mensagem,edicao', '--origem', 'ao-vivo,reprocesso', '--limite', '20', '--com-conteudo',
  ]);
  assert.deepEqual(r, {
    ok: true,
    pedido: {
      pontoDePartida: false,
      depois: 'M1',
      conversa: 'c1',
      configuracao: 'principal',
      direcao: 'recebida',
      remetente: '5565911110001@s.whatsapp.net',
      semRemetente: ['a@s.whatsapp.net', 'b@s.whatsapp.net'],
      tipos: ['mensagem', 'edicao'],
      origens: ['ao-vivo', 'reprocesso'],
      limite: 20,
      comConteudo: true,
    },
  });
});

test('exatamente um entre --depois e --ponto-de-partida', () => {
  for (const args of [['chegadas'], ['chegadas', '--json'], ['chegadas', '--limite', '5']]) {
    const r = lerPedidoDeChegadas(args);
    assert.equal(r.ok, false, args.join(' '));
    if (!r.ok) assert.match(r.erro, /--depois <marcador>.*--ponto-de-partida/);
  }
  const ambos = lerPedidoDeChegadas(['chegadas', '--depois', 'M1', '--ponto-de-partida']);
  assert.equal(ambos.ok, false);
  if (!ambos.ok) assert.match(ambos.erro, /se contradizem/);
});

test('o ponto de partida nao aceita filtro nem --com-conteudo', () => {
  for (const extra of [
    ['--conversa', 'c1'],
    ['--configuracao', 'x'],
    ['--direcao', 'enviada'],
    ['--remetente', 'x'],
    ['--sem-remetente', 'x'],
    ['--tipo', 'mensagem'],
    ['--origem', 'ao-vivo'],
    ['--limite', '5'],
    ['--com-conteudo'],
  ]) {
    const r = lerPedidoDeChegadas(['chegadas', '--ponto-de-partida', ...extra]);
    assert.equal(r.ok, false, extra.join(' '));
    if (!r.ok) assert.match(r.erro, /nao aceita filtros/);
  }
});

test('flag sem valor e valor fora do conjunto sao erro de uso, nunca ignorados em silencio (#1136)', () => {
  const ruins: string[][] = [
    ['chegadas', '--depois'],
    ['chegadas', '--depois', '--json'],
    ['chegadas', '--depois', 'M1', '--conversa'],
    ['chegadas', '--depois', 'M1', '--sem-remetente', '--json'],
    ['chegadas', '--depois', 'M1', '--direcao', 'lateral'],
    ['chegadas', '--depois', 'M1', '--tipo', 'revogacao'],
    ['chegadas', '--depois', 'M1', '--tipo', 'mensagem,revogacao'],
    ['chegadas', '--depois', 'M1', '--origem', 'pendentes'],
    ['chegadas', '--depois', 'M1', '--limite', '0'],
    ['chegadas', '--depois', 'M1', '--limite', 'abc'],
    ['chegadas', '--depois', 'M1', '--limite', '501'],
  ];
  for (const args of ruins) assert.equal(lerPedidoDeChegadas(args).ok, false, args.join(' '));
  const limiteNoTeto = lerPedidoDeChegadas(['chegadas', '--depois', 'M1', '--limite', '500']);
  assert.equal(limiteNoTeto.ok, true, '500 e o maximo e vale');
});

test('a saida em texto: uma linha por Chegada, o conteudo resumido, a ausente marcada, e a ultima linha traz o Marcador', () => {
  const base = {
    tipo: 'mensagem' as const,
    origem: 'ao-vivo' as const,
    criadoEm: Date.parse('2026-10-26T12:00:00Z'),
    ocorridaEm: Date.parse('2026-10-26T11:59:00Z'),
    conversaId: 'c1',
    mensagemId: 'm1',
    autorId: 'i1',
    direcao: 'recebida' as const,
    alvoId: 'm1',
  };
  const mensagemLida = (texto: string | null, textoAtual?: string) =>
    ({
      id: 'm1',
      conversaId: 'c1',
      fonte: 'whatsapp',
      autorId: 'i1',
      conteudo: texto,
      ocorridaEm: base.ocorridaEm,
      direcao: 'recebida',
      anexos: [],
      contatosCompartilhados: [],
      edicoes: [],
      citacao: null,
      ...(textoAtual !== undefined ? { textoAtual } : {}),
    }) as MensagemLida;
  const chegadas: ChegadaComConteudo[] = [
    { ...base, seq: 10 },
    { ...base, seq: 11, conteudo: mensagemLida('texto\n\ncom   quebras') },
    { ...base, seq: 12, conteudo: mensagemLida('antes', 'depois') },
    { ...base, seq: 13, conteudo: null },
    { ...base, seq: 14, conteudo: mensagemLida(null) },
    { ...base, seq: 15, conteudo: mensagemLida('y'.repeat(200)) },
    { ...base, seq: 16, tipo: 'etiqueta', origem: 'importacao', mensagemId: null, direcao: null },
  ];
  const linhas = formatarChegadas({ chegadas, proximo: 'MARCADOR' });
  assert.equal(linhas.length, 8);
  assert.match(linhas[0]!, /^10 {2}2026-10-26T12:00:00.000Z {2}mensagem {2}ao-vivo {2}c1 {2}i1 {2}recebida$/);
  assert.match(linhas[1]!, /texto com quebras$/);
  assert.match(linhas[2]!, / depois$/, 'o texto atual vence o original');
  assert.match(linhas[3]!, /\(mensagem ausente\)$/);
  assert.match(linhas[4]!, /\(sem texto\)$/);
  assert.ok(linhas[5]!.endsWith('…') && linhas[5]!.length < 200, 'o texto longo e cortado numa linha');
  assert.match(linhas[6]!, /^16 {2}.*etiqueta {2}importacao {2}c1 {2}i1 {2}-$/);
  assert.equal(linhas[7], '# proximo MARCADOR');
});
