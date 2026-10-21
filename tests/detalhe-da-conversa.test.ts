import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detalharConversa } from '../src/nucleo/detalhe-da-conversa.js';
import { registrarConversa, registrarMetadadosDeColetiva } from '../src/nucleo/escrita.js';
import { acervoDeIdentidade, PRECEDENCIA, minuto } from './ajuda/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

// #1203: o detalhe de UMA Conversa. A coletiva traz os Metadados de Coletiva por inteiro; a direta traz o nome do outro
// lado e NENHUM campo de grupo. O instante dos metadados e o da linha (o Acervo guarda um so por Conversa).

test('a coletiva com metadados traz assunto, descricao, autor, instante, contagem e os dois instantes', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    registrarMetadadosDeColetiva(acervo, s.grupo, {
      descricao: 'Avisos da familia',
      alteradoPor: 'AUTOR@lid',
      alteradoEm: '2026-06-01T12:30:00.000Z',
    });
    const d = detalharConversa(acervo, s.grupo, PRECEDENCIA);
    assert.ok(d !== undefined);
    assert.equal(d.id, s.grupo);
    assert.equal(d.fonte, 'whatsapp');
    assert.equal(d.coletiva, true);
    assert.equal(d.configuracao, null);
    assert.equal(d.nome, null);
    assert.equal(d.mensagens, 5);
    assert.equal(d.primeiraMensagemEm, minuto(10));
    assert.equal(d.ultimaMensagemEm, minuto(14));
    assert.deepEqual(d.metadados, {
      assunto: 'Grupo da Familia',
      descricao: 'Avisos da familia',
      alteradoPor: 'AUTOR@lid',
      alteradoEm: '2026-06-01T12:30:00.000Z',
    });
  } finally {
    limpar();
  }
});

test('a coletiva SEM metadados gravados devolve os campos nulos, e nao e erro', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const sem = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'sem-metadados@g.us', coletiva: true, bruto: '{}' });
    const d = detalharConversa(acervo, sem, PRECEDENCIA);
    assert.ok(d !== undefined);
    assert.equal(d.coletiva, true);
    assert.equal(d.mensagens, 0);
    assert.equal(d.primeiraMensagemEm, null);
    assert.equal(d.ultimaMensagemEm, null);
    assert.deepEqual(d.metadados, { assunto: null, descricao: null, alteradoPor: null, alteradoEm: null });
  } finally {
    limpar();
  }
});

test('a descricao REMOVIDA e nula, com o instante da ULTIMA alteracao da linha, e nao texto vazio', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    registrarMetadadosDeColetiva(acervo, s.grupo, { descricao: 'Antiga', alteradoEm: '2026-06-01T12:30:00.000Z' });
    registrarMetadadosDeColetiva(acervo, s.grupo, { removerDescricao: true, alteradoEm: '2026-06-02T09:00:00.000Z' });
    const d = detalharConversa(acervo, s.grupo, PRECEDENCIA);
    assert.equal(d?.metadados?.descricao, null);
    assert.equal(d?.metadados?.alteradoEm, '2026-06-02T09:00:00.000Z');
  } finally {
    limpar();
  }
});

test('a direta traz o nome corrente do outro lado pela precedencia, a origem dele e NENHUM campo de grupo', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const d = detalharConversa(acervo, s.diretaDeBruno, PRECEDENCIA, new Map([[CFG_WHATSAPP.id, 'conta-principal']]));
    assert.ok(d !== undefined);
    assert.equal(d.coletiva, false);
    assert.equal(d.configuracao, 'conta-principal', 'o APELIDO da Configuracao, e nao o id interno');
    assert.equal(d.nome, 'Bruno Contato');
    assert.equal(d.origemDoNome, 'contatos');
    assert.equal(d.mensagens, 3);
    assert.equal(d.primeiraMensagemEm, minuto(1));
    assert.equal(d.ultimaMensagemEm, minuto(3));
    assert.equal('metadados' in d, false, 'a direta nao carrega campo de grupo');
  } finally {
    limpar();
  }
});

test('a direta sem nome gravado devolve nome e origem nulos', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const d = detalharConversa(acervo, s.diretaDeEdu, PRECEDENCIA);
    assert.equal(d?.nome, null);
    assert.equal(d?.origemDoNome, null);
    assert.equal(d?.mensagens, 0);
  } finally {
    limpar();
  }
});

test('Conversa que nao existe devolve undefined', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    assert.equal(detalharConversa(acervo, 'nao-existe', PRECEDENCIA), undefined);
  } finally {
    limpar();
  }
});

// #1323: a coletiva traz o endereco dela na Fonte (o que `--para` aceita); a direta nao tem o campo, porque o endereco
// de uma Pessoa ja sai por `identificar`, `participantes` e `autores`.
test('a coletiva traz o endereco dela na Fonte e a direta nao tem o campo', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const grupo = detalharConversa(acervo, s.grupo, PRECEDENCIA);
    assert.ok(grupo !== undefined);
    assert.equal(grupo.endereco, 'grupo-1@g.us');

    const direta = detalharConversa(acervo, s.diretaDeBruno, PRECEDENCIA);
    assert.ok(direta !== undefined);
    assert.equal('endereco' in direta, false);
  } finally {
    limpar();
  }
});
