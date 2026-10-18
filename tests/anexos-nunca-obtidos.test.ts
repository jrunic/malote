import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { listarAnexosNuncaObtidosComBruto } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('lista Anexo nunca-obtido com o bruto da Mensagem, e ignora o presente (#1084)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5511000000001@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const brutoAoVivo = JSON.stringify({
      key: { remoteJid: '5511000000001@s.whatsapp.net', id: 'M1', fromMe: false },
      messageTimestamp: 1_700_000_000,
      message: { videoMessage: { mediaKey: 'AAAA', directPath: '/x' } },
    });
    const mensagemNuncaObtida = registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'M1', ocorridaEm: 1_700_000_000_000,
      agora: Date.now(), direcao: 'recebida', bruto: brutoAoVivo,
    });
    const anexoNuncaObtido = registrarAnexo(acervo, {
      mensagemId: mensagemNuncaObtida, tipo: 'video', presenca: 'nunca-obtido', bruto: '{}',
    });

    const mensagemPresente = registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'M2', ocorridaEm: 1_700_000_001_000,
      agora: Date.now(), direcao: 'recebida', bruto: '{}',
    });
    registrarAnexo(acervo, {
      mensagemId: mensagemPresente, tipo: 'image', presenca: 'presente', bruto: '{}',
      caminho: '/tanto/faz', tamanho: 10,
    });

    const r = listarAnexosNuncaObtidosComBruto(acervo);
    assert.equal(r.length, 1);
    assert.equal(r[0]?.anexoId, anexoNuncaObtido);
    assert.equal(r[0]?.tipo, 'video');
    assert.equal(r[0]?.mensagemBruto, brutoAoVivo);
  } finally {
    c.limpar();
  }
});

test('filtro por fonte restringe a consulta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversaWa = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '5511000000001@s.whatsapp.net', coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const conversaIg = registrarConversa(acervo, {
      fonte: 'instagram', idExterno: 'conversa:1', coletiva: false,
      configuracao: { id: 'cfg-ig', fonte: 'instagram' },
    });
    const mWa = registrarMensagem(acervo, {
      conversaId: conversaWa, fonte: 'whatsapp', idExterno: 'W1', ocorridaEm: 1_700_000_000_000,
      agora: Date.now(), direcao: 'recebida', bruto: '{}',
    });
    registrarAnexo(acervo, { mensagemId: mWa, tipo: 'video', presenca: 'nunca-obtido', bruto: '{}' });
    const mIg = registrarMensagem(acervo, {
      conversaId: conversaIg, fonte: 'instagram', idExterno: 'I1', ocorridaEm: 1_700_000_000_000,
      agora: Date.now(), direcao: 'recebida', bruto: '{}',
    });
    registrarAnexo(acervo, { mensagemId: mIg, tipo: 'video', presenca: 'nunca-obtido', bruto: '{}' });

    assert.equal(listarAnexosNuncaObtidosComBruto(acervo, { fonte: 'whatsapp' }).length, 1);
    assert.equal(listarAnexosNuncaObtidosComBruto(acervo).length, 2);
  } finally {
    c.limpar();
  }
});

function tresAnexos(c: ReturnType<typeof cenario>) {
  const { acervo } = c.novoInquilino('Ahsoka');
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp', idExterno: '5511000000001@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
  });
  const dia = (d: number, h = 12) => Date.UTC(2026, 8, d, h);
  const nova = (idExterno: string, ocorridaEm: number, tipo: string) => {
    const mensagemId = registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno, ocorridaEm, agora: Date.now(), direcao: 'recebida', bruto: '{}',
    });
    const anexoId = registrarAnexo(acervo, { mensagemId, tipo, presenca: 'nunca-obtido', bruto: '{}' });
    return { mensagemId, anexoId };
  };
  // Inseridas FORA da ordem de data, para a ordem do resultado nao ser a da insercao.
  const nova25 = nova('N25', dia(25), 'image');
  const nova21 = nova('N21', dia(21), 'video');
  const nova23 = nova('N23', dia(23), 'image');
  return { acervo, dia, nova21, nova23, nova25 };
}

