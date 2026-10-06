import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { criarRegistroNoPiso } from './ajuda/registro-no-piso.js';
import { abrirRegistro, VERSAO_SCHEMA_REGISTRO } from '../src/registro/registro.js';
import { cenario } from './ajuda/acervo.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import {
  declararTelefoneDaConta,
  lerEnderecosDaConta,
  registrarEnderecosDoVinculo,
  TelefoneJaConferidoError,
  telefoneValido,
} from '../src/registro/endereco-da-conta.js';

test('o Registro de forma anterior sobe para a v8 e ganha a tabela de enderecos da conta, vazia', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    criarRegistroNoPiso(raiz);
    const r = abrirRegistro(raiz);
    try {
      assert.equal(VERSAO_SCHEMA_REGISTRO, 8);
      assert.equal(r.versaoDoSchema(), 8);
      const colunas = r.db.prepare('PRAGMA table_info(enderecos_da_conta)').all() as Array<{ name: string }>;
      assert.deepEqual(
        colunas.map((c) => c.name),
        ['configuracao_id', 'telefone', 'jid', 'lid', 'declarado_em', 'conferido_em'],
      );
      const n = (r.db.prepare('SELECT COUNT(*) AS n FROM enderecos_da_conta').get() as { n: number }).n;
      assert.equal(n, 0, 'instalacao que existia antes nao declarou telefone nenhum');
    } finally {
      r.fechar();
    }
  } finally {
    limpar();
  }
});

function contarOperacoes(c: ReturnType<typeof cenario>): number {
  return (c.registro.db.prepare('SELECT COUNT(*) AS n FROM operacoes').get() as { n: number }).n;
}

test('telefoneValido: so digitos, de 10 a 15', () => {
  assert.equal(telefoneValido('5511900000001'), true);
  assert.equal(telefoneValido('123456789'), false); // 9
  assert.equal(telefoneValido('1234567890123456'), false); // 16
  assert.equal(telefoneValido('+5511900000001'), false);
  assert.equal(telefoneValido('55 11 90000-0001'), false);
});

test('declarar o telefone grava, e uma Operacao por efeito diz quem foi', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    assert.equal(lerEnderecosDaConta(c.registro, cfg.id), undefined, 'antes de declarar nao ha linha');

    const antes = contarOperacoes(c);
    declararTelefoneDaConta(c.registro, cfg.id, '5511900000001');
    const e = lerEnderecosDaConta(c.registro, cfg.id);
    assert.equal(e?.telefone, '5511900000001');
    assert.equal(e?.jid, null);
    assert.equal(e?.lid, null);
    assert.equal(e?.conferidoEm, null, 'declarar nao e conferir');
    assert.equal(contarOperacoes(c), antes + 1);
  } finally {
    c.limpar();
  }
});

test('declarar o MESMO telefone de novo nao escreve nem abre Operacao', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    declararTelefoneDaConta(c.registro, cfg.id, '5511900000001');
    const antes = contarOperacoes(c);
    declararTelefoneDaConta(c.registro, cfg.id, '5511900000001');
    assert.equal(contarOperacoes(c), antes);
  } finally {
    c.limpar();
  }
});

test('telefone invalido e recusado e nada e gravado', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    assert.throws(() => declararTelefoneDaConta(c.registro, cfg.id, '123'), /telefone invalido/);
    assert.equal(lerEnderecosDaConta(c.registro, cfg.id), undefined);
  } finally {
    c.limpar();
  }
});

test('o que o vinculo mostra grava JID e LID, completa o telefone ausente e marca conferido', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    const mudou = registrarEnderecosDoVinculo(c.registro, cfg.id, {
      telefone: '5511900000001',
      jid: '5511900000001@s.whatsapp.net',
      lid: '100000000000001@lid',
    });
    assert.equal(mudou, true);
    const e = lerEnderecosDaConta(c.registro, cfg.id);
    assert.equal(e?.telefone, '5511900000001', 'telefone aprendido quando nao declarado');
    assert.equal(e?.jid, '5511900000001@s.whatsapp.net');
    assert.equal(e?.lid, '100000000000001@lid');
    assert.notEqual(e?.conferidoEm, null);
  } finally {
    c.limpar();
  }
});

