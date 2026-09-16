import { test } from 'node:test';
import assert from 'node:assert/strict';
import { propor } from '../src/adaptadores/contatos/propostas.js';
import type { IdentificadorNoInventario } from '../src/nucleo/inventario.js';

function ident(
  id: string,
  fonte: IdentificadorNoInventario['fonte'],
  valor: string,
  nomes: string[] = [],
  pessoaId: string | null = null,
  cartao: string | null = null,
  configuracaoId = 'cfg-teste-contatos',
): IdentificadorNoInventario {
  // O parametro continua sendo UM cartao por comodidade dos casos existentes;
  // quem precisa de dois usa `identComCartoes`, abaixo.
  return {
    id, fonte, valor, nomes, pessoaId,
    cartoes: cartao === null ? [] : [{ cartao, configuracaoId }],
  };
}

/** Um endereco em mais de um cartao — o caso que duas bases produzem. */
function identComCartoes(
  id: string,
  valor: string,
  cartoes: Array<{ cartao: string; configuracaoId: string }>,
  nomes: string[] = [],
): IdentificadorNoInventario {
  return { id, fonte: 'contatos', valor, nomes, pessoaId: null, cartoes };
}

test('produtor por telefone: casa catálogo com WhatsApp pelo nono dígito', () => {
  const p = propor([
    ident('k1', 'contatos', '551181234567'),
    ident('w1', 'whatsapp', '5511981234567'),
  ]);
  assert.equal(p.length, 1);
  assert.equal(p[0]?.produtor, 'telefone');
  assert.deepEqual([...(p[0]?.identificadores ?? [])].sort(), ['k1', 'w1']);
});

test('produtor por nome: exige unicidade em CADA Fonte', () => {
  const unico = propor([
    ident('k1', 'contatos', '111', ['Joana Prado']),
    ident('w1', 'whatsapp', '999', ['joana  prado']),
  ]);
  assert.equal(unico.length, 1);
  assert.equal(unico[0]?.produtor, 'nome');

  const doisNoCatalogo = propor([
    ident('k1', 'contatos', '111', ['Joana Prado']),
    ident('k2', 'contatos', '222', ['Joana Prado']),
    ident('w1', 'whatsapp', '999', ['Joana Prado']),
  ]);
  assert.deepEqual(
    doisNoCatalogo.filter((x) => x.produtor === 'nome'),
    [],
  );

  const doisNaMesmaFonte = propor([
    ident('k1', 'contatos', '111', ['Joana Prado']),
    ident('w1', 'whatsapp', '999', ['Joana Prado']),
    ident('w2', 'whatsapp', '888', ['Joana Prado']),
  ]);
  assert.deepEqual(
    doisNaMesmaFonte.filter((x) => x.produtor === 'nome'),
    [],
  );
});

test('nome único em cada Fonte gera UMA Proposta com as três — a ponte da história 6', () => {
  // Medido: somar as Fontes em vez de medir cada uma descartaria 91 nomes,
  // que sao justamente as pontes entre Instagram e WhatsApp.
  const p = propor([
    ident('k1', 'contatos', '111', ['Ana Luisa']),
    ident('w1', 'whatsapp', '999', ['Ana Luisa']),
    ident('g1', 'instagram', 'perfil-ana', ['Ana Luisa']),
  ]);
  const porNome = p.filter((x) => x.produtor === 'nome');
  assert.equal(porNome.length, 1);
  assert.deepEqual([...(porNome[0]?.identificadores ?? [])].sort(), ['g1', 'k1', 'w1']);
});

test('a unicidade se mede na forma NORMALIZADA, não na escrita', () => {
  // Sem normalizar, 'Joana Prado' e 'joana  prado' seriam dois nomes e os
  // dois cartoes escapariam da guarda. Medido: sete cartoes reais fazem isso.
  const p = propor([
    ident('k1', 'contatos', '111', ['Joana Prado']),
    ident('k2', 'contatos', '222', ['joana  prado']),
    ident('w1', 'whatsapp', '999', ['Joana Prado']),
  ]);
  assert.deepEqual(
    p.filter((x) => x.produtor === 'nome'),
    [],
  );
});

