import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { desmarcarMensagem, marcarMensagem, mensagensMarcadas } from '../src/nucleo/marca-do-titular.js';
import { lerMensagens } from '../src/nucleo/consulta.js';

const AGORA = Date.parse('2026-09-13T12:00:00Z');
const OCORRIDA = Date.parse('2021-06-15T10:00:00Z');

function povoar(acervo: Parameters<typeof lerMensagens>[0]) {
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'direta-1',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
  const ids = ['m1', 'm2', 'm3'].map((idExterno, i) =>
    registrarMensagem(acervo, {
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno,
      conteudo: `mensagem ${idExterno}`,
      ocorridaEm: OCORRIDA + i * 1000,
      agora: AGORA,
    }),
  );
  return ids;
}

test('o filtro por favorito devolve so as marcadas', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ids = povoar(acervo);
    marcarMensagem(acervo, {
      mensagemId: ids[1] as string,
      marca: 'favorito',
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: AGORA,
    });

    const favoritas = lerMensagens(acervo, {
      favorito: true,
      configuracaoId: CFG_WHATSAPP.id,
    });
    assert.equal(favoritas.length, 1);
    assert.equal(favoritas[0]?.id, ids[1]);

    // SEM o filtro, as tres. Sem esta metade, um filtro que devolvesse sempre
    // uma passaria — e tambem um que devolvesse sempre tudo, se houvesse so
    // uma Mensagem no cenario.
    assert.equal(lerMensagens(acervo, {}).length, 3);
  } finally {
    c.limpar();
  }
});

test('favorito: false e SEM filtro, nao "so as nao favoritas"', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ids = povoar(acervo);
    marcarMensagem(acervo, {
      mensagemId: ids[0] as string,
      marca: 'favorito',
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: AGORA,
    });

    // Isto NAO e guarda contra a forma frouxa — medido, as duas se comportam
    // igual com um campo booleano. E guarda contra o CONTRARIO: alguem ler
    // `false` como "so as nao favoritas" e escrever o complemento.
    assert.equal(lerMensagens(acervo, { favorito: false }).length, 3);
  } finally {
    c.limpar();
  }
});

test('o filtro por favorito compoe com os outros, e nao os substitui', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ids = povoar(acervo);
    for (const id of ids) {
      marcarMensagem(acervo, {
        mensagemId: id,
        marca: 'favorito',
        configuracaoId: CFG_WHATSAPP.id,
        observadaEm: AGORA,
      });
    }

    // Tres favoritas, mas a janela so alcanca a primeira.
    const naJanela = lerMensagens(acervo, {
      favorito: true,
      configuracaoId: CFG_WHATSAPP.id,
      ate: OCORRIDA,
    });
    assert.equal(naJanela.length, 1);
    assert.equal(naJanela[0]?.id, ids[0]);
  } finally {
    c.limpar();
  }
});

test('favorito sem Configuracao recusa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    povoar(acervo);
    assert.throws(() => lerMensagens(acervo, { favorito: true }), /configuracao/i);
  } finally {
    c.limpar();
  }
});

test('marca de Mensagem vale por Configuracao na leitura', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ids = povoar(acervo);
    marcarMensagem(acervo, {
      mensagemId: ids[1] as string,
      marca: 'favorito',
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: AGORA,
    });
    marcarMensagem(acervo, {
      mensagemId: ids[1] as string,
      marca: 'favorito',
      configuracaoId: CFG_WHATSAPP_SEGUNDA.id,
      observadaEm: AGORA,
    });
    assert.deepEqual(mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id }), [
      ids[1],
    ]);
    assert.deepEqual(
      mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP_SEGUNDA.id }),
      [ids[1]],
    );
  } finally {
    c.limpar();
  }
});

test('desmarcar favorito na conta A nao tira a marca da conta B', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const ids = povoar(acervo);
    const mid = ids[1] as string;
    for (const cfg of [CFG_WHATSAPP.id, CFG_WHATSAPP_SEGUNDA.id]) {
      marcarMensagem(acervo, {
        mensagemId: mid,
        marca: 'favorito',
        configuracaoId: cfg,
        observadaEm: AGORA,
      });
    }
    desmarcarMensagem(acervo, {
      mensagemId: mid,
      marca: 'favorito',
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: AGORA + 1,
    });
    assert.deepEqual(
      mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id }),
      [],
    );
    assert.deepEqual(
      mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP_SEGUNDA.id }),
      [mid],
    );
    assert.equal(lerMensagens(acervo, { favorito: true, configuracaoId: CFG_WHATSAPP.id }).length, 0);
    assert.equal(
      lerMensagens(acervo, { favorito: true, configuracaoId: CFG_WHATSAPP_SEGUNDA.id }).length,
      1,
    );
  } finally {
    c.limpar();
  }
});
