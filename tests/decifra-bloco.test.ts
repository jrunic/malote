// tests/decifra-bloco.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { caminhoDoRegistroAnterior, lerBlocoDaDecifra } from '../src/cli/decifra.js';

const AGORA = Date.parse('2026-11-20T18:00:00Z');
const HORA = 60 * 60 * 1000;

function comPasta<T>(f: (pasta: string) => T): T {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-decifra-bloco-'));
  try {
    return f(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
const iso = (ms: number): string => new Date(ms).toISOString();
const falha = (id: string, em: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ t: 'falha', em: iso(em), id, conversa: 'g@g.us', direcao: 'recebida', tipo: 'grupo', causa: 'sem-sessao', jaGravada: false, ...extra });
const situacao = (id: string, em: number, s: string) => JSON.stringify({ t: 'situacao', em: iso(em), id, situacao: s });
const contadores = (pasta: string, extra: Record<string, unknown> = {}): { registro: string; contadores: string } => {
  writeFileSync(join(pasta, 'decifra.json'), JSON.stringify({ desde: '2026-11-19T00:00:00.000Z', falhasDeRegistro: 0, ...extra }));
  return { registro: join(pasta, 'decifra.jsonl'), contadores: join(pasta, 'decifra.json') };
};

test('soma por situacao, direcao, tipo e causa, no dia UTC da primeira falha, e separa a perda', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    const dia = Date.parse('2026-11-20T10:00:00Z');
    writeFileSync(
      c.registro,
      [
        falha('GRAVADA', dia, { jaGravada: true }),
        falha('RECUP', dia),
        situacao('RECUP', dia + 5_000, 'recuperada'),
        falha('PERDIDA-GRUPO', dia),
        situacao('PERDIDA-GRUPO', dia + HORA, 'perdida'),
        falha('PERDIDA-MINHA', dia, { direcao: 'enviada', tipo: 'direta-opaca', causa: 'reentrega' }),
        situacao('PERDIDA-MINHA', dia + HORA, 'perdida'),
        falha('PERDIDA-STATUS', dia, { tipo: 'status-e-outros' }),
        situacao('PERDIDA-STATUS', dia + HORA, 'perdida'),
        falha('ABERTA', AGORA - 10 * 60_000),
      ].join('\n') + '\n',
    );
    const { bloco } = lerBlocoDaDecifra(c, AGORA);
    const d = bloco?.dias['2026-11-20'];
    assert.deepEqual(d?.total, { jaGravada: 1, recuperada: 1, perdida: 3, incerta: 0, aberta: 1 });
    assert.equal(d?.perdaRecebida, 1, 'so a perdida RECEBIDA de conversa que vira Mensagem; status fica fora');
    assert.equal(d?.perdaEnviadaPorOutroAparelho, 1);
    assert.equal(d?.porDirecao.enviada.perdida, 1);
    assert.equal(d?.porTipo['status-e-outros'].perdida, 1);
    assert.deepEqual(d?.porCausa, { 'sem-sessao': 5, reentrega: 1 });
    assert.equal(bloco?.vencidasSemReconferencia, 0);
  }));

test('a primeira falha vale: duas linhas do mesmo id em dias diferentes contam uma, no dia da primeira', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    writeFileSync(c.registro, [falha('X', Date.parse('2026-11-20T23:59:00Z')), falha('X', Date.parse('2026-11-21T00:01:00Z'))].join('\n') + '\n');
    const { bloco } = lerBlocoDaDecifra(c, AGORA);
    assert.deepEqual(Object.keys(bloco?.dias ?? {}), ['2026-11-20']);
    assert.equal(bloco?.dias['2026-11-20']?.total.aberta, 1);
  }));

test('so a primeira situacao final vale', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    const dia = Date.parse('2026-11-20T10:00:00Z');
    writeFileSync(c.registro, [falha('X', dia), situacao('X', dia + HORA, 'perdida'), situacao('X', dia + 2 * HORA, 'recuperada')].join('\n') + '\n');
    assert.equal(lerBlocoDaDecifra(c, AGORA).bloco?.dias['2026-11-20']?.total.perdida, 1);
  }));

test('aberta com mais de 1 hora entra em vencidasSemReconferencia (o ouvinte esteve parado)', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    writeFileSync(c.registro, falha('X', AGORA - 3 * HORA) + '\n');
    const { bloco } = lerBlocoDaDecifra(c, AGORA);
    assert.equal(bloco?.vencidasSemReconferencia, 1);
    assert.equal(bloco?.dias['2026-11-20']?.total.aberta, 1);
  }));

