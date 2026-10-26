import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { eventoDeGrupo } from './ajuda/metadados-de-coletiva-ao-vivo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';

// #1160 fatia C, criterio 7 — PRE-CONDICAO: a #1204 entregue (tolerancia de relogio da guarda de instante na
// recepcao ao vivo). O caso e o MEDIDO pela espiga: o evento de grupo chegou 165 ms antes do segundo cheio, porque o
// instante vem do aparelho de quem alterou. Com a tolerancia grava os metadados E a Mensagem; sem ela, a Operacao
// inteira se desfaz. 165 ms vale para qualquer tolerancia de 165 ms ou mais, que e o que a #1204 fixa.

const AGORA = Date.parse('2026-10-13T20:12:03.835Z');

test('evento de grupo 165 ms a frente do relogio (o caso medido) grava os metadados e a Mensagem sem texto', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const ts = Math.floor(AGORA / 1000) + 1; // 20:12:04.000 contra o relogio local em 20:12:03.835: 165 ms a frente
    const r = receberEvento(
      acervo,
      [eventoDeGrupo({ id: 'T1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Espiga 1160 B'], ts })],
      { origemDaChegada: 'ao-vivo', agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    assert.deepEqual(r.recusados, [], `a guarda recusou o evento: a #1204 nao foi entregue? ${JSON.stringify(r.recusados)}`);
    assert.equal(r.metadadosDeColetiva, 1);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }).n, 1);
    assert.equal((acervo.db.prepare('SELECT assunto FROM metadados_de_coletiva').get() as { assunto: string }).assunto, 'Espiga 1160 B');
  } finally {
    c.limpar();
  }
});
