import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  codificarMarcador,
  decodificarMarcador,
  lerChegadas,
  MarcadorExpiradoError,
  MarcadorInvalidoError,
  pontoDePartida,
  registrarChegada,
} from '../src/nucleo/chegada.js';
import type { Acervo } from '../src/nucleo/acervo.js';

function epocaDe(acervo: Acervo): string {
  return (acervo.db.prepare('SELECT epoca FROM diario_de_chegadas').get() as { epoca: string }).epoca;
}

function gravar(acervo: Acervo, n: number): number[] {
  const seqs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    seqs.push(
      registrarChegada(acervo, { tipo: 'mensagem', origem: 'ao-vivo', criadoEm: 2, ocorridaEm: 1, alvoId: `m${String(i)}` }),
    );
  }
  return seqs;
}

/** Simula a aparagem: remove as Chegadas ate `ate` (inclusive) e sobe o Piso para `ate`. */
function aparar(acervo: Acervo, ate: number): void {
  acervo.db.prepare('DELETE FROM chegadas WHERE seq <= ?').run(ate);
  acervo.db.prepare('UPDATE diario_de_chegadas SET piso = ?').run(ate);
}

function expirado(motivo: string) {
  return (e: unknown) => e instanceof MarcadorExpiradoError && e.motivo === motivo;
}

test('o Marcador e opaco: codifica e decodifica a epoca e o numero, e recusa o que nao e Marcador', () => {
  const m = codificarMarcador({ epoca: 'e1', seq: 7 });
  assert.deepEqual(decodificarMarcador(m), { epoca: 'e1', seq: 7 });
  const ruins = [
    '',
    'nao-e-marcador',
    Buffer.from('[1,2]').toString('base64url'),
    Buffer.from('["e",-1]').toString('base64url'),
    Buffer.from('["e",1.5]').toString('base64url'),
    Buffer.from('["",1]').toString('base64url'),
    Buffer.from('{"a":1}').toString('base64url'),
  ];
  for (const ruim of ruins) assert.equal(decodificarMarcador(ruim), undefined, ruim);
});

test('Marcador malformado e erro de USO, distinto de expirado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    assert.throws(() => lerChegadas(acervo, { depois: 'lixo' }), MarcadorInvalidoError);
    assert.throws(() => lerChegadas(acervo, { depois: '' }), MarcadorInvalidoError);
    assert.ok(!(new MarcadorInvalidoError() instanceof MarcadorExpiradoError));
  } finally {
    c.limpar();
  }
});

test('o zero nunca e valido, mesmo num Diario recem-criado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const zero = codificarMarcador({ epoca: epocaDe(acervo), seq: 0 });
    assert.throws(() => lerChegadas(acervo, { depois: zero }), expirado('abaixo-do-piso'));
  } finally {
    c.limpar();
  }
});

test('o limite do Piso: depois de aparar 1..N o Marcador N e valido e o N-1 e expirado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const epoca = epocaDe(acervo);
    const seqs = gravar(acervo, 10);
    const n = seqs[4]!;
    aparar(acervo, n);
    const valido = lerChegadas(acervo, { depois: codificarMarcador({ epoca, seq: n }) });
    assert.deepEqual(
      valido.chegadas.map((x) => x.seq),
      seqs.slice(5),
      'o Marcador igual ao Piso le da proxima em diante',
    );
    assert.throws(() => lerChegadas(acervo, { depois: codificarMarcador({ epoca, seq: n - 1 }) }), expirado('abaixo-do-piso'));
  } finally {
    c.limpar();
  }
});

test('o limite da ultima Chegada: o Marcador igual a ultima e valido e o seguinte e expirado (Acervo restaurado de copia)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const epoca = epocaDe(acervo);
    const seqs = gravar(acervo, 3);
    const ultima = seqs[2]!;
    assert.deepEqual(lerChegadas(acervo, { depois: codificarMarcador({ epoca, seq: ultima }) }).chegadas, []);
    assert.throws(
      () => lerChegadas(acervo, { depois: codificarMarcador({ epoca, seq: ultima + 1 }) }),
      expirado('acima-da-ultima'),
    );
  } finally {
    c.limpar();
  }
});

test('Marcador de outra epoca e expirado, ainda que o numero caiba no Diario', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 3);
    assert.throws(() => lerChegadas(acervo, { depois: codificarMarcador({ epoca: 'outra', seq: 2 }) }), expirado('outra-epoca'));
  } finally {
    c.limpar();
  }
});

test('o ponto de partida e o Marcador da ultima Chegada gravada, valido e sem Chegada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    gravar(acervo, 4);
    const p = pontoDePartida(acervo);
    const decodificado = decodificarMarcador(p)!;
    assert.equal(decodificado.epoca, epocaDe(acervo));
    assert.equal(decodificado.seq, (acervo.db.prepare('SELECT MAX(seq) AS m FROM chegadas').get() as { m: number }).m);
    assert.deepEqual(lerChegadas(acervo, { depois: p }).chegadas, []);
  } finally {
    c.limpar();
  }
});
