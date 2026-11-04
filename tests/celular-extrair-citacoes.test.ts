import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { extrairCitacoes } from '../src/adaptadores/whatsapp/extrair-citacoes.js';

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';
const DIA = Date.parse('2026-10-20T10:00:00Z');
const AGORA = Date.parse('2026-10-21T13:00:00Z');

test('o par que o comando do estoque aprende ao gravar a Citacao sai no `desfazer` da Operacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: GRUPO, coletiva: true });
    // A Mensagem cita uma Mensagem que o Acervo nao tem, escrita por um celular nunca visto, na forma COM_NOVE.
    registrarMensagem(acervo, {
      origemDaChegada: 'importacao',
      conversaId,
      fonte: 'whatsapp',
      idExterno: 'R1',
      ocorridaEm: DIA,
      agora: AGORA,
      direcao: 'recebida',
      bruto: JSON.stringify({
        key: { remoteJid: GRUPO, id: 'R1', fromMe: false, participant: '108888888888888@lid' },
        messageTimestamp: 1,
        message: { extendedTextMessage: { text: 'sim', contextInfo: { stanzaId: 'FORA', participant: COM_NOVE } } },
      }),
    });
    const pares = (): unknown[] =>
      acervo.db.prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo').all();

    extrairCitacoes(acervo, { comEfeito: true, enderecosDaConta: (): readonly string[] => [] });
    assert.deepEqual(pares(), [{ alternativo: SEM_NOVE, canonico: COM_NOVE }]);

    const operacao = listarOperacoesCruas(acervo).find((o) => o.natureza === 'extrair-citacoes');
    assert.ok(operacao, 'a Operacao do estoque nao foi gravada');
    const r = desfazerOperacao(acervo, operacao.id);

    assert.deepEqual(r.recusados, []);
    assert.deepEqual(pares(), [], 'o par que a Operacao aprendeu sai com ela');
  } finally {
    c.limpar();
  }
});
