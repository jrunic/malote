import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = 1_756_100_000_000;

function receber(conteudo: 'nulo' | 'ausente', id: string) {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const relato = receberEvento(
    acervo,
    [
      {
        key: { remoteJid: '5511000000000@s.whatsapp.net', id, fromMe: false },
        messageTimestamp: Math.floor((AGORA - 60_000) / 1000),
        ...(conteudo === 'nulo' ? { message: null } : {}),
      },
    ],
    { agora: AGORA, configuracao: CFG_WHATSAPP },
  );
  const mensagens = (
    acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number }
  ).n;
  c.limpar();
  return { relato, mensagens };
}

test('conteudo NULO se comporta igual a conteudo AUSENTE', () => {
  // `null` e ausente sao coisas diferentes, e a Fonte manda as duas. Medido em
  // 04/09/2026 contra acervo real de captura ao vivo: 99 eventos com conteudo
  // nulo explicito em 410.710 — cerca de 1 em 4.000. Um ouvinte que rode meses
  // topa com isso, e a guarda que so testava `undefined` DERRUBAVA a recepcao
  // com `Cannot convert undefined or null to object`.
  //
  // O invariante e equivalencia, e nao um numero que eu ache certo: o
  // comportamento para conteudo ausente ja esta decidido, e nulo tem de seguir
  // o mesmo caminho. Asserir um numero escolhido por mim contrabandearia
  // mudanca de comportamento junto da correcao do defeito.
  const nulo = receber('nulo', 'NULO1');
  const ausente = receber('ausente', 'AUSENTE1');

  assert.deepEqual(nulo.relato.ignorados, ausente.relato.ignorados);
  assert.equal(nulo.relato.gravados, ausente.relato.gravados);
  assert.equal(nulo.relato.recusados.length, ausente.relato.recusados.length);
  assert.equal(nulo.mensagens, ausente.mensagens);
});
