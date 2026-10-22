import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { resolverRetroativamente } from '../src/nucleo/resolucao-retroativa.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';

const AGORA = Date.parse('2026-10-21T13:00:00Z');

test('a resolucao retroativa reponta tambem o autor da Citacao, e o desfazer o devolve', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    // A ordem e a do defeito real: grava primeiro, aprende a correspondencia depois.
    const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '109876543210987@lid' });
    const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'R1', ocorridaEm: AGORA - 1000, agora: AGORA, direcao: 'recebida',
      citacao: { idExterno: 'ANTIGA', autorId: alt.id, direcao: 'recebida' },
    });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: '109876543210987@lid', canonico: '5565911110001@s.whatsapp.net' });

    const r = resolverRetroativamente(acervo, { comEfeito: true });
    assert.equal(r.paresReconciliados, 1);
    const canon = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' });
    const autor = () => (acervo.preparar('SELECT citada_autor_id AS a FROM mensagens WHERE id_externo = ?').get('R1') as { a: string }).a;
    assert.equal(autor(), canon.id, 'o autor da citada continuou na forma alternativa');

    const operacao = listarOperacoesCruas(acervo).find((o) => o.natureza === 'resolver-enderecos');
    assert.ok(operacao, 'a Operacao nao foi gravada');
    const desfeito = desfazerOperacao(acervo, operacao.id);
    // A unica linha que o desfazer recusa e a referencia ao Identificador canonico criado (inerte, por desenho).
    assert.ok(desfeito.recusados.every((x) => /referencia a identificadores/.test(x.causa)), JSON.stringify(desfeito.recusados));
    assert.equal(autor(), alt.id, 'o desfazer nao devolveu o autor da citada');
  } finally {
    c.limpar();
  }
});
