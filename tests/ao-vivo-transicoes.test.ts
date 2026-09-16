import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { naturezaDoStub } from '../src/adaptadores/whatsapp/stubs-ao-vivo.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-02T12:00:00Z');

function stub(
  id: string,
  tipo: string | number,
  parametros: string[],
  extra: Partial<MensagemRecebida> = {},
): MensagemRecebida {
  return {
    key: { remoteJid: '120363000000000001@g.us', id, fromMe: false, participant: '111@lid' },
    messageTimestamp: Math.floor(AGORA / 1000),
    messageStubType: tipo,
    messageStubParameters: parametros,
    ...extra,
  };
}

test('o mapa ao vivo aceita nome E numero — a Fonte entrega as duas formas', () => {
  // Medido em 02/09/2026 na captura real: `GROUP_PARTICIPANT_ADD` e `LEAVE`
  // chegaram por NOME, e o tipo de mensagem cifrada chegou como NUMERO 2, no
  // mesmo arquivo. Aceitar so uma das formas perderia metade dos eventos.
  assert.equal(naturezaDoStub('GROUP_PARTICIPANT_ADD'), 'entrou');
  assert.equal(naturezaDoStub(27), 'entrou');
  assert.equal(naturezaDoStub('GROUP_PARTICIPANT_LEAVE'), 'saiu');
  assert.equal(naturezaDoStub(32), 'saiu');
  assert.equal(naturezaDoStub('GROUP_PARTICIPANT_REMOVE'), 'saiu');
  assert.equal(naturezaDoStub(28), 'saiu');
  assert.equal(naturezaDoStub('GROUP_CHANGE_ANNOUNCE'), null, 'mudanca de ajuste nao move ninguem');
  assert.equal(naturezaDoStub(undefined), null);
});

test('mensagem CIFRADA nao vira Mensagem — o lugar fica aberto para quem souber preencher', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    // 90 dos 4.167 eventos da captura de 02/09/2026. Grava-las como Mensagem
    // sem conteudo TRAVA o identificador: `registrarMensagem` e primeiro
    // escritor vence, e o backup que trouxer a mesma mensagem decifrada e
    // descartado como ja existente. O envelope nao vale o lugar.
    const r = receberEvento(acervo, [stub('AAA1', 2, ['0'])], { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.equal(r.gravados, 0);
    assert.equal(r.ignorados['cifrada'], 1);
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
    assert.equal(n.n, 0);
  } finally {
    c.limpar();
  }
});

test('o stub de entrada vira Transicao, com o membro na forma canonica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    // Medido em 02/09/2026: os 35 membros afetados na captura chegaram TODOS
    // na forma alternativa de endereco, e ZERO na canonica. Sem a traducao, a
    // Transicao penduraria num Identificador novo, separado de quem ja esta no
    // acervo pelo telefone.
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '109876543210987@lid',
      canonico: '5565911110001@s.whatsapp.net',
    });

    const r = receberEvento(
      acervo,
      [stub('bbb2', 'GROUP_PARTICIPANT_ADD', ['109876543210987@lid'])],
      { agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    assert.equal(r.gravados, 1, 'o evento administrativo tambem e Mensagem, como no material');
    assert.equal(r.transicoes, 1);

    const linhas = acervo.db
      .prepare(
        `SELECT t.natureza, t.id_externo, t.codigo_da_fonte, i.valor
           FROM transicoes_de_participacao t
           JOIN identificadores i ON i.id = t.identificador_id`,
      )
      .all() as { natureza: string; id_externo: string; codigo_da_fonte: string; valor: string }[];
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.natureza, 'entrou');
    assert.equal(linhas[0]?.id_externo, 'bbb2');
    assert.equal(linhas[0]?.codigo_da_fonte, 'GROUP_PARTICIPANT_ADD', 'o bruto da Fonte fica');
    assert.equal(linhas[0]?.valor, '5565911110001@s.whatsapp.net', 'na forma canonica');
  } finally {
    c.limpar();
  }
});

test('um evento com dois membros vira duas Transicoes sob o mesmo identificador', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    // Ocorreu na captura: 34 eventos, 35 membros — um deles moveu duas pessoas.
    // A chave de conflito e (fonte, id_externo, identificador_id), entao duas
    // linhas sob o mesmo id_externo e a forma correta, nao colisao.
    const r = receberEvento(
      acervo,
      [stub('ccc3', 'GROUP_PARTICIPANT_LEAVE', ['201@lid', '202@lid'])],
      { agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    assert.equal(r.transicoes, 2);
  } finally {
    c.limpar();
  }
});

