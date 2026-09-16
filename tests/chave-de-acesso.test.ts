import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import {
  emitirChaveDeAcesso,
  verificarChaveDeAcesso,
  revogarChaveDeAcesso,
  listarChavesDeAcesso,
} from '../src/registro/chave-de-acesso.js';
import { VERSAO_SCHEMA_REGISTRO } from '../src/registro/schema.js';

test('o Registro novo nasce na forma corrente, com a tabela de Chave de Acesso', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      // Contra a CONSTANTE, e nao contra um literal: o que este teste mede e
      // que a base recem-criada carimba a forma que o codigo diz ser a
      // corrente, e isso vale em qualquer versao. O changelog de versoes —
      // com a razao de cada uma — vive no teste do Acervo, e la o literal e
      // deliberado: ele obriga quem sobe a versao a documentar por que.
      const versao = registro.db
        .prepare('SELECT versao FROM versao_schema')
        .get() as { versao: number };
      assert.equal(versao.versao, VERSAO_SCHEMA_REGISTRO);
      const tabela = registro.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chaves_de_acesso'")
        .get();
      assert.notEqual(tabela, undefined, 'a tabela existe no schema fresco');
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('emitir devolve o valor uma vez, e ele nao e recuperavel depois', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Leia' });
    const chave = emitirChaveDeAcesso(registro, inquilino);

    assert.ok(chave.valor.length >= 32, 'o valor tem entropia suficiente');
    // O que fica gravado nao permite reconstruir o valor. Guardar o valor
    // seria trocar uma credencial por um banco cheio delas — a mesma
    // disciplina da Chave de Operador, e a razao de existirem sal e derivacao.
    const linha = registro.db
      .prepare('SELECT * FROM chaves_de_acesso WHERE id = ?')
      .get(chave.id) as Record<string, unknown>;
    for (const [campo, valor] of Object.entries(linha)) {
      assert.ok(
        typeof valor !== 'string' || !valor.includes(chave.valor),
        `o campo ${campo} nao pode conter o valor da Chave`,
      );
    }
  } finally {
    registro.fechar();
    limpar();
  }
});

test('a Chave conhece o Inquilino dela, e a verificacao o devolve', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Han' });
    const chave = emitirChaveDeAcesso(registro, inquilino);

    // E ISTO que faz o Inquilino vir da credencial e nunca do chamador: quem
    // verifica ja sai sabendo o alcance, sem precisar perguntar a ninguem.
    const quem = verificarChaveDeAcesso(registro, chave.valor);
    assert.notEqual(quem, null);
    assert.equal(quem?.inquilinoId, inquilino);
    assert.equal(quem?.chaveId, chave.id);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('emitir para Inquilino inexistente e recusado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    // A chave estrangeira barraria sozinha — medido em 03/09/2026,
    // `PRAGMA foreign_keys` devolve 1 na conexao do Registro. A checagem
    // explicita existe pela MENSAGEM: erro de FK diz "constraint failed" e
    // nao diz qual Inquilino nao existe.
    assert.throws(() => emitirChaveDeAcesso(registro, 'nao-existe'), /Inquilino desconhecido/);
    const n = registro.db
      .prepare('SELECT COUNT(*) AS n FROM chaves_de_acesso')
      .get() as { n: number };
    assert.equal(n.n, 0, 'nada foi gravado');
  } finally {
    registro.fechar();
    limpar();
  }
});

test('valor que nao corresponde a Chave nenhuma nao resolve Inquilino', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    criarInquilino(registro, { titularNome: 'Chewbacca' });
    assert.equal(verificarChaveDeAcesso(registro, 'nao-e-uma-chave'), null);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('a trilha registra a emissao SEM material de credencial', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Lando' });
    const chave = emitirChaveDeAcesso(registro, inquilino);
    // A trilha e lida por quem audita, nao por quem autentica. Material de
    // credencial nao ganha uma segunda casa — mesmo padrao da Chave de
    // Operador e de `criarPessoa`.
    const efeitos = registro.db.prepare('SELECT antes, depois FROM linhas_de_efeito').all();
    const texto = JSON.stringify(efeitos);
    assert.ok(!texto.includes(chave.valor), 'o valor nao entra na trilha');
    const linha = registro.db
      .prepare('SELECT sal, hash FROM chaves_de_acesso WHERE id = ?')
      .get(chave.id) as { sal: string; hash: string };
    assert.ok(!texto.includes(linha.hash), 'nem o hash');
    assert.ok(!texto.includes(linha.sal), 'nem o sal');
  } finally {
    registro.fechar();
    limpar();
  }
});