test('soma o anterior e o atual, e casa a situacao do atual com a falha do anterior', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    const dia = Date.parse('2026-11-20T10:00:00Z');
    writeFileSync(caminhoDoRegistroAnterior(c.registro), falha('X', dia) + '\n');
    writeFileSync(c.registro, situacao('X', dia + HORA, 'perdida') + '\n');
    assert.equal(lerBlocoDaDecifra(c, AGORA).bloco?.dias['2026-11-20']?.total.perdida, 1);
  }));

test('contadores ausentes ou ilegiveis: bloco nulo COM motivo, nunca zeros', () =>
  comPasta((pasta) => {
    const c = { registro: join(pasta, 'decifra.jsonl'), contadores: join(pasta, 'decifra.json') };
    let r = lerBlocoDaDecifra(c, AGORA);
    assert.equal(r.bloco, null);
    assert.match(r.motivo ?? '', /contadores/);
    writeFileSync(c.contadores, '{ nao e json');
    r = lerBlocoDaDecifra(c, AGORA);
    assert.equal(r.bloco, null);
    writeFileSync(c.contadores, JSON.stringify({ falhasDeRegistro: 0 }));
    assert.equal(lerBlocoDaDecifra(c, AGORA).bloco, null, 'sem `desde`');
  }));

test('registro ausente com contadores presentes e "nenhuma falha desde `desde`"', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    const { bloco } = lerBlocoDaDecifra(c, AGORA);
    assert.deepEqual(bloco?.dias, {});
    assert.equal(bloco?.desde, '2026-11-19T00:00:00.000Z');
  }));

test('registro ilegivel (nao e ausencia) devolve nulo com motivo', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    writeFileSync(c.registro, falha('X', AGORA));
    chmodSync(c.registro, 0o000);
    try {
      if (process.getuid?.() === 0) return; // root le tudo: o caso nao existe
      const r = lerBlocoDaDecifra(c, AGORA);
      assert.equal(r.bloco, null);
      assert.match(r.motivo ?? '', /ilegivel/);
    } finally {
      chmodSync(c.registro, 0o600);
    }
  }));

test('falhasDeRegistro ilegivel vira nulo so nele; linha invalida e contada e ignorada', () =>
  comPasta((pasta) => {
    const c = contadores(pasta, { falhasDeRegistro: 'x' });
    writeFileSync(c.registro, ['lixo', falha('X', AGORA - HORA / 2), JSON.stringify({ t: 'falha', id: 'sem-instante' })].join('\n') + '\n');
    const { bloco } = lerBlocoDaDecifra(c, AGORA);
    assert.equal(bloco?.falhasDeRegistro, null);
    assert.equal(bloco?.linhasInvalidas, 2);
    assert.equal(Object.values(bloco?.dias ?? {})[0]?.total.aberta, 1);
  }));

test('a causa outra leva os textos mais frequentes, sem digitos', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    writeFileSync(
      c.registro,
      [falha('A', AGORA, { causa: 'outra', textoDaCausa: 'erro estranho' }), falha('B', AGORA, { causa: 'outra', textoDaCausa: 'erro estranho' })].join('\n') + '\n',
    );
    assert.deepEqual(lerBlocoDaDecifra(c, AGORA).bloco?.textosDaCausaOutra, { 'erro estranho': 2 });
  }));

test('custo: dois arquivos de ~5 MiB sao lidos sem explosao de tempo (o criterio de 1 s e da bancada)', () =>
  comPasta((pasta) => {
    const c = contadores(pasta);
    const dia = Date.parse('2026-11-20T10:00:00Z');
    const bloco = (prefixo: string): string => {
      const out: string[] = [];
      let bytes = 0;
      for (let i = 0; bytes < 5 * 1024 * 1024; i += 1) {
        const a = falha(`${prefixo}${i}`, dia + i);
        const b = situacao(`${prefixo}${i}`, dia + i + 2_000, 'recuperada');
        out.push(a, b);
        bytes += a.length + b.length + 2;
      }
      return out.join('\n') + '\n';
    };
    writeFileSync(caminhoDoRegistroAnterior(c.registro), bloco('A'));
    writeFileSync(c.registro, bloco('B'));
    const t0 = process.hrtime.bigint();
    const { bloco: b } = lerBlocoDaDecifra(c, AGORA);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok((b?.dias['2026-11-20']?.total.recuperada ?? 0) > 10_000);
    // Guarda contra explosao quadratica, nao o criterio: o de 1 s (critério 7 da spec) se mede na bancada, sem carga paralela.
    assert.ok(ms < 10_000, `leu em ${ms.toFixed(0)} ms`);
  }));