test('reprocessar o mesmo evento nao cria Transicao nova', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Rey');
    const evento = stub('ddd4', 'GROUP_PARTICIPANT_ADD', ['301@lid']);
    const primeira = receberEvento(acervo, [evento], { agora: AGORA, configuracao: CFG_WHATSAPP });
    const segunda = receberEvento(acervo, [evento], { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.equal(primeira.transicoes, 1);
    assert.equal(segunda.transicoes, 0, 'quem responde "ja existe" e o Acervo, nao o ouvinte');
    const n = acervo.db
      .prepare('SELECT COUNT(*) AS n FROM transicoes_de_participacao')
      .get() as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('parametro que nao e endereco nao vira Transicao — e e contado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Finn');
    // O parametro de um stub nao e sempre endereco: nos eventos cifrados ele e
    // um numero. Descartar em silencio esconderia a mudanca de forma do dia em
    // que a Fonte trocar o conteudo do campo.
    const r = receberEvento(acervo, [stub('eee5', 'GROUP_PARTICIPANT_ADD', ['0'])], {
      agora: AGORA, configuracao: CFG_WHATSAPP,
    });
    assert.equal(r.transicoes, 0);
    assert.equal(r.ignorados['parametro-sem-endereco'], 1);
  } finally {
    c.limpar();
  }
});

test('a correspondencia se aprende ANTES de escrever — mesmo vindo depois no lote', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Jyn');
    const ALTERNATIVA = '109876543210999@lid';
    const TELEFONE = '5565911119999@s.whatsapp.net';

    // A ordem do lote e da Fonte, nao nossa: o evento que MOVE a pessoa pode
    // chegar antes da mensagem que revela as duas formas do endereco dela.
    // Aprendendo dentro do laco, o evento grava a forma alternativa; ao
    // reprocessar o mesmo lote, ele ja resolve para a canonica e nasce uma
    // SEGUNDA Transicao para o mesmo fato.
    //
    // Medido em 02/09/2026 contra a captura real, sobre 1.018.130 Mensagens: a
    // segunda passagem criou 10 Transicoes novas, e as 10 sao exatamente os
    // pares em que a mesma pessoa aparece nas duas formas sob o mesmo evento.
    //
    // A Restricao do repo ja dizia a regra — "quem aprende correspondencia tem
    // de aprende-la ANTES do laco que escreve endereco". O importador cumpria;
    // este adaptador nao.
    const lote: MensagemRecebida[] = [
      stub('fff6', 'GROUP_PARTICIPANT_ADD', [ALTERNATIVA]),
      {
        key: {
          remoteJid: '120363000000000001@g.us',
          id: 'ggg7',
          fromMe: false,
          participant: ALTERNATIVA,
          participantPn: TELEFONE,
        },
        messageTimestamp: Math.floor(AGORA / 1000),
        message: { conversation: 'oi' },
      },
    ];

    const primeira = receberEvento(acervo, lote, { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.equal(primeira.transicoes, 1);
    const valor = acervo.db
      .prepare(
        `SELECT i.valor FROM transicoes_de_participacao t
           JOIN identificadores i ON i.id = t.identificador_id`,
      )
      .get() as { valor: string };
    assert.equal(valor.valor, TELEFONE, 'a Transicao nasce ja na forma canonica');

    const segunda = receberEvento(acervo, lote, { agora: AGORA, configuracao: CFG_WHATSAPP });
    assert.equal(segunda.transicoes, 0, 'reprocessar o mesmo lote nao cria linha nova');
    const n = acervo.db
      .prepare('SELECT COUNT(*) AS n FROM transicoes_de_participacao')
      .get() as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('lote sem par de enderecos NAO abre Operacao de aprendizado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Cassian');
    // A forma do lote no ACEITE nao e a forma do lote em producao: o aceite
    // chamou esta porta UMA vez com 5.267 mensagens, e ao vivo ela e chamada
    // por evento, quase sempre com uma. Abrir o envelope de aprendizado
    // ansiosamente geraria DUAS Operacoes por mensagem recebida — a do evento e
    // uma de aprendizado vazia, porque so Conversa coletiva traz o par.
    //
    // Num ouvinte que roda por meses, isso dobra a trilha com lixo, que e
    // exatamente o que o envelope existe para evitar.
    receberEvento(
      acervo,
      [
        {
          key: { remoteJid: '5565911110001@s.whatsapp.net', id: 'hhh8', fromMe: false },
          messageTimestamp: Math.floor(AGORA / 1000),
          message: { conversation: 'conversa direta nao traz par' },
        },
      ],
      { agora: AGORA, configuracao: CFG_WHATSAPP },
    );
    const n = acervo.db
      .prepare("SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'aprender-endereco-ao-vivo'")
      .get() as { n: number };
    assert.equal(n.n, 0, 'sem par no lote, nao ha o que aprender');
  } finally {
    c.limpar();
  }
});
