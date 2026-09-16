import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { lerMaterial } from '../src/adaptadores/whatsapp/material.js';

const EM_USO = '2021-06-15T10:00:00Z';

test('lê conversas e mensagens do backup, resolvendo o ChatStorage pelo Manifest', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '5511900000001@s.whatsapp.net', nome: 'Leia', tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'm1', chatSessionPk: 1, texto: 'primeira', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    // No teste a lista e materializada de proposito: a fixture e pequena e
    // asserção por indice e mais legivel. O produto NUNCA faz isso.
    const mensagens = [...material.mensagens];
    assert.equal(material.conversas.length, 1);
    assert.equal(material.conversas[0]?.idExterno, '5511900000001@s.whatsapp.net');
    assert.equal(material.conversas[0]?.coletiva, false);
    assert.equal(mensagens.length, 1);
    assert.equal(mensagens[0]?.texto, 'primeira');
  } finally {
    b.limpar();
  }
});

test('converte o instante Core Data para época Unix em milissegundos', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [{ stanzaId: 'm1', chatSessionPk: 1, texto: 'a', dataCoreData: paraCoreData(EM_USO) }],
  });
  try {
    const material = lerMaterial(b.raiz);
    // No teste a lista e materializada de proposito: a fixture e pequena e
    // asserção por indice e mais legivel. O produto NUNCA faz isso.
    const mensagens = [...material.mensagens];
    assert.equal(mensagens[0]?.ocorridaEm, Date.parse(EM_USO));
  } finally {
    b.limpar();
  }
});

test('instante ausente na origem vira AUSENTE, nunca zero', () => {
  // Este é o defeito da tarefa #606, reproduzido: o importador de origem
  // convertia ZMESSAGEDATE nulo em 0, que é 31/12/1969. Aqui a ausência
  // atravessa como ausência, e quem decide o destino dela é a porta do núcleo.
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [{ stanzaId: 'm1', chatSessionPk: 1, texto: 'sem data', dataCoreData: null }],
  });
  try {
    const material = lerMaterial(b.raiz);
    // No teste a lista e materializada de proposito: a fixture e pequena e
    // asserção por indice e mais legivel. O produto NUNCA faz isso.
    const mensagens = [...material.mensagens];
    assert.equal(mensagens[0]?.ocorridaEm, undefined);
    assert.notEqual(mensagens[0]?.ocorridaEm, 0, 'zero seria uma data, e ela não existe');
  } finally {
    b.limpar();
  }
});

test('em conversa coletiva o remetente vem do membro, não do endereço do grupo', () => {
  // Armadilha real do formato: ZFROMJID carrega o endereço do GRUPO em
  // mensagem coletiva. Ler direto atribuiria toda mensagem ao próprio grupo.
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '120363000000000000@g.us', nome: 'Conselho', tipoDeSessao: 1 }],
    membros: [{ pk: 7, endereco: '5511900000002@s.whatsapp.net', conversaPk: 1 }],
    mensagens: [
      {
        stanzaId: 'm1',
        chatSessionPk: 1,
        texto: 'no grupo',
        dataCoreData: paraCoreData(EM_USO),
        grupoMembroPk: 7,
        deJid: '120363000000000000@g.us',
      },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    // No teste a lista e materializada de proposito: a fixture e pequena e
    // asserção por indice e mais legivel. O produto NUNCA faz isso.
    const mensagens = [...material.mensagens];
    assert.equal(material.conversas[0]?.coletiva, true);
    assert.equal(
      mensagens[0]?.autorExterno,
      '5511900000002@s.whatsapp.net',
      'o autor tem de ser o membro, nunca o grupo',
    );
    assert.notEqual(mensagens[0]?.autorExterno, '120363000000000000@g.us');
  } finally {
    b.limpar();
  }
});

test('mensagem da própria pessoa não recebe autor do membro', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '120363000000000000@g.us', nome: 'Conselho', tipoDeSessao: 1 }],
    membros: [{ pk: 7, endereco: '5511900000002@s.whatsapp.net', conversaPk: 1 }],
    mensagens: [
      {
        stanzaId: 'm1',
        chatSessionPk: 1,
        texto: 'eu mesma',
        dataCoreData: paraCoreData(EM_USO),
        daPropriaPessoa: true,
        grupoMembroPk: 7,
      },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    // No teste a lista e materializada de proposito: a fixture e pequena e
    // asserção por indice e mais legivel. O produto NUNCA faz isso.
    const mensagens = [...material.mensagens];
    assert.equal(mensagens[0]?.daPropriaPessoa, true);
    assert.equal(mensagens[0]?.autorExterno, undefined);
  } finally {
    b.limpar();
  }
});

test('o roster da conversa coletiva vem do material, por conversa', () => {
  const b = backupFalso({
    conversas: [
      { pk: 1, endereco: '120363000000000000@g.us', nome: 'Conselho', tipoDeSessao: 1 },
      { pk: 2, endereco: '120363000000000001@g.us', nome: 'Antigo', tipoDeSessao: 1 },
    ],
    membros: [
      { pk: 7, endereco: '5511900000002@s.whatsapp.net', conversaPk: 1 },
      { pk: 8, endereco: '5511900000003@s.whatsapp.net', conversaPk: 1 },
    ],
    mensagens: [],
  });
  try {
    const material = lerMaterial(b.raiz);
    const conselho = material.conversas.find((c) => c.idExterno.endsWith('0000@g.us'));
    const antigo = material.conversas.find((c) => c.idExterno.endsWith('0001@g.us'));
    assert.equal(conselho?.participantesConhecidos.length, 2);
    // Grupo do qual o Titular saiu não traz membro: ausência é resultado
    // válido, e um teste com um grupo só não distinguiria isso de defeito.
    assert.equal(antigo?.participantesConhecidos.length, 0);
  } finally {
    b.limpar();
  }
});

test('anexo aparece com tipo e com o caminho na origem', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'm1',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData(EM_USO),
        tipo: 1,
        caminhoDeMidia: 'Media/x/IMG_0001.jpg',
      },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    // No teste a lista e materializada de proposito: a fixture e pequena e
    // asserção por indice e mais legivel. O produto NUNCA faz isso.
    const mensagens = [...material.mensagens];
    assert.equal(mensagens[0]?.anexo?.tipo, 'image');
    assert.equal(mensagens[0]?.anexo?.caminhoNaOrigem, 'Media/x/IMG_0001.jpg');
  } finally {
    b.limpar();
  }
});

test('backup sem Manifest.db falha alto, com o caminho na mensagem', () => {
  assert.throws(() => lerMaterial('/caminho/que/nao/existe'), /Manifest\.db/);
});

test('backup cujo Manifest não aponta ChatStorage falha alto', () => {
  const b = backupFalso({ conversas: [], mensagens: [], dominio: 'AppDomain-outra.coisa' });
  try {
    assert.throws(() => lerMaterial(b.raiz), /ChatStorage\.sqlite/);
  } finally {
    b.limpar();
  }
});
