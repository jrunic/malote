import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { listarMensagensDeModeloSemAnexo, removerAnexoNuncaObtido } from '../src/nucleo/anexo-de-modelo.js';

const BRUTO_MODELO = JSON.stringify({ key: { id: 'X' }, message: { templateMessage: { interactiveMessageTemplate: {} } } });
const BRUTO_TEXTO = JSON.stringify({ key: { id: 'Y' }, message: { conversation: 'oi' } });

function mensagem(acervo: Acervo, idExterno: string, bruto: string, fonte: 'whatsapp' | 'instagram' = 'whatsapp'): string {
  const conversaId = registrarConversa(acervo, {
    fonte,
    idExterno: `conversa-${fonte}`,
    coletiva: false,
    configuracao: fonte === 'whatsapp' ? CFG_WHATSAPP : { id: 'cfg-ig', fonte: 'instagram' },
  });
  return registrarMensagem(acervo, {
    conversaId, fonte, idExterno, ocorridaEm: Date.parse('2026-10-14T10:00:00Z'), agora: Date.parse('2026-10-18T10:00:00Z'),
    direcao: 'recebida', bruto,
  });
}

test('lista so a Mensagem de modelo do WhatsApp que ainda nao tem Anexo, com o bruto', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const semAnexo = mensagem(acervo, 'M1', BRUTO_MODELO);
    const comNuncaObtido = mensagem(acervo, 'M2', BRUTO_MODELO);
    registrarAnexo(acervo, { mensagemId: comNuncaObtido, tipo: 'image', presenca: 'nunca-obtido', bruto: '{}' });
    const comPresente = mensagem(acervo, 'M3', BRUTO_MODELO);
    registrarAnexo(acervo, { mensagemId: comPresente, tipo: 'image', presenca: 'presente', bruto: '{}', caminho: 'a/b', tamanho: 3 });
    mensagem(acervo, 'M4', BRUTO_TEXTO);
    mensagem(acervo, 'M5', BRUTO_MODELO, 'instagram');

    const r = listarMensagensDeModeloSemAnexo(acervo);
    assert.deepEqual(r.map((x) => x.mensagemId), [semAnexo]);
    assert.equal(r[0]?.bruto, BRUTO_MODELO);
  } finally {
    c.limpar();
  }
});

test('removerAnexoNuncaObtido remove o nunca-obtido, recusa o presente e diz quando nao existe', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const m = mensagem(acervo, 'M1', BRUTO_MODELO);
    const nunca = registrarAnexo(acervo, { mensagemId: m, tipo: 'image', presenca: 'nunca-obtido', bruto: '{}' });
    const m2 = mensagem(acervo, 'M2', BRUTO_MODELO);
    const presente = registrarAnexo(acervo, { mensagemId: m2, tipo: 'image', presenca: 'presente', bruto: '{}', caminho: 'a/b', tamanho: 3 });

    assert.equal(removerAnexoNuncaObtido(acervo, nunca), 'removido');
    assert.equal(removerAnexoNuncaObtido(acervo, presente), 'ja-baixado');
    assert.equal(removerAnexoNuncaObtido(acervo, 'nao-existe'), 'inexistente');
    const ids = (acervo.db.prepare('SELECT id FROM anexos').all() as Array<{ id: string }>).map((x) => x.id);
    assert.deepEqual(ids, [presente], 'so o presente ficou');
  } finally {
    c.limpar();
  }
});
