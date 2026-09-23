import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { listarAnexosPendentes } from '../src/nucleo/inventario.js';
import { conversaExiste } from '../src/nucleo/consulta.js';
import type { Fonte, Presenca } from '../src/nucleo/tipos.js';
import { CFG_WHATSAPP, cfgDaFonte } from './ajuda/configuracao.js';

/** Um Anexo de uma Fonte, com a Presenca pedida. Devolve o id do Anexo. */
function anexoDe(
  acervo: Acervo,
  fonte: Fonte,
  idExternoDaMensagem: string,
  presenca: Presenca,
): string {
  const conversa = registrarConversa(acervo, {
    fonte,
    idExterno: `conversa-${fonte}`,
    coletiva: false, configuracao: cfgDaFonte(fonte),
  });
  const agora = Date.now();
  const mensagem = registrarMensagem(acervo, {
      direcao: 'recebida',
    conversaId: conversa,
    fonte,
    idExterno: idExternoDaMensagem,
    ocorridaEm: agora - 1_000,
    agora,
  });
  return registrarAnexo(acervo, { mensagemId: mensagem, tipo: 'imagem', presenca });
}

test('listarAnexosPendentes traz so a Fonte pedida — e e por isso que o JOIN existe', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const doWhatsapp = anexoDe(acervo, 'whatsapp', 'msg-wa-1', 'nunca-obtido');
    anexoDe(acervo, 'instagram', 'msg-ig-1', 'nunca-obtido');

    const pendentes = listarAnexosPendentes(acervo, { fonte: 'whatsapp' });

    // `anexos` NAO tem coluna de Fonte. Sem o JOIN com `mensagens`, o Anexo do
    // Instagram entraria aqui — e o trazer do WhatsApp o contaria como ausente
    // do proprio material, que e um numero falso num relatorio de operacao.
    assert.equal(pendentes.length, 1, `esperava 1, obtive ${pendentes.length}`);
    assert.equal(pendentes[0]?.anexoId, doWhatsapp);
    assert.equal(pendentes[0]?.mensagemIdExterno, 'msg-wa-1');
  } finally {
    c.limpar();
  }
});

test('listarAnexosPendentes traz so `nunca-obtido` — a Presenca E o cursor', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const pendente = anexoDe(acervo, 'whatsapp', 'msg-1', 'nunca-obtido');
    // Mesma Fonte, mesma Conversa, Presencas que ja saíram do cursor.
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'conversa-whatsapp',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const agora = Date.now();
    for (const [idExterno, presenca] of [
      ['msg-2', 'presente'],
      ['msg-3', 'descartado'],
    ] as Array<[string, Presenca]>) {
      const m = registrarMensagem(acervo, {
      direcao: 'recebida',
        conversaId: conversa,
        fonte: 'whatsapp',
        idExterno,
        ocorridaEm: agora - 1_000,
        agora,
      });
      registrarAnexo(acervo, { mensagemId: m, tipo: 'imagem', presenca });
    }

    const pendentes = listarAnexosPendentes(acervo, { fonte: 'whatsapp' });
    assert.equal(pendentes.length, 1, `esperava 1, obtive ${pendentes.length}`);
    assert.equal(pendentes[0]?.anexoId, pendente);
  } finally {
    c.limpar();
  }
});

test('conversaExiste responde pela Conversa, sem que o chamador toque em tabela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const id = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'conversa-1',
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    assert.equal(conversaExiste(acervo, id), true);
    assert.equal(conversaExiste(acervo, 'nao-existe'), false);
    assert.equal(conversaExiste(acervo, ''), false);
  } finally {
    c.limpar();
  }
});
