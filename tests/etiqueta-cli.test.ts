import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerPedidoDeEtiquetas, formatarEtiquetas } from '../src/cli/etiquetas.js';
import { join } from 'node:path';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarEtiqueta, registrarIdentificador, registrarTransicao } from '../src/nucleo/escrita.js';
import { umaColetiva } from './ajuda/etiqueta.js';

test('os filtros entram no pedido, e --historico e --json sao bandeiras', () => {
  const r = lerPedidoDeEtiquetas(['etiquetas', '--conversa', 'c1', '--remetente', '5565911110001@s.whatsapp.net', '--historico', '--limite', '20']);
  assert.deepEqual(r, {
    ok: true,
    pedido: { conversa: 'c1', remetente: '5565911110001@s.whatsapp.net', historico: true, limite: 20 },
  });
});

test('flag sem valor e erro de uso, nunca ignorada em silencio (#1136)', () => {
  for (const args of [
    ['etiquetas', '--busca'],
    ['etiquetas', '--busca', '--json'],
    ['etiquetas', '--conversa'],
    ['etiquetas', '--remetente', '--historico'],
    ['etiquetas', '--limite'],
  ]) {
    const r = lerPedidoDeEtiquetas(args);
    assert.equal(r.ok, false, args.join(' '));
    if (!r.ok) assert.match(r.erro, /pede um valor/);
  }
});

test('historico exige conversa e remetente', () => {
  for (const args of [['etiquetas', '--historico'], ['etiquetas', '--historico', '--conversa', 'c1'], ['etiquetas', '--historico', '--remetente', 'x']]) {
    const r = lerPedidoDeEtiquetas(args);
    assert.equal(r.ok, false, args.join(' '));
    if (!r.ok) assert.match(r.erro, /--historico exige/);
  }
});

test('limite invalido e busca vazia sao erro de uso', () => {
  for (const args of [['etiquetas', '--limite', '0'], ['etiquetas', '--limite', 'abc'], ['etiquetas', '--limite', '1001'], ['etiquetas', '--busca', '']]) {
    assert.equal(lerPedidoDeEtiquetas(args).ok, false, args.join(' '));
  }
});

test('a saida em texto: uma linha por etiqueta, a removida marcada, e o historico do mais novo ao mais antigo', () => {
  const linhas = formatarEtiquetas([
    { conversaId: 'c1', identificadorId: 'i1', valor: '5565911110001@s.whatsapp.net', nome: 'Pessoa Exemplo', origemDoNome: 'whatsapp', texto: 'Torre A', em: Date.parse('2026-10-05T15:00:00Z') },
    { conversaId: 'c1', identificadorId: 'i1', valor: '5565911110001@s.whatsapp.net', nome: null, origemDoNome: null, texto: null, em: Date.parse('2026-10-05T14:00:00Z') },
  ]);
  assert.equal(linhas.length, 2);
  assert.match(linhas[0]!, /2026-10-05T15:00:00.000Z/);
  assert.match(linhas[0]!, /Pessoa Exemplo/);
  assert.match(linhas[0]!, /Torre A/);
  assert.match(linhas[1]!, /\(removida\)/);
});


function instalarComEtiquetas(): { raiz: string; id: string; conversa: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Padme' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), id);
  const conversa = umaColetiva(acervo);
  try {
    const m = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' }).id;
    registrarEtiqueta(acervo, {
      conversaId: conversa, identificadorId: m, texto: 'Torre A',
      ocorridaEm: Date.parse('2026-10-05T15:00:00Z'), fonte: 'whatsapp', idExterno: 'EV1',
    });
  } finally {
    acervo.fechar();
  }
  return { raiz, id, conversa, limpar };
}

test('etiquetas local: lista, filtra e imprime em texto e em --json', () => {
  const { raiz, id, conversa, limpar } = instalarComEtiquetas();
  try {
    const texto = rodar(raiz, ['etiquetas', '--inquilino', id]);
    assert.equal(texto.codigo, 0);
    assert.match(texto.saida, /Torre A/);
    assert.match(texto.saida, /5565911110001@s\.whatsapp\.net/);

    const json = rodar(raiz, ['etiquetas', '--inquilino', id, '--conversa', conversa, '--busca', 'torre', '--json']);
    assert.equal(json.codigo, 0);
    const corpo = JSON.parse(json.saida) as { etiquetas: Array<{ texto: string }> };
    assert.equal(corpo.etiquetas[0]?.texto, 'Torre A');

    const vazio = rodar(raiz, ['etiquetas', '--inquilino', id, '--busca', 'nada disso']);
    assert.equal(vazio.codigo, 0, 'busca sem achado e resposta legitima, nao erro');
  } finally {
    limpar();
  }
});

test('etiquetas local: flag sem valor, historico incompleto e Conversa desconhecida saem 2', () => {
  const { raiz, id, limpar } = instalarComEtiquetas();
  try {
    assert.equal(rodar(raiz, ['etiquetas', '--inquilino', id, '--busca']).codigo, 2);
    assert.equal(rodar(raiz, ['etiquetas', '--inquilino', id, '--historico']).codigo, 2);
    assert.equal(rodar(raiz, ['etiquetas', '--inquilino', id, '--conversa', 'nao-existe']).codigo, 2);
  } finally {
    limpar();
  }
});

test('etiquetas --historico devolve os eventos do membro, o mais novo primeiro', () => {
  const { raiz, id, conversa, limpar } = instalarComEtiquetas();
  try {
    const r = rodar(raiz, [
      'etiquetas', '--inquilino', id, '--conversa', conversa,
      '--remetente', '5565911110001@s.whatsapp.net', '--historico', '--json',
    ]);
    assert.equal(r.codigo, 0);
    assert.equal((JSON.parse(r.saida) as { etiquetas: unknown[] }).etiquetas.length, 1);
  } finally {
    limpar();
  }
});

test('a --ajuda anuncia etiquetas, com a regra do limite', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const ajuda = rodar(raiz, ['--ajuda']).saida;
    assert.match(ajuda, /malote etiquetas /);
    assert.match(ajuda, /--limite/);
  } finally {
    limpar();
  }
});

test('participantes local traz a etiqueta de cada membro listado', () => {
  const { raiz, id, conversa, limpar } = instalarComEtiquetas();
  try {
    // O membro precisa constar na presenca: uma Transicao de entrada o poe no universo.
    const acervo = abrirAcervo(join(raiz, 'acervos'), id);
    try {
      const m = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' }).id;
      registrarTransicao(acervo, {
        conversaId: conversa, identificadorId: m, natureza: 'entrou',
        ocorridaEm: Date.parse('2026-10-05T14:00:00Z'), fonte: 'whatsapp', idExterno: 'ADD1', codigoDaFonte: 'GROUP_PARTICIPANT_ADD',
      });
    } finally {
      acervo.fechar();
    }
    const r = rodar(raiz, ['participantes', '--inquilino', id, '--conversa', conversa]);
    assert.equal(r.codigo, 0);
    const corpo = JSON.parse(r.saida) as Record<string, Array<{ etiqueta: string | null }>>;
    const todos = [...(corpo.presentes ?? []), ...(corpo.semInformacao ?? [])];
    assert.ok(todos.some((p) => p.etiqueta === 'Torre A'), r.saida);
  } finally {
    limpar();
  }
});
