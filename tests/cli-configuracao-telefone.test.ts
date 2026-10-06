import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoComInquilino, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { configuracaoPorApelido } from '../src/registro/configuracao-adaptador.js';
import { registrarEnderecosDoVinculo } from '../src/registro/endereco-da-conta.js';

const CRIAR = (inq: string, apelido: string, extra: string[] = []): string[] =>
  ['configuracao', 'criar', '--inquilino', inq, '--fonte', 'whatsapp', '--configuracao', apelido, ...extra];

test('criar WhatsApp sem --telefone sai 2, diz como informar e nao grava nada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    const r = rodar(raiz, CRIAR(inq, 'principal'));
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /--telefone/);
    assert.equal(rodar(raiz, ['configuracao', 'listar', '--inquilino', inq]).saida, '', 'nada foi criado');
  } finally {
    limpar();
  }
});

test('criar com telefone invalido sai 2 e nao grava nada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    for (const ruim of ['123', '+5511900000001', '55 11 9', '5511900000001x']) {
      assert.equal(rodar(raiz, CRIAR(inq, 'principal', ['--telefone', ruim])).codigo, 2, ruim);
    }
    assert.equal(rodar(raiz, ['configuracao', 'listar', '--inquilino', inq]).saida, '');
  } finally {
    limpar();
  }
});

test('criar com telefone grava, e listar mostra telefone e os campos nao conferidos', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    const c = rodar(raiz, CRIAR(inq, 'principal', ['--telefone', '5511900000001', '--conta', 'pessoal']));
    assert.equal(c.codigo, 0, c.saida);
    const l = rodar(raiz, ['configuracao', 'listar', '--inquilino', inq]);
    assert.equal(l.codigo, 0);
    assert.match(l.saida, /^whatsapp\/principal {2}conta: pessoal {2}telefone: 5511900000001 {2}jid: \(nao conferido\) {2}lid: \(nao conferido\)$/);
  } finally {
    limpar();
  }
});

test('criar de Instagram NAO exige telefone e a linha de listar nao muda', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    const c = rodar(raiz, ['configuracao', 'criar', '--inquilino', inq, '--fonte', 'instagram', '--configuracao', 'perfil']);
    assert.equal(c.codigo, 0, c.saida);
    assert.equal(
      rodar(raiz, ['configuracao', 'listar', '--inquilino', inq]).saida,
      'instagram/perfil  conta: (nao declarada)',
    );
  } finally {
    limpar();
  }
});

test('o mesmo telefone em outra Configuracao do Inquilino e recusado, tambem com ou sem o nono digito', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    assert.equal(rodar(raiz, CRIAR(inq, 'a', ['--telefone', '5511999990001'])).codigo, 0);
    const igual = rodar(raiz, CRIAR(inq, 'b', ['--telefone', '5511999990001']));
    assert.equal(igual.codigo, 2);
    assert.match(igual.saida, /ja pertence a Configuracao a/);
    const semNono = rodar(raiz, CRIAR(inq, 'c', ['--telefone', '551199990001']));
    assert.equal(semNono.codigo, 2, 'com e sem o nono digito e a mesma conta');
    assert.equal(rodar(raiz, CRIAR(inq, 'd', ['--telefone', '5511999990002'])).codigo, 0, 'outro numero convive');
  } finally {
    limpar();
  }
});

test('definir-telefone de Configuracao desconhecida sai 2 e nao cria nada', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    const r = rodar(raiz, [
      'configuracao', 'definir-telefone', '--inquilino', inq,
      '--configuracao', 'inexistente', '--telefone', '5511900000001',
    ]);
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /desconhecida/);
    assert.equal(rodar(raiz, ['configuracao', 'listar', '--inquilino', inq]).saida, '', 'definir nao cria');
  } finally {
    limpar();
  }
});

test('definir-telefone grava e listar mostra; telefone invalido sai 2', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    assert.equal(rodar(raiz, CRIAR(inq, 'a', ['--telefone', '5511900000001'])).codigo, 0);
    assert.equal(rodar(raiz, ['configuracao', 'definir-telefone', '--inquilino', inq, '--configuracao', 'a', '--telefone', '12']).codigo, 2);
    const ok = rodar(raiz, ['configuracao', 'definir-telefone', '--inquilino', inq, '--configuracao', 'a', '--telefone', '5511900000009']);
    assert.equal(ok.codigo, 0, ok.saida);
    assert.match(rodar(raiz, ['configuracao', 'listar', '--inquilino', inq]).saida, /telefone: 5511900000009/);
  } finally {
    limpar();
  }
});

test('definir-telefone tambem recusa o telefone de OUTRA Configuracao do Inquilino (com ou sem o nono digito)', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    assert.equal(rodar(raiz, CRIAR(inq, 'a', ['--telefone', '5511999990001'])).codigo, 0);
    assert.equal(rodar(raiz, CRIAR(inq, 'b', ['--telefone', '5511999990002'])).codigo, 0);
    const igual = rodar(raiz, ['configuracao', 'definir-telefone', '--inquilino', inq, '--configuracao', 'b', '--telefone', '5511999990001']);
    assert.equal(igual.codigo, 2);
    assert.match(igual.saida, /ja pertence a Configuracao a/);
    const semNono = rodar(raiz, ['configuracao', 'definir-telefone', '--inquilino', inq, '--configuracao', 'b', '--telefone', '551199990001']);
    assert.equal(semNono.codigo, 2, 'o mesmo celular sem o nono digito');
  } finally {
    limpar();
  }
});

test('definir-telefone numa Configuracao ja CONFERIDA pelo vinculo sai 2 dizendo que conta nova e Configuracao nova', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    assert.equal(rodar(raiz, CRIAR(inq, 'a', ['--telefone', '5511999990001'])).codigo, 0);
    const registro = abrirRegistro(raiz);
    try {
      const cfg = configuracaoPorApelido(registro, inq, 'whatsapp', 'a');
      assert.ok(cfg);
      registrarEnderecosDoVinculo(registro, cfg.id, {
        telefone: '5511999990001',
        jid: '5511999990001@s.whatsapp.net',
        lid: null,
      });
    } finally {
      registro.fechar();
    }
    const r = rodar(raiz, ['configuracao', 'definir-telefone', '--inquilino', inq, '--configuracao', 'a', '--telefone', '5511999990009']);
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /Configuracao nova/);
    const c = rodar(raiz, CRIAR(inq, 'a', ['--telefone', '5511999990009']));
    assert.equal(c.codigo, 2, 'criar de novo com outro telefone tambem recusa');
  } finally {
    limpar();
  }
});

test('a --ajuda declara --telefone em criar e o comando definir-telefone', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { saida } = rodar(raiz, ['--ajuda']);
    assert.match(saida, /configuracao criar[^\n]*--telefone/);
    assert.match(saida, /configuracao definir-telefone[^\n]*--telefone/);
  } finally {
    limpar();
  }
});
