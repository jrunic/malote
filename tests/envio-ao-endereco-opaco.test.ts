import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { registrarEnvio } from '../src/nucleo/envio.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { processarEnvios } from '../src/adaptadores/whatsapp/enviar.js';
import { consultarDestinoDeWhatsapp } from '../src/adaptadores/whatsapp/resolver-celular.js';

// O Envio a um telefone cujo OPACO o Acervo ja conhece vai ao opaco. Medido em campo (14/11/2026): o aparelho que migrou
// para o endereco opaco nao decifra a mensagem cifrada para a sessao do telefone ("Aguardando mensagem"), e o reenvio
// que ele pede, mesmo forcando a sessao opaca, reenvia a mensagem montada para o telefone. O mesmo texto enviado ao
// opaco chegou legivel. O par ja e aprendido pela recepcao (#1439); aqui ele passa a valer tambem para quem ENVIA.

const TELEFONE = '556599990001@s.whatsapp.net';
const OUTRA_FORMA = '5565999990001@s.whatsapp.net';
const OPACO = '123456789012345@lid';
const OUTRO_OPACO = '543210987654321@lid';

function conhecido(acervo: Acervo): string {
  registrarIdentificador(acervo, { fonte: 'whatsapp', valor: TELEFONE });
  return registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: TELEFONE,
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
}

function par(acervo: Acervo, alternativo: string, canonico = TELEFONE): void {
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo, canonico });
}

async function destinoDoSocket(
  acervo: Acervo,
  destino: Parameters<typeof registrarEnvio>[1]['destino'],
): Promise<{ jid: string | undefined; envioId: string }> {
  const r = registrarEnvio(acervo, {
    configuracaoId: CFG_WHATSAPP.id,
    destino,
    conteudo: { tipo: 'texto', texto: 'oi' },
  });
  let jid: string | undefined;
  await processarEnvios(acervo, {
    configuracao: CFG_WHATSAPP,
    enviar: async (para) => {
      jid = para;
      return { keyId: 'ABC' };
    },
  });
  return { jid, envioId: r.envioId };
}

const conversasDiretas = (acervo: Acervo): number =>
  (acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas WHERE coletiva = 0').get() as { n: number }).n;

test('Envio ao telefone com o opaco conhecido vai ao opaco, e o Envio fica na Conversa do telefone', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const existente = conhecido(acervo);
    par(acervo, OPACO);

    const { jid, envioId } = await destinoDoSocket(acervo, { enderecoCru: TELEFONE });

    assert.equal(jid, OPACO);
    const linha = acervo.preparar('SELECT estado, conversa_id FROM envios WHERE id = ?').get(envioId) as {
      estado: string;
      conversa_id: string | null;
    };
    assert.equal(linha.estado, 'enviado');
    assert.equal(linha.conversa_id, existente, 'o eco cai na Conversa que o Acervo ja tem, nao numa nova');
    assert.equal(conversasDiretas(acervo), 1);
  } finally {
    c.limpar();
  }
});

test('Envio dado por Conversa do telefone com o opaco conhecido vai ao opaco', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const existente = conhecido(acervo);
    par(acervo, OPACO);

    const { jid, envioId } = await destinoDoSocket(acervo, { conversaId: existente });

    assert.equal(jid, OPACO);
    const linha = acervo.preparar('SELECT conversa_id FROM envios WHERE id = ?').get(envioId) as {
      conversa_id: string | null;
    };
    assert.equal(linha.conversa_id, existente);
    assert.equal(conversasDiretas(acervo), 1);
  } finally {
    c.limpar();
  }
});

test('a forma alternativa do celular, com o canonico de opaco conhecido, tambem vai ao opaco', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    conhecido(acervo);
    par(acervo, OUTRA_FORMA);
    par(acervo, OPACO);

    const { jid } = await destinoDoSocket(acervo, { enderecoCru: OUTRA_FORMA });

    assert.equal(jid, OPACO);
  } finally {
    c.limpar();
  }
});

test('sem opaco conhecido o Envio vai ao telefone, como antes', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    conhecido(acervo);

    const { jid } = await destinoDoSocket(acervo, { enderecoCru: TELEFONE });

    assert.equal(jid, TELEFONE);
  } finally {
    c.limpar();
  }
});

test('com dois opacos para o mesmo telefone o Envio fica no telefone: a duvida nao escolhe', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    conhecido(acervo);
    par(acervo, OPACO);
    par(acervo, OUTRO_OPACO);

    const { jid } = await destinoDoSocket(acervo, { enderecoCru: TELEFONE });

    assert.equal(jid, TELEFONE);
  } finally {
    c.limpar();
  }
});

test('o par das duas formas do celular (telefone com telefone) nao e opaco: o Envio vai ao telefone canonico', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    conhecido(acervo);
    par(acervo, OUTRA_FORMA);

    const { jid } = await destinoDoSocket(acervo, { enderecoCru: OUTRA_FORMA });

    assert.equal(jid, TELEFONE);
  } finally {
    c.limpar();
  }
});

test('destino dado ja no opaco e grupo saem como foram pedidos', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    conhecido(acervo);
    par(acervo, OPACO);

    assert.equal((await destinoDoSocket(acervo, { enderecoCru: OPACO })).jid, OPACO);
    assert.equal((await destinoDoSocket(acervo, { enderecoCru: 'grupo-de-teste@g.us' })).jid, 'grupo-de-teste@g.us');
  } finally {
    c.limpar();
  }
});

test('o aviso do pedido diz o mesmo que o ouvinte decide: redirecionado ao opaco', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    conhecido(acervo);
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, TELEFONE), { usado: TELEFONE, situacao: 'conhecido' });

    par(acervo, OPACO);
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, TELEFONE), { usado: OPACO, situacao: 'redirecionado' });
    assert.deepEqual(consultarDestinoDeWhatsapp(acervo, OUTRA_FORMA), { usado: OPACO, situacao: 'redirecionado' });
  } finally {
    c.limpar();
  }
});

test('canonico ja opaco: o Envio vai ao canonico, nunca a outro opaco que aponte para ele', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: OPACO });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: OPACO, coletiva: false, configuracao: CFG_WHATSAPP });
    par(acervo, TELEFONE, OPACO);
    par(acervo, OUTRO_OPACO, OPACO);

    const { jid } = await destinoDoSocket(acervo, { enderecoCru: TELEFONE });

    assert.equal(jid, OPACO);
  } finally {
    c.limpar();
  }
});
