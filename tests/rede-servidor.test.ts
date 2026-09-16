import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioDeRede } from './ajuda/rede.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';

test('o Titular lista as Chaves do proprio Inquilino, sem valor nenhum', async () => {
  // A metade que a CLI nao entrega: la so existe Chave de Operador. E o que
  // torna a auditoria de emissao util a quem NAO e o Operador — o Titular ve
  // Chave emitida para o Inquilino dele ainda que nao tenha sido ele a pedir.
  const c = await cenarioDeRede();
  try {
    const minha = c.emitir(c.inquilinoA);
    const alheia = c.emitir(c.inquilinoB);
    const r = await c.pedir('/chaves', minha.valor);
    assert.equal(r.status, 200);
    const corpo = JSON.parse(r.corpo) as { chaves: { id: string; revogadaEm: string | null }[] };
    assert.ok(corpo.chaves.some((x) => x.id === minha.id));
    assert.ok(!corpo.chaves.some((x) => x.id === alheia.id), 'nem sinal da do outro Inquilino');
    assert.ok(!r.corpo.includes(minha.valor), 'o valor NUNCA aparece');
  } finally {
    await c.parar();
  }
});

test('rota desconhecida COM chave valida responde 404 vazio — nao 401', async () => {
  // DOIS codigos, DOIS sinais, e a separacao nao e estetica.
  //
  // Se rota desconhecida respondesse igual a recusa de credencial, o corpo da
  // recusa teria dois produtores — e a mutacao que o altera derrubaria dois
  // testes, quebrando o sinal proprio que o gate do ciclo exige.
  //
  // E distinguir aqui nao vaza nada: quem apresentou Chave valida JA provou que
  // pode saber que este servidor existe. O que continua nao vazando e o CORPO —
  // vazio nos dois casos, porque 404 detalhado e mapa para quem varre.
  const c = await cenarioDeRede();
  try {
    const chave = c.emitir(c.inquilinoA);
    const semRota = await c.pedir('/nao-existe', chave.valor);
    const semChave = await c.pedir('/nao-existe');
    assert.equal(semRota.status, 404);
    assert.equal(semRota.corpo, '');
    assert.equal(semChave.status, 401, 'sem credencial, a recusa vem ANTES do roteamento');
  } finally {
    await c.parar();
  }
});

test('as mensagens de uma Conversa vem, e so as do Inquilino da Chave', async () => {
  const c = await cenarioDeRede();
  try {
    const chaveA = c.emitir(c.inquilinoA);
    const minha = await c.pedir(`/conversas/${c.conversaDeA}/mensagens`, chaveA.valor);
    assert.equal(minha.status, 200);
    // A Conversa do OUTRO Inquilino nao existe neste Acervo — e a resposta e a
    // mesma de uma Conversa inexistente, porque distinguir vazaria que ela
    // existe em algum lugar.
    const alheia = await c.pedir(`/conversas/${c.conversaDeB}/mensagens`, chaveA.valor);
    const inventada = await c.pedir('/conversas/nao-existe/mensagens', chaveA.valor);
    assert.equal(alheia.status, inventada.status);
    assert.equal(alheia.corpo, inventada.corpo);
  } finally {
    await c.parar();
  }
});

test('a busca responde, e o texto e obrigatorio', async () => {
  const c = await cenarioDeRede();
  try {
    const chave = c.emitir(c.inquilinoA);
    const semTexto = await c.pedir('/buscar', chave.valor);
    assert.equal(semTexto.status, 400, 'busca sem termo e invocacao errada, nao recusa');
    const comTexto = await c.pedir('/buscar?texto=qualquer', chave.valor);
    assert.equal(comTexto.status, 200);
  } finally {
    await c.parar();
  }
});

test('o default e loopback', async () => {
  const c = await cenarioDeRede();
  try {
    assert.match(c.endereco, /^127\.0\.0\.1$|^::1$/);
  } finally {
    await c.parar();
  }
});

test('endereco alcancavel exige ato explicito, e a recusa diz o que fazer', () => {
  // A Chave viaja no cabecalho. Escutar fora de loopback sem terminador de TLS
  // na frente poe credencial em claro na rede. O produto NAO termina TLS — e
  // decisao, com razao registrada na spec —, entao a unica protecao que ele
  // pode dar e nao deixar o erro acontecer por descuido.
  //
  // Recusar em SILENCIO seria pior que aceitar: a recusa diz o que fazer.
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const codigo = executar(['servir', '--porta', '8080', '--endereco', '0.0.0.0'], {
      dados: raiz, estado: raiz,
      escrever: (t) => linhas.push(t),
    });
    const texto = linhas.join('\n');
    assert.equal(codigo, 2);
    assert.match(texto, /--exposto/, 'a recusa nomeia a bandeira');
    assert.match(texto, /TLS|terminador/i, 'e diz por que');
  } finally {
    limpar();
  }
});
