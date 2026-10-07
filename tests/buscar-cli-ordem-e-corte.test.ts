import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { executar } from '../src/cli/index.js';
import { avisoDeCorte } from '../src/cli/aviso-de-corte.js';

const CFG = { id: 'cfg-1', fonte: 'whatsapp' as const };

function inquilinoComMensagens(n: number) {
  const c = cenario();
  const { id, acervo } = c.novoInquilino('Ahsoka');
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp', idExterno: 'a@s.whatsapp.net', coletiva: false, configuracao: CFG,
  });
  for (let i = 1; i <= n; i += 1) {
    const quando = Date.parse(`2026-03-${String(i).padStart(2, '0')}T12:00:00Z`);
    registrarMensagem(acervo, {
      direcao: 'recebida', conversaId: conversa, fonte: 'whatsapp', idExterno: `m${i}`,
      ocorridaEm: quando, agora: quando + 1000, conteudo: `relatorio ${i}`,
    });
  }
  acervo.fechar();
  return { c, id };
}

function rodar(raiz: string, argumentos: string[]): { codigo: number; saida: string[]; erro: string[] } {
  const saida: string[] = [];
  const erro: string[] = [];
  const codigo = executar(argumentos, { dados: raiz, estado: raiz, escrever: (t) => saida.push(t), erro: (t) => erro.push(t) });
  return { codigo, saida, erro };
}

test('avisoDeCorte diz quantas, em que ordem, e quais flags mudam isso', () => {
  assert.equal(
    avisoDeCorte(100, 'recentes'),
    'Mostrando as 100 mais recentes; ha mais resultados. Use --desde, --ate ou --limite para ajustar, ou --ordem cronologica.',
  );
  assert.equal(
    avisoDeCorte(2, 'cronologica'),
    'Mostrando as 2 mais antigas; ha mais resultados. Use --desde, --ate ou --limite para ajustar, ou --ordem recentes.',
  );
});

test('buscar local: o padrao e mais recente primeiro, e o texto avisa quando cortou', () => {
  const { c, id } = inquilinoComMensagens(5);
  try {
    const r = rodar(c.raiz, ['buscar', '--inquilino', id, '--texto', 'relatorio', '--limite', '2']);
    assert.equal(r.codigo, 0);
    assert.match(r.saida[0] ?? '', /relatorio 5/);
    assert.match(r.saida[1] ?? '', /relatorio 4/);
    assert.equal(r.saida[2], avisoDeCorte(2, 'recentes'));
    assert.deepEqual(r.erro, []);
  } finally {
    c.limpar();
  }
});

test('buscar local --json: a lista continua pura, e o aviso vai para a saida de ERRO', () => {
  const { c, id } = inquilinoComMensagens(5);
  try {
    const r = rodar(c.raiz, ['buscar', '--inquilino', id, '--texto', 'relatorio', '--limite', '2', '--json']);
    assert.equal(r.codigo, 0);
    assert.equal(r.saida.length, 1, 'so o JSON na saida de dados');
    const lista = JSON.parse(r.saida[0] as string) as Array<{ conteudo: string }>;
    assert.deepEqual(lista.map((m) => m.conteudo), ['relatorio 5', 'relatorio 4']);
    assert.deepEqual(r.erro, [avisoDeCorte(2, 'recentes')]);
  } finally {
    c.limpar();
  }
});

test('buscar local sem corte nao avisa; --ordem cronologica inverte', () => {
  const { c, id } = inquilinoComMensagens(3);
  try {
    const livre = rodar(c.raiz, ['buscar', '--inquilino', id, '--texto', 'relatorio']);
    assert.equal(livre.saida.length, 3, 'tres mensagens e nenhuma linha de aviso');
    assert.deepEqual(livre.erro, []);
    const antigas = rodar(c.raiz, ['buscar', '--inquilino', id, '--texto', 'relatorio', '--ordem', 'cronologica', '--limite', '2']);
    assert.match(antigas.saida[0] ?? '', /relatorio 1/);
    assert.equal(antigas.saida[2], avisoDeCorte(2, 'cronologica'));
  } finally {
    c.limpar();
  }
});

test('--ordem fora do conjunto e erro de uso (codigo 2) no buscar e no mensagens', () => {
  const { c, id } = inquilinoComMensagens(1);
  try {
    for (const comando of [['buscar', '--texto', 'relatorio'], ['mensagens']]) {
      const r = rodar(c.raiz, [...comando, '--inquilino', id, '--ordem', 'banana']);
      assert.equal(r.codigo, 2, comando[0] ?? '');
      assert.deepEqual(r.saida, ['A flag --ordem aceita recentes ou cronologica.'], comando[0] ?? '');
    }
  } finally {
    c.limpar();
  }
});
