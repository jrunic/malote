import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { listarConversas, lerParticipacoes } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-26T12:00:00Z');
const EM_USO = '2021-06-15T10:00:00Z';

test('toda Conversa direta importada tem exatamente duas Participações', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [
      { pk: 1, endereco: '5511900000001@s.whatsapp.net', nome: 'Leia', tipoDeSessao: 0 },
      { pk: 2, endereco: '5511900000002@s.whatsapp.net', nome: 'Han', tipoDeSessao: 0 },
    ],
    mensagens: [
      { stanzaId: 'm1', chatSessionPk: 1, texto: 'a', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'm2', chatSessionPk: 2, texto: 'b', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    // Duas conversas, não uma: com uma só, um defeito que gravasse participação
    // apenas na primeira passaria despercebido.
    const diretas = listarConversas(acervo, { coletiva: false });
    assert.equal(diretas.length, 2);
    for (const conversa of diretas) {
      assert.equal(
        lerParticipacoes(acervo, conversa.id).length,
        2,
        `conversa direta ${conversa.id} sem as duas Participacoes`,
      );
    }
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('nenhuma Participação importada tem data inferida', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [{ stanzaId: 'm1', chatSessionPk: 1, texto: 'a', dataCoreData: paraCoreData(EM_USO) }],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    const [conversa] = listarConversas(acervo, {});
    const participacoes = lerParticipacoes(acervo, conversa!.id);
    // Sem esta asserção o laço abaixo não roda e o teste passa com ZERO
    // participações — ausência indistinguível de conformidade.
    assert.ok(participacoes.length > 0, 'o teste precisa ter o que inspecionar');
    for (const p of participacoes) {
      assert.equal(p.comecouEm, null, 'material exportado nao traz data de entrada');
      assert.equal(p.terminouEm, null);
      assert.ok(p.observadaEm.length > 0, 'observada_em e o que o malote de fato sabe');
    }
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('Conversa coletiva recebe o roster que a Fonte informa', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '120363000000000000@g.us', nome: 'Conselho', tipoDeSessao: 1 }],
    membros: [
      { pk: 7, endereco: '5511900000002@s.whatsapp.net', conversaPk: 1 },
      { pk: 8, endereco: '5511900000003@s.whatsapp.net', conversaPk: 1 },
    ],
    mensagens: [
      { stanzaId: 'm1', chatSessionPk: 1, texto: 'no grupo', dataCoreData: paraCoreData(EM_USO), grupoMembroPk: 7 },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    const [coletiva] = listarConversas(acervo, { coletiva: true });
    assert.equal(lerParticipacoes(acervo, coletiva!.id).length, 2);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('Conversa coletiva sem roster na Fonte fica sem Participação, e isso é válido', () => {
  // 1.022 dos 1.365 grupos do acervo de origem estao neste caso: o Titular
  // saiu e o backup nao traz membro algum. Ausencia visivel, nao disfarcada.
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '120363000000000001@g.us', nome: 'Antigo', tipoDeSessao: 1 }],
    mensagens: [{ stanzaId: 'm1', chatSessionPk: 1, texto: 'oi', dataCoreData: paraCoreData(EM_USO) }],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    const [coletiva] = listarConversas(acervo, { coletiva: true });
    assert.equal(lerParticipacoes(acervo, coletiva!.id).length, 0);
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('reimportar atualiza a observação da Participação, sem duplicar', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [{ stanzaId: 'm1', chatSessionPk: 1, texto: 'a', dataCoreData: paraCoreData(EM_USO) }],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    const [conversa] = listarConversas(acervo, {});
    const antes = lerParticipacoes(acervo, conversa!.id);

    importarMaterial(acervo, b.raiz, { agora: AGORA + 86_400_000, configuracao: CFG_WHATSAPP, reprocessar: true });
    const depois = lerParticipacoes(acervo, conversa!.id);

    assert.equal(depois.length, antes.length, 'reimportar nao duplica Participacao');
    assert.notEqual(depois[0]?.observadaEm, antes[0]?.observadaEm, 'a observacao acompanha o material');
  } finally {
    b.limpar();
    c.limpar();
  }
});