test('produtor por múltiplos endereços agrupa pelo LAÇO DE CARTÃO', () => {
  const p = propor([
    ident('k1', 'contatos', '5511900000001', ['Bruno Salles'], null, 'cartao-A'),
    ident('k2', 'contatos', '5511900000002', ['Bruno Salles'], null, 'cartao-A'),
    ident('k3', 'contatos', '5511900000003', ['Bruno Salles'], null, 'cartao-A'),
  ]);
  const m = p.filter((x) => x.produtor === 'multiplos-enderecos');
  assert.equal(m.length, 1);
  assert.deepEqual([...(m[0]?.identificadores ?? [])].sort(), ['k1', 'k2', 'k3']);
});

test('homônimos em cartões diferentes NÃO viram uma Proposta', () => {
  // A guarda que motivou o schema v7. Medido no catalogo real: 24 nomes em
  // 51 cartoes, 57 telefones que o laco por nome uniria indevidamente.
  const p = propor([
    ident('k1', 'contatos', '5511900000001', ['Carlos'], null, 'cartao-A'),
    ident('k2', 'contatos', '5511900000002', ['Carlos'], null, 'cartao-B'),
  ]);
  assert.deepEqual(
    p.filter((x) => x.produtor === 'multiplos-enderecos'),
    [],
  );
});

test('endereço sem laço de cartão não produz proposta de múltiplos endereços', () => {
  const p = propor([
    ident('k1', 'contatos', '5511900000001', ['Bruno']),
    ident('k2', 'contatos', '5511900000002', ['Bruno']),
  ]);
  assert.deepEqual(p, []);
});

test('identificador de Instagram não entra no índice de telefone', () => {
  // `soDigitos('conversa:42')` da '42'. Perfil nao e endereco telefonico.
  const p = propor([ident('k1', 'contatos', '42'), ident('g1', 'instagram', 'conversa:42')]);
  assert.deepEqual(
    p.filter((x) => x.produtor === 'telefone'),
    [],
  );
});

test('telefone e nome no mesmo par produzem UMA Proposta, declarando telefone', () => {
  const p = propor([
    ident('k1', 'contatos', '5511912345678', ['Joana Prado']),
    ident('w1', 'whatsapp', '5511912345678', ['Joana Prado']),
  ]);
  assert.equal(p.length, 1);
  assert.equal(p[0]?.produtor, 'telefone');
});

test('par já resolvido não é oferecido', () => {
  const p = propor([
    ident('k1', 'contatos', '5511912345678', [], 'pessoa-1'),
    ident('w1', 'whatsapp', '5511912345678', [], 'pessoa-1'),
  ]);
  assert.deepEqual(p, []);
});

test('par de Pessoas DIFERENTES continua sendo oferecido — é o caso de mesclagem', () => {
  const p = propor([
    ident('k1', 'contatos', '5511912345678', [], 'pessoa-1'),
    ident('w1', 'whatsapp', '5511912345678', [], 'pessoa-2'),
  ]);
  assert.equal(p.length, 1);
  assert.equal(p[0]?.produtor, 'telefone');
});

test('cada Proposta declara evidência concreta', () => {
  const p = propor([
    ident('k1', 'contatos', '5511912345678'),
    ident('w1', 'whatsapp', '5511912345678'),
  ]);
  assert.match(p[0]?.evidencia ?? '', /5511912345678/);
});

const CFG_A = 'cfg-base-a';
const CFG_B = 'cfg-base-b';

test('e-mail único em cada base LIGA as duas, e a evidência nomeia as duas', () => {
  // Base A: {telefone T, e-mail E}.  Base B: {e-mail E, telefone U}.
  // O que falta ligar é T a U, através de E — e E é UMA linha em
  // `identificadores`, não duas: a chave é (fonte, valor). O que distingue as
  // bases é o par de cartões, e é por isso que o inventário devolve todos.
  const p = propor([
    ident('t', 'contatos', '5565900000001', [], null, 'cartao-A', CFG_A),
    identComCartoes('e', 'leia@exemplo.test', [
      { cartao: 'cartao-A', configuracaoId: CFG_A },
      { cartao: 'cartao-B', configuracaoId: CFG_B },
    ]),
    ident('u', 'contatos', '5565900000002', [], null, 'cartao-B', CFG_B),
  ]);

  const porEmail = p.filter((x) => x.produtor === 'email');
  assert.equal(porEmail.length, 1, `esperava uma Proposta de e-mail; vi ${JSON.stringify(p)}`);
  assert.deepEqual([...(porEmail[0]?.identificadores ?? [])].sort(), ['e', 't', 'u']);
  // A evidência precisa nomear as DUAS bases: quem julga a Proposta sem isso a
  // aprova no escuro, e este produto é operado prioritariamente por agentes.
  assert.match(porEmail[0]?.evidencia ?? '', /leia@exemplo\.test/);
  assert.deepEqual([...(porEmail[0]?.configuracoes ?? [])].sort(), [CFG_A, CFG_B]);
});

