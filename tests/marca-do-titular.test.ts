import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import {
  marcarConversa,
  conversasMarcadas,
  reconciliarPorRetrato,
} from '../src/nucleo/marca-do-titular.js';

const QUANDO = Date.parse('2026-09-13T02:00:00Z');

test('marcar e idempotente: reobservar nao cria linha nova', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'direta-1',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });

    assert.equal(
      marcarConversa(acervo, {
        conversaId: conversa,
        marca: 'fixada',
        configuracaoId: CFG_WHATSAPP.id,
        observadaEm: QUANDO,
      }),
      true,
      'a primeira marcacao tinha de dizer que NASCEU',
    );
    assert.equal(
      marcarConversa(acervo, {
        conversaId: conversa,
        marca: 'fixada',
        configuracaoId: CFG_WHATSAPP.id,
        observadaEm: QUANDO + 60_000,
      }),
      false,
      'reobservar nao pode contar como marca nova',
    );
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }),
      [conversa],
    );
  } finally {
    c.limpar();
  }
});

test('a marca vale por Configuracao: fixar numa conta nao fixa na outra', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    // COLETIVA de proposito: e ela que e compartilhada entre Configuracoes
    // desde o ciclo 14, e por isso a coluna de Configuracao na marca nao e
    // redundante com a da Conversa.
    const coletiva = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'grupo-1',
      coletiva: true,
      metadadosDeColetiva: { assunto: 'Conselho' },
    });
    marcarConversa(acervo, {
      conversaId: coletiva,
      marca: 'fixada',
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });

    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }),
      [coletiva],
    );
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP_SEGUNDA.id }),
      [],
      'a segunda conta nao pode herdar a fixacao da primeira',
    );
  } finally {
    c.limpar();
  }
});

test('ATUALIZACAO PARCIAL nao desmarca o que nao veio nela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const x = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'd-x', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const y = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'd-y', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    marcarConversa(acervo, {
      conversaId: x, marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: QUANDO,
    });

    // y chega numa atualizacao que nao menciona x. x CONTINUA marcada — uma
    // atualizacao de um item nunca autoriza concluir ausencia dos outros.
    marcarConversa(acervo, {
      conversaId: y, marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: QUANDO + 1,
    });

    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }).sort(),
      [x, y].sort(),
    );
  } finally {
    c.limpar();
  }
});

test('reconciliar por RETRATO desmarca o que nao veio nele', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const x = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'd-x', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const y = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'd-y', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    for (const id of [x, y]) {
      marcarConversa(acervo, {
        conversaId: id, marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: QUANDO,
      });
    }

    reconciliarPorRetrato(acervo, {
      marca: 'fixada',
      configuracaoId: CFG_WHATSAPP.id,
      marcadas: [x],
      observadaEm: QUANDO + 120_000,
    });

    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }),
      [x],
    );
  } finally {
    c.limpar();
  }
});

test('o Retrato de uma Configuracao nao desmarca a OUTRA', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const coletiva = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'grupo-1', coletiva: true,
      metadadosDeColetiva: { assunto: 'Conselho' },
    });
    for (const cfg of [CFG_WHATSAPP.id, CFG_WHATSAPP_SEGUNDA.id]) {
      marcarConversa(acervo, {
        conversaId: coletiva, marca: 'fixada', configuracaoId: cfg, observadaEm: QUANDO,
      });
    }

    // A conta 1 manda um Retrato VAZIO: o Titular desfixou tudo por lá.
    reconciliarPorRetrato(acervo, {
      marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, marcadas: [], observadaEm: QUANDO + 1,
    });

    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }),
      [],
    );
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP_SEGUNDA.id }),
      [coletiva],
      'o Retrato de uma conta nao pode afirmar nada sobre a outra',
    );
  } finally {
    c.limpar();
  }
});
