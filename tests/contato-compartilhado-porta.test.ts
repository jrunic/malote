import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import {
  ContatoSemNomeError,
  lerContatosCompartilhados,
  registrarContatosCompartilhados,
  type CartaoCompartilhado,
} from '../src/nucleo/contato-compartilhado.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-10-13T12:00:00Z');

function mensagem(acervo: Acervo, idExterno: string): string {
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '5565900000001@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
  return registrarMensagem(acervo, {
    conversaId,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z'),
    agora: AGORA,
    direcao: 'recebida',
  });
}

const ana: CartaoCompartilhado = {
  nome: 'Ana Souza',
  organizacao: 'Eletrica Souza',
  nomeComercial: null,
  valores: [
    { tipo: 'telefone', texto: '+55 65 99999-1234', digitos: '5565999991234', rotulo: 'celular' },
    { tipo: 'email', texto: 'ana@exemplo.com', digitos: null, rotulo: null },
  ],
};
const beto: CartaoCompartilhado = { nome: 'Beto', organizacao: null, nomeComercial: 'Beto Pecas', valores: [] };

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Leia Organa').acervo);
  } finally {
    c.limpar();
  }
}

test('registrar guarda os cartoes da Mensagem, na ordem, com os valores', () => {
  comAcervo((acervo) => {
    const m = mensagem(acervo, 'm1');
    const r = registrarContatosCompartilhados(acervo, m, [ana, beto]);
    assert.equal(r.mudou, true);
    assert.equal(r.criados.length, 2);

    const lidos = lerContatosCompartilhados(acervo, [m]).get(m) ?? [];
    assert.deepEqual(
      lidos.map((c) => [c.posicao, c.nome, c.organizacao, c.nomeComercial]),
      [
        [0, 'Ana Souza', 'Eletrica Souza', null],
        [1, 'Beto', null, 'Beto Pecas'],
      ],
    );
    assert.deepEqual(lidos[0]?.valores, ana.valores);
    assert.deepEqual(lidos[1]?.valores, []);
  });
});

test('registrar o mesmo conjunto de novo e idempotente: nada muda, nada nasce', () => {
  comAcervo((acervo) => {
    const m = mensagem(acervo, 'm1');
    registrarContatosCompartilhados(acervo, m, [ana, beto]);
    const antes = acervo.db.prepare('SELECT id FROM contatos_compartilhados ORDER BY posicao').all();

    const r = registrarContatosCompartilhados(acervo, m, [ana, beto]);

    assert.equal(r.mudou, false);
    assert.deepEqual(r.criados, []);
    assert.deepEqual(acervo.db.prepare('SELECT id FROM contatos_compartilhados ORDER BY posicao').all(), antes);
  });
});

test('conjunto diferente SUBSTITUI o da Mensagem inteira (e nao acumula)', () => {
  comAcervo((acervo) => {
    const m = mensagem(acervo, 'm1');
    registrarContatosCompartilhados(acervo, m, [ana, beto]);

    const r = registrarContatosCompartilhados(acervo, m, [beto]);

    assert.equal(r.mudou, true);
    const lidos = lerContatosCompartilhados(acervo, [m]).get(m) ?? [];
    assert.deepEqual(lidos.map((c) => c.nome), ['Beto']);
    const valores = acervo.db.prepare('SELECT COUNT(*) AS n FROM valores_de_contato_compartilhado').get() as { n: number };
    assert.equal(valores.n, 0, 'os valores do cartao removido tem de sair junto');
  });
});

test('lista vazia nao apaga o que ja ha (vazio nao apaga)', () => {
  comAcervo((acervo) => {
    const m = mensagem(acervo, 'm1');
    registrarContatosCompartilhados(acervo, m, [ana]);
    const r = registrarContatosCompartilhados(acervo, m, []);
    assert.equal(r.mudou, false);
    assert.equal((lerContatosCompartilhados(acervo, [m]).get(m) ?? []).length, 1);
  });
});

test('cartao sem nome e recusado pela porta', () => {
  comAcervo((acervo) => {
    const m = mensagem(acervo, 'm1');
    assert.throws(
      () => registrarContatosCompartilhados(acervo, m, [{ ...ana, nome: '   ' }]),
      ContatoSemNomeError,
    );
    assert.equal((lerContatosCompartilhados(acervo, [m]).get(m) ?? []).length, 0);
  });
});

test('ler varias Mensagens de uma vez devolve cada uma com os seus cartoes', () => {
  comAcervo((acervo) => {
    const m1 = mensagem(acervo, 'm1');
    const m2 = mensagem(acervo, 'm2');
    const m3 = mensagem(acervo, 'm3');
    registrarContatosCompartilhados(acervo, m1, [ana]);
    registrarContatosCompartilhados(acervo, m2, [beto, ana]);

    const mapa = lerContatosCompartilhados(acervo, [m1, m2, m3]);

    assert.deepEqual((mapa.get(m1) ?? []).map((c) => c.nome), ['Ana Souza']);
    assert.deepEqual((mapa.get(m2) ?? []).map((c) => c.nome), ['Beto', 'Ana Souza']);
    assert.equal(mapa.get(m3), undefined, 'Mensagem sem cartao nao entra no mapa');
    assert.equal(lerContatosCompartilhados(acervo, []).size, 0);
  });
});

test('a busca de texto acompanha as linhas: insere, substitui e remove', () => {
  comAcervo((acervo) => {
    const m = mensagem(acervo, 'm1');
    const acha = (palavra: string): number =>
      (
        acervo.db
          .prepare('SELECT COUNT(*) AS n FROM contatos_compartilhados_texto WHERE contatos_compartilhados_texto MATCH ?')
          .get(`"${palavra}"`) as { n: number }
      ).n;

    registrarContatosCompartilhados(acervo, m, [ana]);
    assert.equal(acha('Souza'), 1);
    assert.equal(acha('Eletrica'), 1);

    registrarContatosCompartilhados(acervo, m, [beto]);
    assert.equal(acha('Souza'), 0, 'o texto do cartao substituido tem de sair da busca');
    assert.equal(acha('Pecas'), 1);
  });
});

test('apagar a Mensagem leva os cartoes e os valores junto', () => {
  comAcervo((acervo) => {
    const m = mensagem(acervo, 'm1');
    registrarContatosCompartilhados(acervo, m, [ana]);
    acervo.db.prepare('DELETE FROM mensagens WHERE id = ?').run(m);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM contatos_compartilhados').get() as { n: number }).n, 0);
    assert.equal(
      (acervo.db.prepare('SELECT COUNT(*) AS n FROM valores_de_contato_compartilhado').get() as { n: number }).n,
      0,
    );
  });
});

test('atualizar o nome do cartao por SQL tambem atualiza a busca (gatilho de atualizacao)', () => {
  comAcervo((acervo) => {
    const m = mensagem(acervo, 'm1');
    registrarContatosCompartilhados(acervo, m, [ana]);
    acervo.db.prepare("UPDATE contatos_compartilhados SET nome = 'Carla Mendes' WHERE mensagem_id = ?").run(m);
    const acha = (palavra: string): number =>
      (
        acervo.db
          .prepare('SELECT COUNT(*) AS n FROM contatos_compartilhados_texto WHERE contatos_compartilhados_texto MATCH ?')
          .get(`"${palavra}"`) as { n: number }
      ).n;
    assert.equal(acha('Mendes'), 1);
    assert.equal(acha('Ana'), 0, 'o nome velho tem de sair da busca (Souza segue: esta tambem na organizacao)');
  });
});