test('e-mail em DOIS cartões da MESMA base não sustenta Proposta', () => {
  // Medido no catálogo real: 20 e-mails em mais de um cartão, tocando 37
  // cartões, com pares de pessoas distintas — "Assessoria - HGU" e "Divina
  // Bernardino" dividem hgu.sup@terra.com.br.
  //
  // MEDIDO: este caso e guardado por DOIS mecanismos independentes, e o mutante
  // mostrou qual. Quem o segura AQUI e a exigencia de duas bases
  // (`bases.size < 2`), e nao a exclusao do compartilhado — remover a exclusao
  // do produtor de e-mail nao derruba este teste. Quem guarda a exclusao sao os
  // dois casos seguintes; este e regressao de "mesma base nao faz ponte".
  const p = propor([
    ident('t', 'contatos', '5565900000001', [], null, 'cartao-1', CFG_A),
    identComCartoes('e', 'compartilhado@exemplo.test', [
      { cartao: 'cartao-1', configuracaoId: CFG_A },
      { cartao: 'cartao-2', configuracaoId: CFG_A },
    ]),
    ident('u', 'contatos', '5565900000002', [], null, 'cartao-2', CFG_A),
  ]);
  assert.deepEqual(p.filter((x) => x.produtor === 'email'), []);
});

test('e-mail compartilhado sai TAMBÉM do laço de múltiplos endereços', () => {
  // A metade que falta. Excluir só do produtor de e-mail deixaria [t,e] e
  // [e,u] serem oferecidas pelo laço de cartão — e aplicar as duas funde
  // pessoas distintas POR TRANSITIVIDADE, sem que nenhuma pareça errada
  // sozinha.
  const p = propor([
    ident('t', 'contatos', '5565900000001', [], null, 'cartao-1', CFG_A),
    identComCartoes('e', 'compartilhado@exemplo.test', [
      { cartao: 'cartao-1', configuracaoId: CFG_A },
      { cartao: 'cartao-2', configuracaoId: CFG_A },
    ]),
    ident('u', 'contatos', '5565900000002', [], null, 'cartao-2', CFG_A),
  ]);
  for (const proposta of p) {
    assert.ok(
      !proposta.identificadores.includes('e'),
      `o e-mail compartilhado entrou numa Proposta de ${proposta.produtor}: ${proposta.evidencia}`,
    );
  }
});

test('1 cartão na base A e 2 na base B exclui INTEIRO', () => {
  // Borda declarada, conservadora: a base B já provou que o endereço não
  // identifica pessoa, e a ponte que ele ofereceria para A não vale mais.
  const p = propor([
    ident('t', 'contatos', '5565900000001', [], null, 'cartao-A', CFG_A),
    identComCartoes('e', 'meio@exemplo.test', [
      { cartao: 'cartao-A', configuracaoId: CFG_A },
      { cartao: 'cartao-B1', configuracaoId: CFG_B },
      { cartao: 'cartao-B2', configuracaoId: CFG_B },
    ]),
  ]);
  assert.deepEqual(p.filter((x) => x.produtor === 'email'), []);
  for (const proposta of p) {
    assert.ok(!proposta.identificadores.includes('e'), 'nem pelo laço de cartão');
  }
});

test('o produtor de telefone NÃO tenta casar e-mail', () => {
  // `variantesDeEndereco` extrai dígitos de qualquer cadeia. Um e-mail com ano
  // no nome casaria com uma variante brasileira e produziria Proposta plausível
  // e ERRADA — o pior tipo, porque quem julga não tem como desconfiar.
  const p = propor([
    ident('e', 'contatos', 'joao5565900000001@exemplo.test', [], null, 'cartao-A', CFG_A),
    ident('w', 'whatsapp', '5565900000001'),
  ]);
  assert.deepEqual(p.filter((x) => x.produtor === 'telefone'), []);
});

test('Proposta de fora do catálogo vem com a lista de Configurações VAZIA', () => {
  const p = propor([
    ident('k', 'contatos', '5565900000001', ['Leia Organa'], null, 'cartao-A', CFG_A),
    ident('w', 'whatsapp', '999', ['Leia Organa']),
  ]);
  const porNome = p.find((x) => x.produtor === 'nome');
  assert.deepEqual(porNome?.configuracoes, [CFG_A], 'a do catálogo entra');
});
