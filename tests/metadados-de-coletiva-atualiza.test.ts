import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { listarConversas } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import type { MetadadosDeColetiva } from '../src/nucleo/escrita.js';

// #1160: Conversa e ESTADO CORRENTE. Registrar de novo uma coletiva que ja existe
// atualiza o que a Fonte entrega (assunto, descricao), nunca apaga por vazio.

interface Linha {
  assunto: string | null;
  descricao: string | null;
  alterado_por: string | null;
  alterado_em: string | null;
}

function registra(acervo: Acervo, metadados?: MetadadosDeColetiva): string {
  return registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'grupo-1@g.us',
    coletiva: true,
    ...(metadados === undefined ? {} : { metadadosDeColetiva: metadados }),
  });
}

function le(acervo: Acervo, id: string): Linha | undefined {
  return acervo.db
    .prepare('SELECT assunto, descricao, alterado_por, alterado_em FROM metadados_de_coletiva WHERE conversa_id = ?')
    .get(id) as Linha | undefined;
}

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Leia Organa').acervo);
  } finally {
    c.limpar();
  }
}

test('Conversa criada pelo ao vivo, sem metadados, recebe o assunto quando ele chega depois', () => {
  comAcervo((acervo) => {
    const id = registra(acervo);
    assert.equal(le(acervo, id), undefined, 'ponto de partida: a Conversa nasceu sem linha de metadados');

    registra(acervo, { assunto: 'Conselho' });

    assert.equal(le(acervo, id)?.assunto, 'Conselho');
  });
});

test('grupo renomeado: o assunto mais novo da Fonte substitui o velho', () => {
  comAcervo((acervo) => {
    const id = registra(acervo, { assunto: 'Conselho' });
    registra(acervo, { assunto: 'Conselho Jedi' });
    assert.equal(le(acervo, id)?.assunto, 'Conselho Jedi');
  });
});

test('registrar sem metadados nao mexe no que ja ha (o ao vivo nao apaga o assunto)', () => {
  comAcervo((acervo) => {
    const id = registra(acervo, { assunto: 'Conselho', descricao: 'Reuniao toda terca' });
    registra(acervo);
    const l = le(acervo, id);
    assert.equal(l?.assunto, 'Conselho');
    assert.equal(l?.descricao, 'Reuniao toda terca');
  });
});

test('vazio da Fonte nunca apaga: assunto vazio e descricao vazia mantem os anteriores', () => {
  comAcervo((acervo) => {
    const id = registra(acervo, { assunto: 'Conselho', descricao: 'Reuniao toda terca' });
    registra(acervo, { assunto: '', descricao: '' });
    const l = le(acervo, id);
    assert.equal(l?.assunto, 'Conselho');
    assert.equal(l?.descricao, 'Reuniao toda terca');
  });
});

test('cada campo atualiza sozinho: so a descricao chega, o assunto fica', () => {
  comAcervo((acervo) => {
    const id = registra(acervo, { assunto: 'Conselho' });
    registra(acervo, { descricao: 'Nova descricao' });
    const l = le(acervo, id);
    assert.equal(l?.assunto, 'Conselho');
    assert.equal(l?.descricao, 'Nova descricao');
  });
});

test('quem e quando alterou acompanha o valor novo', () => {
  comAcervo((acervo) => {
    const id = registra(acervo, { assunto: 'A', alteradoPor: 'a@s.whatsapp.net', alteradoEm: '2026-09-01T10:00:00.000Z' });
    registra(acervo, { assunto: 'B', alteradoPor: 'b@s.whatsapp.net', alteradoEm: '2026-09-02T10:00:00.000Z' });
    const l = le(acervo, id);
    assert.equal(l?.assunto, 'B');
    assert.equal(l?.alterado_por, 'b@s.whatsapp.net');
    assert.equal(l?.alterado_em, '2026-09-02T10:00:00.000Z');
  });
});

test('retrato mais velho nao sobrescreve o mais novo (backup antigo depois do ao vivo)', () => {
  comAcervo((acervo) => {
    const id = registra(acervo, { assunto: 'Novo', alteradoEm: '2026-09-10T10:00:00.000Z' });
    registra(acervo, { assunto: 'Velho', alteradoEm: '2026-08-01T10:00:00.000Z' });
    const l = le(acervo, id);
    assert.equal(l?.assunto, 'Novo');
    assert.equal(l?.alterado_em, '2026-09-10T10:00:00.000Z');
  });
});

test('valor igual repetido e idempotente e nao apaga o instante gravado', () => {
  comAcervo((acervo) => {
    const id = registra(acervo, {
      assunto: 'Conselho',
      alteradoPor: 'a@s.whatsapp.net',
      alteradoEm: '2026-09-01T10:00:00.000Z',
    });
    registra(acervo, { assunto: 'Conselho' });
    const l = le(acervo, id);
    assert.equal(l?.assunto, 'Conselho');
    assert.equal(l?.alterado_em, '2026-09-01T10:00:00.000Z', 'sem instante novo, o antigo fica');
    assert.equal(l?.alterado_por, 'a@s.whatsapp.net', 'sem autor novo, o antigo fica');
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM metadados_de_coletiva').get() as { n: number };
    assert.equal(n.n, 1);
  });
});

// Pelo importador, que e o caminho que corrige as Conversas ja gravadas.
const AGORA = Date.parse('2026-08-26T12:00:00Z');
const EM_USO = '2021-06-15T10:00:00Z';

function backupDoGrupo(nome: string, stanzaId: string) {
  return backupFalso({
    conversas: [{ pk: 2, endereco: '120363000000000000@g.us', nome, tipoDeSessao: 1 }],
    membros: [{ pk: 7, endereco: '5511900000002@s.whatsapp.net', conversaPk: 2 }],
    mensagens: [{ stanzaId, chatSessionPk: 2, texto: 'no grupo', dataCoreData: paraCoreData(EM_USO), grupoMembroPk: 7 }],
  });
}

test('importar um backup com o nome do grupo corrige a Conversa criada antes, sem nome', () => {
  const c = cenario();
  const b = backupDoGrupo('Conselho', 'm1');
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    // O ao vivo cria a coletiva sem metadados: e como nasceram as 50 do Acervo real.
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000000@g.us', coletiva: true });
    assert.equal(listarConversas(acervo, { coletiva: true })[0]?.assunto ?? null, null);

    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(listarConversas(acervo, { coletiva: true })[0]?.assunto, 'Conselho');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('reimportar um backup novo traz o nome atual do grupo renomeado', () => {
  const c = cenario();
  const velho = backupDoGrupo('Conselho', 'm1');
  const novo = backupDoGrupo('Conselho Jedi', 'm2');
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, velho.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });
    importarMaterial(acervo, novo.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    const coletivas = listarConversas(acervo, { coletiva: true });
    assert.equal(coletivas.length, 1);
    assert.equal(coletivas[0]?.assunto, 'Conselho Jedi');
  } finally {
    velho.limpar();
    novo.limpar();
    c.limpar();
  }
});
