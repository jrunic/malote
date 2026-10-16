import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { lerMetadadosDeColetiva, registrarConversa, registrarMetadadosDeColetiva } from '../src/nucleo/escrita.js';
import type { Acervo } from '../src/nucleo/acervo.js';

// #1160 fatia C, plano 1: a porta de Metadados de Coletiva ganha a REMOCAO explicita da descricao e o
// "so grava se mudou" (o aviso de metadados de grupo, que chega logo depois do evento de grupo e nao traz
// instante, nao pode sobrescrever o instante que o evento ja gravou).

interface Linha {
  assunto: string | null;
  descricao: string | null;
  alterado_por: string | null;
  alterado_em: string | null;
}

const T1 = '2026-10-13T20:11:57.000Z';
const T2 = '2026-10-13T20:12:04.000Z';

function comColetiva(corpo: (acervo: Acervo, conversaId: string) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'grupo-1@g.us', coletiva: true });
    corpo(acervo, conversaId);
  } finally {
    c.limpar();
  }
}

function le(acervo: Acervo, id: string): Linha | undefined {
  return acervo.db
    .prepare('SELECT assunto, descricao, alterado_por, alterado_em FROM metadados_de_coletiva WHERE conversa_id = ?')
    .get(id) as Linha | undefined;
}

test('grava e devolve true; a mesma entrega depois devolve true e deixa a linha igual', () => {
  comColetiva((acervo, id) => {
    assert.equal(registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', alteradoPor: 'a@lid', alteradoEm: T1 }), true);
    const antes = le(acervo, id);
    assert.equal(registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', alteradoPor: 'a@lid', alteradoEm: T1 }), true);
    assert.deepEqual(le(acervo, id), antes);
  });
});

test('removerDescricao anula a descricao, preserva o assunto e grava quem e quando', () => {
  comColetiva((acervo, id) => {
    registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', descricao: 'Descricao um', alteradoPor: 'a@lid', alteradoEm: T1 });
    assert.equal(registrarMetadadosDeColetiva(acervo, id, { removerDescricao: true, alteradoPor: 'b@lid', alteradoEm: T2 }), true);
    assert.deepEqual(le(acervo, id), { assunto: 'Equipe', descricao: null, alterado_por: 'b@lid', alterado_em: T2 });
  });
});

test('vazio nao apaga: descricao vazia ou ausente preserva a gravada', () => {
  comColetiva((acervo, id) => {
    registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', descricao: 'Descricao um', alteradoEm: T1 });
    registrarMetadadosDeColetiva(acervo, id, { descricao: '', alteradoEm: T2 });
    registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe B', alteradoEm: T2 });
    assert.equal(le(acervo, id)?.descricao, 'Descricao um');
  });
});

test('removerDescricao e descricao na mesma entrada e contradicao: recusa', () => {
  comColetiva((acervo, id) => {
    assert.throws(
      () => registrarMetadadosDeColetiva(acervo, id, { removerDescricao: true, descricao: 'x', alteradoEm: T1 }),
      /removerDescricao/,
    );
  });
});

test('remocao mais velha que o instante gravado e ignorada: nao desfaz a descricao nova', () => {
  comColetiva((acervo, id) => {
    registrarMetadadosDeColetiva(acervo, id, { descricao: 'Descricao tres', alteradoEm: T2 });
    assert.equal(registrarMetadadosDeColetiva(acervo, id, { removerDescricao: true, alteradoEm: T1 }), false);
    assert.equal(le(acervo, id)?.descricao, 'Descricao tres');
  });
});

test('remocao em Conversa sem linha de metadados nao cria linha', () => {
  comColetiva((acervo, id) => {
    assert.equal(registrarMetadadosDeColetiva(acervo, id, { removerDescricao: true, alteradoEm: T1 }), false);
    assert.equal(le(acervo, id), undefined);
  });
});

test('soSeMudar: texto igual ao gravado NAO toca alterado_em nem alterado_por, mesmo com instante mais novo', () => {
  comColetiva((acervo, id) => {
    registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', alteradoPor: 'a@lid', alteradoEm: T1 });
    const antes = le(acervo, id);
    const gravou = registrarMetadadosDeColetiva(acervo, id, {
      assunto: 'Equipe', alteradoPor: 'aviso@lid', alteradoEm: T2, soSeMudar: true,
    });
    assert.equal(gravou, false);
    assert.deepEqual(le(acervo, id), antes);
  });
});

test('soSeMudar: texto diferente grava, com o autor e o instante entregues', () => {
  comColetiva((acervo, id) => {
    registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', alteradoPor: 'a@lid', alteradoEm: T1 });
    const gravou = registrarMetadadosDeColetiva(acervo, id, {
      assunto: 'Equipe B', alteradoPor: 'b@lid', alteradoEm: T2, soSeMudar: true,
    });
    assert.equal(gravou, true);
    assert.deepEqual(le(acervo, id), { assunto: 'Equipe B', descricao: null, alterado_por: 'b@lid', alterado_em: T2 });
  });
});

test('soSeMudar em Conversa sem linha grava a primeira vez', () => {
  comColetiva((acervo, id) => {
    assert.equal(registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', alteradoEm: T1, soSeMudar: true }), true);
    assert.equal(le(acervo, id)?.assunto, 'Equipe');
  });
});

test('sem soSeMudar a regra da fatia A segue: texto igual com instante mais novo atualiza o instante', () => {
  comColetiva((acervo, id) => {
    registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', alteradoPor: 'a@lid', alteradoEm: T1 });
    registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', alteradoPor: 'b@lid', alteradoEm: T2 });
    assert.deepEqual(le(acervo, id), { assunto: 'Equipe', descricao: null, alterado_por: 'b@lid', alterado_em: T2 });
  });
});

test('lerMetadadosDeColetiva: Conversa ausente, Conversa sem linha e Conversa com linha', () => {
  comColetiva((acervo, id) => {
    assert.deepEqual(lerMetadadosDeColetiva(acervo, 'whatsapp', 'outro-grupo@g.us'), { conversaId: undefined, assunto: null, descricao: null });
    assert.deepEqual(lerMetadadosDeColetiva(acervo, 'whatsapp', 'grupo-1@g.us'), { conversaId: id, assunto: null, descricao: null });
    registrarMetadadosDeColetiva(acervo, id, { assunto: 'Equipe', descricao: 'Descricao um', alteradoEm: T1 });
    assert.deepEqual(lerMetadadosDeColetiva(acervo, 'whatsapp', 'grupo-1@g.us'), { conversaId: id, assunto: 'Equipe', descricao: 'Descricao um' });
  });
});
