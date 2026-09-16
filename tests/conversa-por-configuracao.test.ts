import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarConversa, ConfiguracaoDeConversaError } from '../src/nucleo/escrita.js';
import { cenario } from './ajuda/acervo.js';

/**
 * Conversa direta pertence a UMA conta; coletiva pertence ao Inquilino.
 *
 * A assimetria e o modelo, e o dado a sustenta. Medido em 08/09/2026, ao
 * importar a segunda conta de WhatsApp do Titular sobre um Acervo que ja tinha
 * a primeira: 95 Conversas pre-existentes receberam Mensagem da conta nova —
 * **89 diretas e ZERO coletivas**. `conta-a <-> fulano` e `conta-b <-> fulano`
 * sao dois fios que por acaso dividem o endereco do outro lado; um grupo com as
 * duas contas dentro e um grupo, nao dois.
 *
 * Uma das 89 foi de 9.557 para 12.466 Mensagens num fio so, sem nada que
 * separasse por qual numero do Titular cada uma passou.
 */

test('Conversa direta SEM Configuracao e recusada', () => {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Padme').acervo;
    assert.throws(
      () =>
        registrarConversa(acervo, {
          fonte: 'whatsapp',
          idExterno: '5565999999999@s.whatsapp.net',
          coletiva: false,
        }),
      ConfiguracaoDeConversaError,
    );
  } finally {
    c.limpar();
  }
});

test('Conversa coletiva COM Configuracao e recusada', () => {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Padme').acervo;
    assert.throws(
      () =>
        registrarConversa(acervo, {
          fonte: 'whatsapp',
          idExterno: '120363000000000000@g.us',
          coletiva: true,
          configuracao: { id: 'cfg-1', fonte: 'whatsapp' },
        }),
      ConfiguracaoDeConversaError,
    );
  } finally {
    c.limpar();
  }
});

/**
 * A Configuracao vive no REGISTRO, que e outro arquivo — nao ha chave
 * estrangeira possivel, e o CHECK do schema tambem nao alcanca. A porta e o
 * unico lugar onde a Fonte da Conversa e a da Configuracao se encontram, e por
 * isso ela recebe a Fonte junto do id em vez de so o id.
 */
test('Configuracao de outra Fonte e recusada', () => {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Padme').acervo;
    assert.throws(
      () =>
        registrarConversa(acervo, {
          fonte: 'whatsapp',
          idExterno: '5565999999999@s.whatsapp.net',
          coletiva: false,
          configuracao: { id: 'cfg-ig', fonte: 'instagram' },
        }),
      ConfiguracaoDeConversaError,
    );
  } finally {
    c.limpar();
  }
});

/**
 * ESTE TESTE NAO PASSA PELA PORTA, de proposito.
 *
 * A guarda da porta e educacao do chamador; a restricao do schema e o que
 * impede a linha de existir. Um teste que so chamasse `registrarConversa` duas
 * vezes passaria mesmo se a protecao fosse um `if` no adaptador — e o que se
 * quer provar aqui e que nem escrevendo SQL direto a segunda coletiva entra.
 */
test('coletiva duplicada e recusada PELO SCHEMA, nao pela porta', () => {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Padme').acervo;
    const inserir = (id: string): void => {
      acervo.db
        .prepare(
          `INSERT INTO conversas (id, fonte, id_externo, coletiva, configuracao_id, criada_em, bruto)
           VALUES (?, 'whatsapp', '120363000000000000@g.us', 1, NULL, '2026-09-08T00:00:00Z', NULL)`,
        )
        .run(id);
    };
    inserir('a');
    assert.throws(() => inserir('b'), /UNIQUE constraint failed/);
  } finally {
    c.limpar();
  }
});

/**
 * O caso que motivou o ciclo inteiro: duas contas do mesmo Inquilino falando
 * com o MESMO endereco. Medido em 08/09/2026, uma dessas foi de 9.557 para
 * 12.466 Mensagens num fio so.
 */
test('duas diretas com o MESMO endereco e Configuracoes diferentes coexistem', () => {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Padme').acervo;
    const um = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5565999999999@s.whatsapp.net',
      coletiva: false,
      configuracao: { id: 'cfg-pessoal', fonte: 'whatsapp' },
    });
    const dois = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5565999999999@s.whatsapp.net',
      coletiva: false,
      configuracao: { id: 'cfg-business', fonte: 'whatsapp' },
    });
    assert.notEqual(um, dois, 'os dois fios viraram um');
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number };
    assert.equal(n.n, 2);
  } finally {
    c.limpar();
  }
});

/** A mesma Conversa direta, pela mesma Configuracao, continua sendo uma so. */
test('a mesma direta pela MESMA Configuracao nao duplica', () => {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Padme').acervo;
    const entrada = {
      fonte: 'whatsapp' as const,
      idExterno: '5565999999999@s.whatsapp.net',
      coletiva: false,
      configuracao: { id: 'cfg-pessoal', fonte: 'whatsapp' as const },
    };
    assert.equal(registrarConversa(acervo, entrada), registrarConversa(acervo, entrada));
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

/**
 * A QUARTA GUARDA, e ela nasceu de uma consequencia do lookup ramificado.
 *
 * Antes, o `SELECT` por (fonte, id_externo) ABSORVIA desencontro de natureza:
 * quem chegasse segundo encontrava a linha do primeiro, fosse ela coletiva ou
 * direta. O lookup por natureza deixa de absorver — e aí o mesmo endereco vira
 * DUAS Conversas, cada uma caindo num indice parcial diferente, sem que nada
 * reclame.
 *
 * Nao e hipotese. Medido em 08/09/2026: a importacao classifica por
 * `ZSESSIONTYPE != 0` e a recepcao ao vivo por `endsWith('@g.us')`. Para
 * `<numero>@status` os dois DISCORDAM — as 6 Conversas @status do Acervo real
 * estao coletiva=1, e ao vivo seriam diretas. Tarefa #826 unifica o criterio;
 * esta guarda transforma a divergencia em erro contado, em vez de corrupcao.
 */
test('endereco existente com a OUTRA natureza e conflito, nao segunda Conversa', () => {
  const c = cenario();
  try {
    const acervo = c.novoInquilino('Padme').acervo;
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '5561@status', coletiva: true });
    assert.throws(
      () =>
        registrarConversa(acervo, {
          fonte: 'whatsapp',
          idExterno: '5561@status',
          coletiva: false,
          configuracao: { id: 'cfg-1', fonte: 'whatsapp' },
        }),
      ConfiguracaoDeConversaError,
    );
    assert.equal(
      (acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number }).n,
      1,
      'virou duas Conversas para o mesmo endereco',
    );
  } finally {
    c.limpar();
  }
});
