import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { CFG_CONTATOS } from './ajuda/configuracao.js';
import { importarCatalogo } from '../src/adaptadores/contatos/importar.js';

const AGORA = Date.parse('2026-09-12T12:00:00Z');
let sequencia = 0;

function vcard(raiz: string, cartoes: string[]): string {
  const caminho = join(raiz, `catalogo-email-${(sequencia += 1)}.vcf`);
  writeFileSync(caminho, cartoes.join('\r\n'));
  return caminho;
}

const cartao = (linhas: string[]): string =>
  ['BEGIN:VCARD', ...linhas, 'END:VCARD'].join('\r\n');

/**
 * Endereços de e-mail SINTÉTICOS, em domínio reservado para teste
 * (RFC 2606). ADR 20260811-dado-de-exemplo-sintetico-em-repo-publico.
 */
const SO_EMAIL = cartao(['FN:Leia Organa', 'EMAIL;TYPE=home:leia@exemplo.test']);
const SO_TELEFONE = cartao(['FN:Han Solo', 'TEL;TYPE=cell:+5565900000002']);
const OS_DOIS = cartao([
  'FN:Chewbacca',
  'TEL;TYPE=cell:+5565900000003',
  'EMAIL;TYPE=work:chewbacca@exemplo.test',
]);
const NADA = cartao(['FN:Contato Sem Nada']);

function enderecos(acervo: { db: { prepare: (s: string) => { all: () => unknown[] } } }): string[] {
  return (
    acervo.db.prepare("SELECT valor FROM identificadores WHERE fonte = 'contatos' ORDER BY valor")
      .all() as Array<{ valor: string }>
  ).map((l) => l.valor);
}

test('cartão que só tem e-mail ENTRA, e deixa de ser descarte', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const r = importarCatalogo(acervo, vcard(c.raiz, [SO_EMAIL]), {
      agora: AGORA,
      configuracaoId: CFG_CONTATOS.id,
    });

    // Medido no catálogo real em 11/09/2026: 1.210 cartões não têm telefone, e
    // 869 DELES têm e-mail. São esses 869 que este caso representa — hoje eles
    // são descartados inteiros, e a base que só tem e-mails não entra.
    assert.equal(r.identificadoresCriados, 1, 'o e-mail virou Identificador');
    assert.deepEqual(enderecos(acervo), ['leia@exemplo.test']);
    assert.equal(r.cartoesSemContatoAlgum, 0, 'ele tem contato: um e-mail');
  } finally {
    c.limpar();
  }
});

test('cartão com telefone E e-mail registra os dois endereços', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const r = importarCatalogo(acervo, vcard(c.raiz, [OS_DOIS]), {
      agora: AGORA,
      configuracaoId: CFG_CONTATOS.id,
    });
    assert.equal(r.identificadoresCriados, 2);
    assert.deepEqual(enderecos(acervo), ['5565900000003', 'chewbacca@exemplo.test']);
  } finally {
    c.limpar();
  }
});

test('o e-mail entra normalizado: espaço fora, caixa baixa, o mais preservado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    importarCatalogo(
      acervo,
      vcard(c.raiz, [
        cartao(['FN:Leia', 'EMAIL:  LEIA@Exemplo.TEST  ']),
        cartao(['FN:Leia de novo', 'EMAIL:leia@exemplo.test']),
        cartao(['FN:Han', 'EMAIL:han+naves@exemplo.test']),
      ]),
      { agora: AGORA, configuracaoId: CFG_CONTATOS.id },
    );
    // Caixa e espaço colapsam — é chave de unicidade, e duas grafias do mesmo
    // endereço seriam duas pessoas. O `+` NÃO colapsa: ele distingue caixa de
    // entrada em alguns provedores e não em outros, e descartá-lo funde quem
    // o usa de propósito. Medido no catálogo real: zero casos de cada, o que
    // não dispensa a política — o valor é chave.
    assert.deepEqual(enderecos(acervo), ['han+naves@exemplo.test', 'leia@exemplo.test']);
  } finally {
    c.limpar();
  }
});

test('a identidade do Cartão passa a derivar de telefones E e-mails', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    importarCatalogo(
      acervo,
      vcard(c.raiz, [
        cartao(['FN:Leia', 'TEL:+5565900000001', 'EMAIL:leia@exemplo.test']),
        cartao(['FN:Outra pessoa', 'TEL:+5565900000001', 'EMAIL:outra@exemplo.test']),
      ]),
      { agora: AGORA, configuracaoId: CFG_CONTATOS.id },
    );
    // Mesmo telefone, e-mails diferentes: DOIS Cartões. É o que 1.839 dos 6.693
    // cartões reais fazem ao entrar o e-mail no conjunto — e é por isso que a
    // regra muda agora, e não depois do primeiro import: mudá-la depois
    // produziria ausência e renascimento em massa.
    const cartoes = (
      acervo.db.prepare('SELECT DISTINCT cartao FROM cartoes_de_catalogo').all() as Array<{
        cartao: string;
      }>
    ).length;
    assert.equal(cartoes, 2, 'e-mail diferente é outro Cartão');
  } finally {
    c.limpar();
  }
});

test('cartão sem telefone e sem e-mail continua sendo descarte', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const r = importarCatalogo(acervo, vcard(c.raiz, [NADA, SO_TELEFONE]), {
      agora: AGORA,
      configuracaoId: CFG_CONTATOS.id,
    });
    // Os 341 que não têm nada. O contador que sobrevive à mudança.
    assert.equal(r.cartoesLidos, 2);
    assert.equal(r.cartoesSemContatoAlgum, 1);
    assert.equal(r.identificadoresCriados, 1, 'só o do telefone');
  } finally {
    c.limpar();
  }
});