test('o telefone DECLARADO nao e sobrescrito pelo do vinculo (difere so pelo nono digito)', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    declararTelefoneDaConta(c.registro, cfg.id, '5511999990001'); // com 9
    registrarEnderecosDoVinculo(c.registro, cfg.id, {
      telefone: '551199990001', // sem 9, como a Fonte entrega
      jid: '551199990001@s.whatsapp.net',
      lid: null,
    });
    const e = lerEnderecosDaConta(c.registro, cfg.id);
    assert.equal(e?.telefone, '5511999990001', 'o que o humano declarou fica');
    assert.equal(e?.jid, '551199990001@s.whatsapp.net', 'o JID e o que a Fonte entrega');
  } finally {
    c.limpar();
  }
});

test('registrar de novo o mesmo que o vinculo mostrou NAO escreve nem abre Operacao (idempotente)', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    const entrada = {
      telefone: '5511900000001',
      jid: '5511900000001@s.whatsapp.net',
      lid: '100000000000001@lid',
    };
    registrarEnderecosDoVinculo(c.registro, cfg.id, entrada);
    const antes = contarOperacoes(c);
    assert.equal(registrarEnderecosDoVinculo(c.registro, cfg.id, entrada), false);
    assert.equal(contarOperacoes(c), antes);
  } finally {
    c.limpar();
  }
});

test('LID que aparece depois completa a linha; LID ja gravado nao e apagado por um vinculo sem LID', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    const base = { telefone: '5511900000001', jid: '5511900000001@s.whatsapp.net' };
    registrarEnderecosDoVinculo(c.registro, cfg.id, { ...base, lid: null });
    assert.equal(lerEnderecosDaConta(c.registro, cfg.id)?.lid, null);
    assert.equal(registrarEnderecosDoVinculo(c.registro, cfg.id, { ...base, lid: '100000000000001@lid' }), true);
    assert.equal(lerEnderecosDaConta(c.registro, cfg.id)?.lid, '100000000000001@lid');
    registrarEnderecosDoVinculo(c.registro, cfg.id, { ...base, lid: null });
    assert.equal(lerEnderecosDaConta(c.registro, cfg.id)?.lid, '100000000000001@lid', 'ausencia nao apaga');
  } finally {
    c.limpar();
  }
});

test('trocar o telefone de uma Configuracao ja CONFERIDA e recusado (conta nova e Configuracao nova)', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    registrarEnderecosDoVinculo(c.registro, cfg.id, {
      telefone: '5511900000001',
      jid: '5511900000001@s.whatsapp.net',
      lid: null,
    });
    assert.throws(
      () => declararTelefoneDaConta(c.registro, cfg.id, '5511900000002'),
      (e: unknown) => e instanceof TelefoneJaConferidoError,
    );
    assert.equal(lerEnderecosDaConta(c.registro, cfg.id)?.telefone, '5511900000001');
  } finally {
    c.limpar();
  }
});

test('os Enderecos da Conta nao atravessam Configuracao', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const a = resolverConfiguracao(c.registro, id, 'whatsapp', 'a');
    const b = resolverConfiguracao(c.registro, id, 'whatsapp', 'b');
    declararTelefoneDaConta(c.registro, a.id, '5511900000001');
    assert.equal(lerEnderecosDaConta(c.registro, b.id), undefined);
  } finally {
    c.limpar();
  }
});

test('as Operacoes: declarar e por-efeito (redefinir e declarar de novo); conferir pelo vinculo e irreversivel', () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    declararTelefoneDaConta(c.registro, cfg.id, '5511900000001');
    registrarEnderecosDoVinculo(c.registro, cfg.id, {
      telefone: '5511900000001',
      jid: '5511900000001@s.whatsapp.net',
      lid: null,
    });
    const ops = c.registro.db
      .prepare(
        `SELECT natureza, reversibilidade FROM operacoes
          WHERE natureza IN ('declarar-telefone-da-conta', 'conferir-conta-do-vinculo')
          ORDER BY natureza`,
      )
      .all() as Array<{ natureza: string; reversibilidade: string }>;
    assert.deepEqual(ops, [
      { natureza: 'conferir-conta-do-vinculo', reversibilidade: 'irreversivel' },
      { natureza: 'declarar-telefone-da-conta', reversibilidade: 'por-efeito' },
    ]);
  } finally {
    c.limpar();
  }
});
