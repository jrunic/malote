import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { listarConversas } from '../src/nucleo/consulta.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';

test('filtrar por configuracaoId devolve so as Conversas diretas daquela Configuracao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const direta1 = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '222@s.whatsapp.net',
      coletiva: false, configuracao: CFG_WHATSAPP_SEGUNDA,
    });

    const resultado = listarConversas(acervo, { configuracaoId: CFG_WHATSAPP.id });

    assert.equal(resultado.length, 1);
    assert.equal(resultado[0]!.id, direta1);
    assert.equal(resultado[0]!.configuracaoId, CFG_WHATSAPP.id);
  } finally {
    c.limpar();
  }
});

test('Conversa coletiva NUNCA casa filtro de configuracaoId, e carrega configuracaoId null sem filtro', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const diretaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const coletivaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'grupo-1@g.us', coletiva: true,
    });

    const filtrado = listarConversas(acervo, { configuracaoId: CFG_WHATSAPP.id });
    assert.deepEqual(filtrado.map((c2) => c2.id), [diretaId]);
    assert.ok(!filtrado.some((c2) => c2.id === coletivaId), 'coletiva nao pode aparecer com filtro de configuracao');

    const semFiltro = listarConversas(acervo, {});
    const coletivaNaLista = semFiltro.find((c2) => c2.id === coletivaId);
    assert.equal(coletivaNaLista?.configuracaoId, null);
  } finally {
    c.limpar();
  }
});
