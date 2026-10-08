// tests/reprocessar-descartados-comando.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { caminhosDaConta } from '../src/cli/ouvir.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';

const DOCUMENTO_GUARDADO = JSON.stringify({
  em: '2026-09-01T00:00:00.000Z',
  motivo: 'documentWithCaptionMessage',
  evento: {
    key: { remoteJid: '5511000000000@s.whatsapp.net', id: 'CMD1', fromMe: false },
    messageTimestamp: Math.floor(Date.parse('2026-09-08T12:00:00Z') / 1000),
    message: { documentWithCaptionMessage: { message: { documentMessage: { mimetype: 'text/csv', fileName: 'r.csv', fileLength: '9', caption: 'oi' } } } },
  },
});

function instalacao() {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Cassian' });
  resolverConfiguracao(registro, id, 'whatsapp', 'principal');
  registro.fechar();
  const guarda = caminhosDaConta(raiz, 'principal').guarda;
  mkdirSync(dirname(guarda), { recursive: true });
  return { raiz, id, guarda, limpar };
}

const ARGS = (id: string): string[] => ['ouvinte', 'reprocessar-descartados', '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'];

test('RECUSA com o ouvinte no ar e deixa a guarda intacta', () => {
  const i = instalacao();
  try {
    writeFileSync(i.guarda, `${DOCUMENTO_GUARDADO}\n`);
    const linhas: string[] = [];
    const codigo = executar(ARGS(i.id), {
      dados: i.raiz, estado: i.raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => true,
    });
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /Pare o servico antes de reprocessar/);
    assert.equal(readFileSync(i.guarda, 'utf8'), `${DOCUMENTO_GUARDADO}\n`);
  } finally {
    i.limpar();
  }
});

test('sem ouvinte no ar, grava o que foi guardado e esvazia a guarda', () => {
  const i = instalacao();
  try {
    writeFileSync(i.guarda, `${DOCUMENTO_GUARDADO}\n`);
    const linhas: string[] = [];
    const codigo = executar(ARGS(i.id), {
      dados: i.raiz, estado: i.raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false,
    });
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.match(linhas.join('\n'), /1 evento\(s\) lido\(s\), 1 gravado\(s\), 0 mantido\(s\)/);
    assert.equal(existsSync(i.guarda), false);
    const acervo = abrirAcervoSomenteLeitura(`${i.raiz}/acervos`, i.id);
    try {
      const n = acervo.preparar('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
      assert.equal(n.n, 1);
    } finally {
      acervo.fechar();
    }
  } finally {
    i.limpar();
  }
});

test('sem nada guardado, diz que nao ha o que fazer e nao abre o Acervo', () => {
  const i = instalacao();
  try {
    const linhas: string[] = [];
    const codigo = executar(ARGS(i.id), {
      dados: i.raiz, estado: i.raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false,
    });
    assert.equal(codigo, 0);
    assert.match(linhas.join('\n'), /nada guardado/);
    assert.equal(existsSync(`${i.raiz}/acervos`), false, 'abriu (e criou) o Acervo sem ter o que reprocessar');
  } finally {
    i.limpar();
  }
});

test('Configuracao que nao existe e erro, e reprocessar NAO cria', () => {
  const i = instalacao();
  try {
    writeFileSync(i.guarda, `${DOCUMENTO_GUARDADO}\n`);
    const linhas: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar-descartados', '--inquilino', i.id, '--conta', 'principal', '--configuracao', 'outra'],
      { dados: i.raiz, estado: i.raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false },
    );
    // `executar` NAO lanca: o erro vira codigo diferente de zero e mensagem (molde de tests/derrame-reprocessar.test.ts).
    assert.notEqual(codigo, 0);
    assert.match(linhas.join('\n'), /nao existe/i);
    assert.equal(existsSync(i.guarda), true, 'a guarda foi descartada sem ter sido gravada');
  } finally {
    i.limpar();
  }
});

test('sem os argumentos, mostra o uso e sai 2', () => {
  const i = instalacao();
  try {
    const linhas: string[] = [];
    const codigo = executar(['ouvinte', 'reprocessar-descartados'], {
      dados: i.raiz, estado: i.raiz, escrever: (t: string) => linhas.push(t),
    });
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /Uso: malote ouvinte reprocessar-descartados/);
  } finally {
    i.limpar();
  }
});
