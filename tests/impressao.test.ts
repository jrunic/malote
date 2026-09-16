import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { entradasDaArvore, impressaoDeEntradas } from '../src/adaptadores/impressao.js';

const SO_MENSAGENS = /^message_\d+\.json$/;

test('a impressão não depende do caminho: mesma árvore em outro lugar, mesma impressão', () => {
  const a = instalacaoTemporaria();
  const b = instalacaoTemporaria();
  try {
    mkdirSync(join(a.raiz, 'x'), { recursive: true });
    writeFileSync(join(a.raiz, 'x', 'message_1.json'), 'conteudo');
    cpSync(a.raiz, join(b.raiz, 'copia'), { recursive: true });

    assert.equal(
      impressaoDeEntradas(entradasDaArvore(a.raiz, SO_MENSAGENS)),
      impressaoDeEntradas(entradasDaArvore(join(b.raiz, 'copia'), SO_MENSAGENS)),
    );
  } finally {
    a.limpar();
    b.limpar();
  }
});

test('árvores com os mesmos nomes e tamanhos diferentes têm impressões diferentes', () => {
  const a = instalacaoTemporaria();
  const b = instalacaoTemporaria();
  try {
    for (const [raiz, texto] of [
      [a.raiz, 'curto'],
      [b.raiz, 'bem mais longo que o outro'],
    ] as const) {
      mkdirSync(join(raiz, 'x'), { recursive: true });
      writeFileSync(join(raiz, 'x', 'message_1.json'), texto);
    }
    assert.notEqual(
      impressaoDeEntradas(entradasDaArvore(a.raiz, SO_MENSAGENS)),
      impressaoDeEntradas(entradasDaArvore(b.raiz, SO_MENSAGENS)),
      'árvore idêntica com tamanhos distintos NÃO pode colidir — medido em 4 pares reais',
    );
  } finally {
    a.limpar();
    b.limpar();
  }
});

test('a derivação não abre o conteúdo do arquivo de mensagem', () => {
  const a = instalacaoTemporaria();
  try {
    mkdirSync(join(a.raiz, 'x'), { recursive: true });
    const arquivo = join(a.raiz, 'x', 'message_1.json');
    writeFileSync(arquivo, 'conteudo');
    chmodSync(arquivo, 0o000);
    try {
      const impressao = impressaoDeEntradas(entradasDaArvore(a.raiz, SO_MENSAGENS));
      assert.equal(impressao.length, 64, 'concluiu mesmo sem poder ler o conteúdo');
    } finally {
      chmodSync(arquivo, 0o644);
    }
  } finally {
    a.limpar();
  }
});