test('a listagem sai da Mensagem mais antiga para a mais nova e traz o instante e a Mensagem de cada Anexo', () => {
  const c = cenario();
  try {
    const { acervo, dia, nova21, nova23, nova25 } = tresAnexos(c);
    const r = listarAnexosNuncaObtidosComBruto(acervo);
    assert.deepEqual(r.map((x) => x.anexoId), [nova21.anexoId, nova23.anexoId, nova25.anexoId]);
    assert.deepEqual(r.map((x) => x.ocorridaEm), [dia(21), dia(23), dia(25)]);
    assert.equal(r[0]?.mensagemId, nova21.mensagemId);
  } finally {
    c.limpar();
  }
});

test('desde e ate sao inclusivos nas duas pontas e cortam pelo instante da Mensagem', () => {
  const c = cenario();
  try {
    const { acervo, dia, nova21, nova23, nova25 } = tresAnexos(c);
    const ids = (f: Parameters<typeof listarAnexosNuncaObtidosComBruto>[1]) =>
      listarAnexosNuncaObtidosComBruto(acervo, f).map((x) => x.anexoId);
    assert.deepEqual(ids({ desde: dia(23) }), [nova23.anexoId, nova25.anexoId]);
    assert.deepEqual(ids({ ate: dia(23) }), [nova21.anexoId, nova23.anexoId]);
    assert.deepEqual(ids({ desde: dia(21), ate: dia(21) }), [nova21.anexoId]);
    assert.deepEqual(ids({ desde: dia(22), ate: dia(24) }), [nova23.anexoId]);
    assert.deepEqual(ids({ desde: dia(26) }), []);
  } finally {
    c.limpar();
  }
});

test('tipo e mensagem restringem, e os filtros combinam por E', () => {
  const c = cenario();
  try {
    const { acervo, dia, nova21, nova23, nova25 } = tresAnexos(c);
    const ids = (f: Parameters<typeof listarAnexosNuncaObtidosComBruto>[1]) =>
      listarAnexosNuncaObtidosComBruto(acervo, f).map((x) => x.anexoId);
    assert.deepEqual(ids({ tipo: 'image' }), [nova23.anexoId, nova25.anexoId]);
    assert.deepEqual(ids({ tipo: 'video' }), [nova21.anexoId]);
    assert.deepEqual(ids({ mensagemId: nova25.mensagemId }), [nova25.anexoId]);
    assert.deepEqual(ids({ mensagemId: 'nao-existe' }), []);
    assert.deepEqual(ids({ tipo: 'image', desde: dia(24) }), [nova25.anexoId]);
    assert.deepEqual(ids({ tipo: 'video', desde: dia(22) }), []);
    assert.deepEqual(ids({ mensagemId: nova21.mensagemId, tipo: 'image' }), []);
  } finally {
    c.limpar();
  }
});

test('duas Mensagens no mesmo instante saem em ordem estavel, pelo id do Anexo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '5511000000001@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const anexos: string[] = [];
    for (const idExterno of ['A', 'B', 'C']) {
      const mensagemId = registrarMensagem(acervo, {
        conversaId, fonte: 'whatsapp', idExterno, ocorridaEm: 1_700_000_000_000, agora: Date.now(),
        direcao: 'recebida', bruto: '{}',
      });
      anexos.push(registrarAnexo(acervo, { mensagemId, tipo: 'image', presenca: 'nunca-obtido', bruto: '{}' }));
    }
    const lidos = listarAnexosNuncaObtidosComBruto(acervo).map((x) => x.anexoId);
    assert.deepEqual(lidos, [...anexos].sort());
  } finally {
    c.limpar();
  }
});
