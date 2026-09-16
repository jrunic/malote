import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = 1_756_100_000_000;

/**
 * A distribuicao de chave de grupo ACOMPANHA a mensagem, nao a substitui.
 *
 * Medido em 04/09/2026 contra acervo real de captura ao vivo, na janela de 4,5
 * meses: 174.490 eventos carregam `senderKeyDistributionMessage`, e **168.259
 * deles tem conteudo real junto** — 59.623 textos, 24.727 imagens, 14.602
 * videos, 9.394 conversas simples. Ela vem PRIMEIRA no objeto em 165.096 dos
 * casos, e a classificacao devolvia a primeira chave: a Mensagem inteira era
 * descartada em silencio.
 *
 * A razao de 27 para 1 entre acompanhando e sozinha e o que separa decoracao de
 * envelope de tipo de conteudo — e o mesmo criterio que ja valia para
 * `messageContextInfo`.
 */
test('mensagem com distribuicao de chave de grupo JUNTO do texto e gravada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const relato = receberEvento(
      acervo,
      [
        {
          key: {
            remoteJid: '120000000000000001@g.us',
            id: 'COMCHAVE1',
            fromMe: false,
            participant: '900000000000001@lid',
            participantPn: '55100000001@s.whatsapp.net',
          },
          messageTimestamp: Math.floor((AGORA - 60_000) / 1000),
          // A ORDEM importa e e a real: a distribuicao de chave vem primeira.
          message: {
            senderKeyDistributionMessage: { groupId: '120000000000000001@g.us' },
            conversation: 'texto que nao pode se perder',
          },
        },
      ],
      { agora: AGORA, configuracao: CFG_WHATSAPP },
    );

    assert.equal(relato.gravados, 1, `foi ignorada: ${JSON.stringify(relato.ignorados)}`);
    const linha = acervo.db
      .prepare('SELECT conteudo FROM mensagens WHERE id_externo = ?')
      .get('COMCHAVE1') as { conteudo: string | null } | undefined;
    assert.equal(linha?.conteudo, 'texto que nao pode se perder');
  } finally {
    c.limpar();
  }
});

test('distribuicao de chave SOZINHA continua nao virando Mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    // Sao 6.231 no mesmo acervo: evento de protocolo de verdade, sem conteudo.
    // Corrigir o caso acompanhado sem cuidar deste transformaria 6 mil eventos
    // de protocolo em Mensagens vazias.
    const relato = receberEvento(
      acervo,
      [
        {
          key: { remoteJid: '120000000000000001@g.us', id: 'SOCHAVE1', fromMe: false },
          messageTimestamp: Math.floor((AGORA - 60_000) / 1000),
          message: { senderKeyDistributionMessage: { groupId: '120000000000000001@g.us' } },
        },
      ],
      { agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    assert.equal(relato.gravados, 0);
    assert.equal(relato.ignorados['senderKeyDistributionMessage'], 1);
  } finally {
    c.limpar();
  }
});
