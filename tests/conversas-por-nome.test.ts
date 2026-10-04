import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listarConversas } from '../src/nucleo/consulta.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarNome } from '../src/nucleo/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { acervoDeIdentidade, PRECEDENCIA, BASE, minuto } from './ajuda/identidade.js';

const ids = (r: Array<{ id: string }>): string[] => r.map((c) => c.id).sort();

test('a Conversa direta traz o nome e a origem do Identificador de mesmo valor; coletiva e sem nome trazem null (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const todas = listarConversas(acervo, { precedencia: PRECEDENCIA });
    const por = (id: string) => todas.find((c) => c.id === id)!;
    assert.deepEqual([por(s.diretaDeBruno).nome, por(s.diretaDeBruno).origemDoNome], ['Bruno Contato', 'contatos']);
    assert.deepEqual([por(s.diretaDeAna).nome, por(s.diretaDeAna).origemDoNome], ['Ana WhatsApp', 'whatsapp']);
    assert.deepEqual([por(s.diretaDeEdu).nome, por(s.diretaDeEdu).origemDoNome], [null, null], 'direta sem nome');
    assert.deepEqual([por(s.grupo).nome, por(s.grupo).origemDoNome], [null, null], 'coletiva');
    assert.equal(por(s.grupo).assunto, 'Grupo da Familia', 'o assunto nao mudou');
  } finally {
    limpar();
  }
});

test('sem precedencia no filtro, os campos de nome vem null e o resto nao muda (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const todas = listarConversas(acervo, {});
    assert.equal(todas.find((c) => c.id === s.diretaDeBruno)!.nome, null);
    assert.equal(todas.length, 4, 'a fixture produz as quatro Conversas');
  } finally {
    limpar();
  }
});

test('--busca acha a Conversa direta por QUALQUER nome do Identificador, sem distinguir maiuscula (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    assert.deepEqual(ids(listarConversas(acervo, { busca: 'bruno' })), [s.diretaDeBruno]);
    // 'Bruno Silva' e o nome de plataforma, que a precedencia NAO escolheu: ainda assim e achavel.
    assert.deepEqual(ids(listarConversas(acervo, { busca: 'SILVA' })), [s.diretaDeBruno]);
    assert.deepEqual(ids(listarConversas(acervo, { busca: 'ana' })), [s.diretaDeAna]);
  } finally {
    limpar();
  }
});

test('--busca continua achando coletiva pelo assunto, e nao devolve direta sem nome (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    assert.deepEqual(ids(listarConversas(acervo, { busca: 'familia' })), [s.grupo]);
    assert.deepEqual(listarConversas(acervo, { busca: 'zzz' }), []);
    assert.equal(listarConversas(acervo, { busca: 'edu' }).length, 0, 'Edu nao tem nome gravado');
  } finally {
    limpar();
  }
});

test('o nome que esta na PESSOA e nao no Identificador NAO e achado: o ramo da Pessoa ficou fora da v1 (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    // 'Ana Catalogo' esta na Pessoa de Ana; o Identificador dela so tem 'Ana WhatsApp'.
    assert.equal(listarConversas(acervo, { busca: 'catalogo' }).length, 0);
  } finally {
    limpar();
  }
});

test('--busca trata % e _ como literais tambem no nome (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    assert.equal(listarConversas(acervo, { busca: '%' }).length, 0);
    assert.equal(listarConversas(acervo, { busca: 'Br_no' }).length, 0);
  } finally {
    limpar();
  }
});

test('sem --busca o conjunto devolvido e o mesmo; so a forma ganha campos (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const sem = listarConversas(acervo, {}).map((c) => c.id).sort();
    const com = listarConversas(acervo, { precedencia: PRECEDENCIA }).map((c) => c.id).sort();
    assert.deepEqual(com, sem);
  } finally {
    limpar();
  }
});

test('o nome vem de uma consulta em lote, nao de uma por Conversa (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    let chamadas = 0;
    const original = acervo.preparar.bind(acervo);
    (acervo as unknown as { preparar: unknown }).preparar = (sql: string) => {
      if (/FROM atribuicoes_de_nome/.test(sql)) chamadas += 1;
      return original(sql);
    };
    listarConversas(acervo, { precedencia: PRECEDENCIA });
    assert.equal(chamadas, 1);
  } finally {
    limpar();
  }
});

test('--busca casa % e _ LITERAIS no nome: o literal e achado e o curinga nao (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const valor = '5565777777777@s.whatsapp.net';
    const identificador = registrarIdentificador(acervo, { fonte: 'whatsapp', valor }).id;
    registrarNome(acervo, { identificadorId: identificador, origem: 'whatsapp', nome: 'Lu_100% Zeca', autoridade: 'terceiro' });
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: valor,
      coletiva: false,
      configuracao: CFG_WHATSAPP,
      bruto: '{}',
    });
    assert.deepEqual(ids(listarConversas(acervo, { busca: 'u_100%' })), [conversa], 'o literal _ e % e achado');
    assert.equal(listarConversas(acervo, { busca: 'u_1' }).length, 1);
    assert.equal(listarConversas(acervo, { busca: 'Ze_a' }).length, 0, '_ nao e curinga');
    assert.equal(listarConversas(acervo, { busca: '10%Zeca' }).length, 0, '% nao e curinga');
  } finally {
    limpar();
  }
});

test('com --desde o nome tambem vem, e a Conversa sem Mensagem continua fora (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const r = listarConversas(acervo, { desde: BASE, precedencia: PRECEDENCIA });
    const bruno = r.find((c) => c.id === s.diretaDeBruno)!;
    assert.deepEqual([bruno.nome, bruno.origemDoNome], ['Bruno Contato', 'contatos']);
    assert.equal(r.some((c) => c.id === s.diretaDeEdu), false, 'Edu nunca recebeu Mensagem: nao casa --desde');
    assert.equal(r.length, 3, 'as tres Conversas com Mensagem: Ana, Bruno e o grupo');
  } finally {
    limpar();
  }
});

test('coletiva NUNCA ganha nome, mesmo que exista Identificador de mesmo valor que o identificador externo dela (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const intruso = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: 'grupo-1@g.us' }).id;
    registrarNome(acervo, { identificadorId: intruso, origem: 'whatsapp', nome: 'Nome Que Nao E do Grupo', autoridade: 'terceiro' });
    registrarMensagem(acervo, {
      conversaId: s.grupo,
      fonte: 'whatsapp',
      idExterno: 'm-grupo-extra',
      conteudo: 'oi',
      ocorridaEm: minuto(30),
      agora: Date.now(),
      direcao: 'recebida',
    });
    for (const filtro of [{ precedencia: PRECEDENCIA }, { precedencia: PRECEDENCIA, desde: BASE }]) {
      const grupo = listarConversas(acervo, filtro).find((c) => c.id === s.grupo)!;
      assert.deepEqual([grupo.nome, grupo.origemDoNome], [null, null]);
    }
    assert.equal(listarConversas(acervo, { busca: 'Nao E do Grupo' }).length, 0, 'e a busca pelo nome tambem nao a acha');
  } finally {
    limpar();
  }
});
