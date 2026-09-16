import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import {
  registrarConversa,
  registrarMensagem,
  registrarIdentificador,
  idDeConversaPorEndereco,
  idDeMensagemPorExterno,
} from '../src/nucleo/escrita.js';
import { listarConversas } from '../src/nucleo/consulta.js';
import { processarEstadoDeConversa } from '../src/adaptadores/whatsapp/estado-ao-vivo.js';
import {
  conversasMarcadas,
  marcarConversa,
  mensagensMarcadas,
} from '../src/nucleo/marca-do-titular.js';
import { aprenderCorrespondencia, resolverEndereco } from '../src/nucleo/correspondencia.js';
import { nomesDoIdentificador } from '../src/nucleo/identidade.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';

const QUANDO = Date.parse('2026-09-15T12:00:00Z');

// A forma que o baileys 6.7.24 REALMENTE emite (chat-utils.js, pinAction):
// `pinned` e o timestamp da fixacao quando fixa, `null` quando desfixa.
// Boolean NAO existe no campo — fixture que grava `true`/`false` testa uma
// forma que o campo nunca produz, e foi assim que o defeito de 15/09 passou.
const FIXADA_EM = 1789506000000;
function item(id: string, pinned: number | null) {
  return { id, pinned, archived: false };
}

test('lookup encontra a existente e NAO cria a ausente', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const id = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5565911110001@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(
      idDeConversaPorEndereco(acervo, {
        fonte: 'whatsapp',
        idExterno: '5565911110001@s.whatsapp.net',
        configuracaoId: CFG_WHATSAPP.id,
      }),
      id,
    );
    assert.equal(
      idDeConversaPorEndereco(acervo, {
        fonte: 'whatsapp',
        idExterno: '999@lid',
        configuracaoId: CFG_WHATSAPP.id,
      }),
      undefined,
    );
    assert.equal(listarConversas(acervo, {}).length, 1);
  } finally {
    c.limpar();
  }
});

test('Retrato com tres fixadas grava tres; lote inteiro nao vira marca', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const ids = ['a', 'b', 'c', 'd'].map((n) =>
      registrarConversa(acervo, {
        fonte: 'whatsapp',
        idExterno: `${n}@s.whatsapp.net`,
        coletiva: false,
        configuracao: CFG_WHATSAPP,
      }),
    );
    const dados = [
      item('a@s.whatsapp.net', FIXADA_EM),
      item('b@s.whatsapp.net', FIXADA_EM),
      item('c@s.whatsapp.net', FIXADA_EM),
      ...Array.from({ length: 27 }, (_, i) => item(`x${i}@s.whatsapp.net`, null)),
    ];
    const r = processarEstadoDeConversa(acervo, {
      fluxo: 'chats.update',
      dado: dados,
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.equal(r.classe, 'retrato');
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }).sort(),
      ids.slice(0, 3).sort(),
    );
  } finally {
    c.limpar();
  }
});

test('atualizacao de um item nao desmarca as outras', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const x = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'x@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const y = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'y@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    marcarConversa(acervo, {
      conversaId: x,
      marca: 'fixada',
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    processarEstadoDeConversa(acervo, {
      fluxo: 'chats.update',
      dado: [item('y@s.whatsapp.net', FIXADA_EM)],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO + 1,
    });
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }).sort(),
      [x, y].sort(),
    );
  } finally {
    c.limpar();
  }
});

test('endereco opaco sem par pula e conta; zero Conversa nova', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const r = processarEstadoDeConversa(acervo, {
      fluxo: 'chats.update',
      dado: [item('999@lid', FIXADA_EM)],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.equal(r.opacosPulados, 1);
    assert.equal(listarConversas(acervo, {}).length, 0);
  } finally {
    c.limpar();
  }
});

test('item sem a chave pinned (so archived) NAO desmarca fixacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const id = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'a@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    marcarConversa(acervo, {
      conversaId: id,
      marca: 'fixada',
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    // Evento de arquivamento: o baileys emite sem a chave `pinned`. A forma
    // anterior do codigo desmarcava a fixacao por um evento que nao fala
    // dela — o defeito do criterio 6, pego no campo em 15/09/2026.
    const r = processarEstadoDeConversa(acervo, {
      fluxo: 'chats.update',
      dado: [{ id: 'a@s.whatsapp.net', archived: true }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO + 1,
    });
    assert.equal(r.classe, 'atualizacao');
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }),
      [id],
    );
  } finally {
    c.limpar();
  }
});

test('endereco opaco COM par resolve antes de virar id_externo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const id = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5565911110001@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: '999@lid',
      canonico: '5565911110001@s.whatsapp.net',
    });
    processarEstadoDeConversa(acervo, {
      fluxo: 'chats.update',
      dado: [item('999@lid', FIXADA_EM)],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }),
      [id],
    );
    assert.equal(listarConversas(acervo, {}).length, 1);
  } finally {
    c.limpar();
  }
});

