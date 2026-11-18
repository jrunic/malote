import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import {
  declararTelefoneDaConta,
  lerEnderecosDaConta,
  registrarEnderecosDoVinculo,
  trocarTelefoneDaConta,
} from '../src/registro/endereco-da-conta.js';

/** A porta do Registro de `configuracao trocar-telefone` (#1564). Numeros sinteticos. */
const ANTIGO = '5511900000001';
const NOVO = '5511900000002';

function comConta(corpo: (c: ReturnType<typeof cenario>, configuracaoId: string) => void): void {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const cfg = resolverConfiguracao(c.registro, id, 'whatsapp', 'principal');
    corpo(c, cfg.id);
  } finally {
    c.limpar();
  }
}

const operacoes = (c: ReturnType<typeof cenario>): Array<{ natureza: string; reversibilidade: string }> =>
  c.registro.db
    .prepare(`SELECT natureza, reversibilidade FROM operacoes WHERE natureza = 'trocar-telefone-da-conta'`)
    .all() as Array<{ natureza: string; reversibilidade: string }>;

test('trocar grava o telefone novo, abre UMA Operacao por-efeito com o antes e o depois, e NAO toca jid, lid nem a conferencia', () => {
  comConta((c, cfg) => {
    declararTelefoneDaConta(c.registro, cfg, ANTIGO);
    registrarEnderecosDoVinculo(c.registro, cfg, { telefone: ANTIGO, jid: `${ANTIGO}@s.whatsapp.net`, lid: '100000000000001@lid' });
    const antes = lerEnderecosDaConta(c.registro, cfg)!;

    assert.equal(trocarTelefoneDaConta(c.registro, cfg, NOVO), true);

    const depois = lerEnderecosDaConta(c.registro, cfg)!;
    assert.equal(depois.telefone, NOVO);
    assert.equal(depois.jid, antes.jid, 'o jid fica como o vinculo o mostrou');
    assert.equal(depois.lid, antes.lid);
    assert.equal(depois.conferidoEm, antes.conferidoEm, 'a conferencia nao e regravada');
    assert.deepEqual(operacoes(c), [{ natureza: 'trocar-telefone-da-conta', reversibilidade: 'por-efeito' }]);
    const linhas = c.registro.db
      .prepare(
        `SELECT l.campo, l.antes, l.depois FROM linhas_de_efeito l JOIN operacoes o ON o.id = l.operacao_id
          WHERE o.natureza = 'trocar-telefone-da-conta' AND l.natureza = 'valor'`,
      )
      .all() as Array<{ campo: string; antes: string | null; depois: string | null }>;
    assert.equal(linhas.length, 1, 'um unico valor gravado: o telefone');
    assert.deepEqual(linhas[0], { campo: 'telefone', antes: ANTIGO, depois: NOVO });
  });
});

test('o mesmo telefone nao escreve nem abre Operacao', () => {
  comConta((c, cfg) => {
    declararTelefoneDaConta(c.registro, cfg, ANTIGO);
    assert.equal(trocarTelefoneDaConta(c.registro, cfg, ANTIGO), false);
    assert.deepEqual(operacoes(c), []);
  });
});

test('Configuracao sem telefone declarado e recusada, e nada e criado', () => {
  comConta((c, cfg) => {
    assert.throws(() => trocarTelefoneDaConta(c.registro, cfg, NOVO), /nao tem telefone declarado/);
    assert.equal(lerEnderecosDaConta(c.registro, cfg), undefined, 'a troca nunca cria a linha');
    assert.deepEqual(operacoes(c), []);
  });
});

test('telefone invalido e recusado', () => {
  comConta((c, cfg) => {
    declararTelefoneDaConta(c.registro, cfg, ANTIGO);
    for (const ruim of ['12', '+5511900000002', '5511900000002x']) {
      assert.throws(() => trocarTelefoneDaConta(c.registro, cfg, ruim), /telefone invalido/, ruim);
    }
    assert.equal(lerEnderecosDaConta(c.registro, cfg)!.telefone, ANTIGO);
  });
});

test('voltar atras e rodar de novo com o numero anterior: devolve o telefone e abre outra Operacao', () => {
  comConta((c, cfg) => {
    declararTelefoneDaConta(c.registro, cfg, ANTIGO);
    trocarTelefoneDaConta(c.registro, cfg, NOVO);
    assert.equal(trocarTelefoneDaConta(c.registro, cfg, ANTIGO), true);
    assert.equal(lerEnderecosDaConta(c.registro, cfg)!.telefone, ANTIGO);
    assert.equal(operacoes(c).length, 2);
  });
});
