import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { criarRegistroNoPiso } from './ajuda/registro-no-piso.js';
import { abrirRegistro, VERSAO_SCHEMA_REGISTRO } from '../src/registro/registro.js';

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