test('messaging-history.set usa chats do envelope, nao contacts', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const ids = ['a', 'b', 'c'].map((n) =>
      registrarConversa(acervo, {
        fonte: 'whatsapp',
        idExterno: `${n}@s.whatsapp.net`,
        coletiva: false,
        configuracao: CFG_WHATSAPP,
      }),
    );
    const chats = [
      item('a@s.whatsapp.net', FIXADA_EM),
      item('b@s.whatsapp.net', FIXADA_EM),
      item('c@s.whatsapp.net', FIXADA_EM),
      ...Array.from({ length: 27 }, (_, i) => item(`x${i}@s.whatsapp.net`, null)),
    ];
    processarEstadoDeConversa(acervo, {
      fluxo: 'messaging-history.set',
      dado: {
        chats,
        contacts: [{ id: 'a@s.whatsapp.net', name: 'NaoEConversa' }],
        messages: [{ key: { id: 'm1' } }],
      },
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }).sort(),
      ids.sort(),
    );
  } finally {
    c.limpar();
  }
});

test('messages.update nao chama reconciliar mesmo com mil itens pinned', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const x = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'x@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    marcarConversa(acervo, {
      conversaId: x,
      marca: 'fixada',
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    const lote = Array.from({ length: 40 }, (_, i) => item(`n${i}@s.whatsapp.net`, FIXADA_EM));
    processarEstadoDeConversa(acervo, {
      fluxo: 'messages.update',
      dado: lote,
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO + 1,
    });
    assert.deepEqual(
      conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }),
      [x],
    );
  } finally {
    c.limpar();
  }
});

test('lookup de Mensagem encontra a existente e NAO cria a ausente', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'a@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const id = registrarMensagem(acervo, {
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'stanza-1',
      conteudo: 'oi',
      ocorridaEm: QUANDO,
      agora: QUANDO,
    });
    assert.equal(
      idDeMensagemPorExterno(acervo, { fonte: 'whatsapp', idExterno: 'stanza-1' }),
      id,
    );
    assert.equal(
      idDeMensagemPorExterno(acervo, { fonte: 'whatsapp', idExterno: 'nao-existe' }),
      undefined,
    );
  } finally {
    c.limpar();
  }
});

test('upsert grava nome titular no Identificador CANONICO', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const lote = [
      { id: '111@lid', jid: '5565911110001@s.whatsapp.net', lid: '111@lid', name: 'Ana Prado' },
      { id: '222@lid', jid: '5565911110002@s.whatsapp.net', lid: '222@lid', name: 'Bea Nunes' },
    ];
    processarEstadoDeConversa(acervo, {
      fluxo: 'contacts.upsert',
      dado: lote,
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.equal(resolverEndereco(acervo, 'whatsapp', '111@lid'), '5565911110001@s.whatsapp.net');
    const r = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565911110001@s.whatsapp.net',
    });
    assert.equal(r.criado, false, 'o processador ja tinha criado o Identificador canonico');
    const nomes = nomesDoIdentificador(acervo, r.id);
    assert.equal(nomes.length, 1);
    assert.equal(nomes[0]?.autoridade, 'titular');
    assert.equal(nomes[0]?.nome, 'Ana Prado');
    const noLid = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '111@lid' });
    assert.equal(nomesDoIdentificador(acervo, noLid.id).length, 0, 'nome nao grava no @lid');
  } finally {
    c.limpar();
  }
});

test('segunda passagem nao abre segunda Operacao de aprender endereco', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const lote = [
      { id: '111@lid', jid: '5565911110001@s.whatsapp.net', lid: '111@lid', name: 'Ana Prado' },
    ];
    const run = () =>
      processarEstadoDeConversa(acervo, {
        fluxo: 'contacts.upsert',
        dado: lote,
        configuracaoId: CFG_WHATSAPP.id,
        observadaEm: QUANDO,
      });
    run();
    run();
    const ops = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'aprender-endereco-ao-vivo');
    assert.equal(ops.length, 1);
  } finally {
    c.limpar();
  }
});

test('messages.update sem starred nao passa por processarFavoritos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'a@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'stanza-1',
      conteudo: 'oi',
      ocorridaEm: QUANDO,
      agora: QUANDO,
    });
    const r = processarEstadoDeConversa(acervo, {
      fluxo: 'messages.update',
      dado: [{ key: { id: 'stanza-1' }, update: { status: 4 } }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.equal(r.classe, 'ignorar');
    assert.equal(r.favoritosSemMensagem, 0);
    assert.deepEqual(
      mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id }),
      [],
    );
  } finally {
    c.limpar();
  }
});

test('messages.update starred marca e desmarca Mensagem existente', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: 'a@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const mid = registrarMensagem(acervo, {
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'stanza-1',
      conteudo: 'oi',
      ocorridaEm: QUANDO,
      agora: QUANDO,
    });
    const r1 = processarEstadoDeConversa(acervo, {
      fluxo: 'messages.update',
      dado: [{ key: { id: 'stanza-1' }, update: { starred: true } }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.deepEqual(
      mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id }),
      [mid],
    );
    processarEstadoDeConversa(acervo, {
      fluxo: 'messages.update',
      dado: [{ key: { id: 'stanza-1' }, update: { starred: false } }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO + 1,
    });
    assert.deepEqual(
      mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id }),
      [],
    );
    assert.equal(r1.favoritosSemMensagem, 0);
  } finally {
    c.limpar();
  }
});

test('favorito de Mensagem ausente pula e conta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const r = processarEstadoDeConversa(acervo, {
      fluxo: 'messages.update',
      dado: [{ key: { id: 'sumida' }, update: { starred: true } }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.equal(r.favoritosSemMensagem, 1);
    assert.deepEqual(
      mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id }),
      [],
    );
  } finally {
    c.limpar();
  }
});
