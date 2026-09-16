import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import {
  instalacaoComChave,
  instalacaoComInquilino,
  instalacaoTemporaria,
  rodar,
} from './ajuda/instalacao.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { recriarAcervo } from '../src/nucleo/recriar.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { contarAcervo } from '../src/nucleo/consulta.js';


test('recriar apaga o Acervo; reabrir devolve Acervo vazio', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });
    assert.equal(contarAcervo(acervo).identificadores, 1);
    acervo.fechar();

    const pasta = join(c.raiz, 'acervos');
    assert.equal(existsSync(join(pasta, `${id}.db`)), true);

    recriarAcervo(pasta, id);
    assert.equal(existsSync(join(pasta, `${id}.db`)), false);

    const novo = abrirAcervo(pasta, id);
    assert.equal(contarAcervo(novo).identificadores, 0);
    novo.fechar();
  } finally {
    c.limpar();
  }
});

test('a CLI recusa recriar sem confirmação declarada, e nada é apagado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const arquivo = join(raiz, 'acervos', `${inquilino}.db`);
    assert.equal(existsSync(arquivo), true, 'o Acervo precisa existir antes do teste');

    const r = rodar(raiz, ['acervo', 'recriar', '--inquilino', inquilino]);

    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /--confirmo/);
    assert.equal(existsSync(arquivo), true);
  } finally {
    limpar();
  }
});

test('recriar Inquilino inexistente é recusado, não é sucesso silencioso', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    instalacaoComInquilino(raiz);

    // rmSync com force sobre caminho ausente e no-op: sem a checagem de
    // existencia, um id errado sai com sucesso e o Acervo real fica intacto,
    // enquanto quem digitou acredita ter recriado.
    const r = rodar(raiz, ['acervo', 'recriar', '--inquilino', 'nao-existe', '--confirmo']);

    assert.notEqual(r.codigo, 0);
    // `Inquilino desconhecido`, e nao so `desconhecido`: a CLI ja responde
    // `Comando desconhecido` a comando inexistente, e a asserção frouxa passava
    // verde antes de o comando existir. Medido ao executar a Task.
    assert.match(r.saida, /Inquilino desconhecido/);
  } finally {
    limpar();
  }
});

test('recriar apaga a subárvore do Inquilino e não toca no vizinho da mesma raiz', () => {
  const c = cenario();
  try {
    const raizDestino = c.raizDeDestinoCompartilhada();
    const a = c.inquilinoComArquivos({ destino: raizDestino });
    const b = c.inquilinoComArquivos({ destino: raizDestino });
    a.acervo.fechar();

    const arquivosDeB = readdirSync(join(raizDestino, b.id), { recursive: true }).length;
    assert.ok(arquivosDeB > 0);
    assert.equal(existsSync(join(raizDestino, a.id)), true);

    recriarAcervo(join(c.raiz, 'acervos'), a.id, { destino: raizDestino });

    assert.equal(existsSync(join(raizDestino, a.id)), false, 'a subárvore sai junto do banco');
    assert.equal(existsSync(raizDestino), true, 'a raiz do Destino NUNCA é apagada');
    assert.equal(readdirSync(join(raizDestino, b.id), { recursive: true }).length, arquivosDeB);
  } finally {
    c.limpar();
  }
});

test('recriar recusa identificador de Inquilino que escaparia da raiz', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    // O id vem do Registro e é um UUID, mas a guarda é estrutural: `join` com
    // `..` sai da raiz, e esta é a única operação do produto que apaga em
    // massa. Guarda de última linha, não validação de entrada.
    assert.throws(
      () => recriarAcervo(join(raiz, 'acervos'), '..', { destino: join(raiz, 'destino') }),
      /identificador de Inquilino invalido/i,
    );
  } finally {
    limpar();
  }
});

test('recriar sem Destino apaga só o banco, e não estoura', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    acervo.fechar();
    recriarAcervo(join(c.raiz, 'acervos'), id);
    assert.equal(existsSync(join(c.raiz, 'acervos', `${id}.db`)), false);
  } finally {
    c.limpar();
  }
});

test('recriar declara que a trilha do Acervo vai junto, e grava a Operação no Registro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);

    const r = rodar(raiz, ['acervo', 'recriar', '--inquilino', inquilino, '--chave', chave, '--confirmo']);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /trilha/i, 'a perda da trilha é declarada');

    const registro = abrirRegistro(raiz);
    try {
      const ops = listarOperacoesCruas(registro).filter((o) => o.natureza === 'recriar-acervo');
      assert.equal(ops.length, 1);
      assert.equal(ops[0]?.reversibilidade, 'irreversivel');
      const coluna = registro.db
        .prepare('SELECT inquilino_id FROM operacoes WHERE id = ?')
        .get(ops[0]?.id) as { inquilino_id: string | null };
      assert.equal(coluna.inquilino_id, inquilino, 'a Operação sobrevive ao Acervo que registra');
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});