test('revogar tem efeito na verificacao seguinte', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Rey' });
    const chave = emitirChaveDeAcesso(registro, inquilino);
    assert.notEqual(verificarChaveDeAcesso(registro, chave.valor), null);

    revogarChaveDeAcesso(registro, chave.id);
    // Sem espera, sem cache, sem reinicio. A verificacao consulta o Registro a
    // cada chamada — e e por isso que este teste pode ser tao direto.
    assert.equal(verificarChaveDeAcesso(registro, chave.valor), null);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('revogar uma nao afeta as outras do mesmo Inquilino', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Finn' });
    const a = emitirChaveDeAcesso(registro, inquilino);
    const b = emitirChaveDeAcesso(registro, inquilino);
    revogarChaveDeAcesso(registro, a.id);
    assert.equal(verificarChaveDeAcesso(registro, a.valor), null);
    assert.notEqual(verificarChaveDeAcesso(registro, b.valor), null, 'a outra continua valendo');
  } finally {
    registro.fechar();
    limpar();
  }
});

test('revogar Chave ja revogada nao e erro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Poe' });
    const chave = emitirChaveDeAcesso(registro, inquilino);
    revogarChaveDeAcesso(registro, chave.id);
    // Idempotente: quem revoga duas vezes quer o mesmo estado, e ja o tem.
    assert.doesNotThrow(() => revogarChaveDeAcesso(registro, chave.id));
  } finally {
    registro.fechar();
    limpar();
  }
});

test('listar mostra estado e datas, e NUNCA valor', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Jyn' });
    const a = emitirChaveDeAcesso(registro, inquilino);
    const b = emitirChaveDeAcesso(registro, inquilino);
    revogarChaveDeAcesso(registro, a.id);

    const lista = listarChavesDeAcesso(registro, inquilino);
    assert.equal(lista.length, 2, 'o Titular ve TODAS as Chaves do Inquilino dele');
    const texto = JSON.stringify(lista);
    assert.ok(!texto.includes(a.valor) && !texto.includes(b.valor), 'nenhum valor na saida');
    const revogada = lista.find((c) => c.id === a.id);
    assert.notEqual(revogada?.revogadaEm, null);
    assert.equal(lista.find((c) => c.id === b.id)?.revogadaEm, null);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('listar de um Inquilino nao mostra Chave de outro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    // DOIS Inquilinos povoados. Com um so, o teste de isolamento passa por
    // vacuidade: nao ha de onde vazar.
    const meu = criarInquilino(registro, { titularNome: 'Bodhi' });
    const outro = criarInquilino(registro, { titularNome: 'Baze' });
    emitirChaveDeAcesso(registro, meu);
    const alheia = emitirChaveDeAcesso(registro, outro);

    const lista = listarChavesDeAcesso(registro, meu);
    assert.equal(lista.length, 1);
    assert.ok(!lista.some((c) => c.id === alheia.id));
  } finally {
    registro.fechar();
    limpar();
  }
});

test('a tentativa registra o Inquilino alvo quando ele e resolvivel', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Cassian' });
    const chave = emitirChaveDeAcesso(registro, inquilino);
    verificarChaveDeAcesso(registro, chave.valor);
    verificarChaveDeAcesso(registro, 'nao-casa-com-nada');

    const linhas = registro.db
      .prepare('SELECT aceita, inquilino_alvo FROM tentativas_de_chave ORDER BY id DESC LIMIT 2')
      .all() as Array<{ aceita: number; inquilino_alvo: string | null }>;
    const recusada = linhas.find((l) => l.aceita === 0);
    const aceita = linhas.find((l) => l.aceita === 1);
    assert.equal(aceita?.inquilino_alvo, inquilino, 'resolvivel: grava o alvo');
    // A coluna existe desde a forma 2 e NUNCA foi preenchida — medido em
    // producao em 03/09/2026: 1 tentativa, 0 com alvo. Recusada sem casar nao
    // resolve Inquilino nenhum, e a ausencia e o dado honesto.
    assert.equal(recusada?.inquilino_alvo, null, 'nao resolvivel: ausencia declarada');
  } finally {
    registro.fechar();
    limpar();
  }
});
