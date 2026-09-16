import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarParticipacao,
} from '../src/nucleo/escrita.js';
import { lerParticipacoes } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

function conversaEIdentificador(acervo: Parameters<typeof registrarConversa>[0]) {
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'conversa-1',
    coletiva: false, configuracao: CFG_WHATSAPP,
  });
  const { id: identificador } = registrarIdentificador(acervo, {
    fonte: 'whatsapp',
    valor: '+5511900000001',
  });
  return { conversa, identificador };
}

test('Participação sem data na Fonte grava início nulo, não uma aproximação', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversa, identificador } = conversaEIdentificador(acervo);

    registrarParticipacao(acervo, {
      conversaId: conversa,
      identificadorId: identificador,
      observadaEm: '2026-08-26T12:00:00.000Z',
    });

    const [p] = lerParticipacoes(acervo, conversa);
    assert.equal(p?.comecouEm, null, 'inicio desconhecido e nulo, nunca inventado');
    assert.equal(p?.terminouEm, null);
    assert.equal(p?.observadaEm, '2026-08-26T12:00:00.000Z');
  } finally {
    c.limpar();
  }
});

test('registrar a mesma Participação duas vezes atualiza a observação, sem duplicar', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversa, identificador } = conversaEIdentificador(acervo);

    // Com comecou_em nulo dentro da chave primária, o SQLite trataria nulo
    // como distinto de nulo e a segunda inserção duplicaria. Verificado por
    // execução em 26/08/2026 — ver ADR 20260826-participacao-sem-historico.
    registrarParticipacao(acervo, {
      conversaId: conversa,
      identificadorId: identificador,
      observadaEm: '2026-08-01T00:00:00.000Z',
    });
    registrarParticipacao(acervo, {
      conversaId: conversa,
      identificadorId: identificador,
      observadaEm: '2026-08-26T12:00:00.000Z',
    });

    const todas = lerParticipacoes(acervo, conversa);
    assert.equal(todas.length, 1, 'reimportar nao pode duplicar Participacao');
    assert.equal(todas[0]?.observadaEm, '2026-08-26T12:00:00.000Z', 'a observacao mais recente vence');
  } finally {
    c.limpar();
  }
});

test('quando a Fonte informa a data, ela é gravada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversa, identificador } = conversaEIdentificador(acervo);

    registrarParticipacao(acervo, {
      conversaId: conversa,
      identificadorId: identificador,
      comecouEm: '2019-03-10T08:00:00.000Z',
      observadaEm: '2026-08-26T12:00:00.000Z',
    });

    const [p] = lerParticipacoes(acervo, conversa);
    assert.equal(p?.comecouEm, '2019-03-10T08:00:00.000Z');
  } finally {
    c.limpar();
  }
});

test('duas Pessoas na mesma Conversa são duas Participações', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversa } = conversaEIdentificador(acervo);
    const { id: outro } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5511900000002' });
    const { id: primeiro } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5511900000001' });

    const observadaEm = '2026-08-26T12:00:00.000Z';
    registrarParticipacao(acervo, { conversaId: conversa, identificadorId: primeiro, observadaEm });
    registrarParticipacao(acervo, { conversaId: conversa, identificadorId: outro, observadaEm });

    assert.equal(lerParticipacoes(acervo, conversa).length, 2);
  } finally {
    c.limpar();
  }
});
