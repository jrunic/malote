import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  familiasDeIdentificadores,
  SQL_ALTERNATIVAS_DOS_CANONICOS,
  SQL_CANONICO_DAS_FORMAS,
  SQL_GRAVADOS_DAS_FORMAS,
} from '../src/nucleo/familia-de-endereco.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { acervoDeIdentidade, BRUNO, BRUNO_LID, CARLA, CARLA_LID } from './ajuda/identidade.js';

test('a forma opaca gravada traz o canonico, a outra forma e os dois ids', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const f = familiasDeIdentificadores(acervo, [s.carlaLid]).get(s.carlaLid)!;
    assert.equal(f.valor, CARLA_LID);
    assert.equal(f.canonico, CARLA);
    assert.deepEqual(f.outrasFormas, [CARLA]);
    assert.deepEqual([...f.identificadorIds].sort(), [s.carla, s.carlaLid].sort());
    assert.equal(f.identificadorIds[0], s.carlaLid, 'o proprio vem primeiro');
  } finally {
    limpar();
  }
});

test('o canonico gravado enxerga a alternativa gravada e o canonico e ele mesmo', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const f = familiasDeIdentificadores(acervo, [s.carla]).get(s.carla)!;
    assert.equal(f.canonico, CARLA);
    assert.deepEqual(f.outrasFormas, [CARLA_LID]);
    assert.deepEqual(f.identificadorIds, [s.carla, s.carlaLid]);
  } finally {
    limpar();
  }
});

test('o canonico enxerga a alternativa que so existe como correspondencia', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const f = familiasDeIdentificadores(acervo, [s.bruno]).get(s.bruno)!;
    assert.equal(f.canonico, BRUNO);
    assert.deepEqual(f.outrasFormas, [BRUNO_LID]);
    assert.deepEqual(
      f.identificadorIds,
      [s.bruno],
      'a alternativa nao tem linha: so o id do proprio',
    );
  } finally {
    limpar();
  }
});

test('as outras formas saem ordenadas por valor, o proprio fora delas', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    // tres formas do mesmo endereco: o canonico, o opaco e a forma do celular sem o nono digito
    const SEM_NOVE = '556533333333@s.whatsapp.net';
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: SEM_NOVE, canonico: CARLA });
    const semNove = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE }).id;
    const f = familiasDeIdentificadores(acervo, [s.carlaLid]).get(s.carlaLid)!;
    assert.deepEqual(f.outrasFormas, [CARLA, SEM_NOVE].sort());
    assert.equal(f.identificadorIds.length, 3);
    assert.equal(f.identificadorIds[0], s.carlaLid);
    assert.ok(f.identificadorIds.includes(semNove));
  } finally {
    limpar();
  }
});

test('endereco sem correspondencia nenhuma tem canonico nulo (nunca se inventa)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const f = familiasDeIdentificadores(acervo, [s.solto]).get(s.solto)!;
    assert.equal(f.canonico, null);
    assert.deepEqual(f.outrasFormas, []);
    assert.deepEqual(f.identificadorIds, [s.solto]);
  } finally {
    limpar();
  }
});

test('id que nao existe nao entra no resultado, e lista vazia devolve mapa vazio', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    assert.equal(familiasDeIdentificadores(acervo, []).size, 0);
    assert.equal(familiasDeIdentificadores(acervo, ['nao-existe']).size, 0);
  } finally {
    limpar();
  }
});

test('as consultas pagam o indice: nenhuma varre a correspondencia nem os Identificadores', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const alvo = JSON.stringify([{ f: 'whatsapp', v: CARLA_LID }]);
    // as MESMAS consultas que o modulo roda (exportadas para isto), nunca uma copia delas
    for (const sql of [
      SQL_CANONICO_DAS_FORMAS,
      SQL_ALTERNATIVAS_DOS_CANONICOS,
      SQL_GRAVADOS_DAS_FORMAS,
    ]) {
      const plano = (
        acervo.preparar(`EXPLAIN QUERY PLAN ${sql}`).all(alvo) as Array<{ detail: string }>
      )
        .map((l) => l.detail)
        .join(' | ');
      assert.doesNotMatch(
        plano,
        /SCAN c\b|SCAN i\b|SCAN correspondencias_de_endereco|SCAN identificadores/,
        plano,
      );
    }
  } finally {
    limpar();
  }
});
