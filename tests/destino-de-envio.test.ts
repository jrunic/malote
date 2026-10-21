import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { lerConversaDeEnvio, resolverDestinoPorConversa } from '../src/nucleo/destino-de-envio.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';

// #1323: o Envio por Conversa. O nucleo diz o que a Conversa e (existe? coletiva? de qual Configuracao? qual endereco?)
// e aplica a Decisao 4: a forma alternativa de um endereco com par canonico e REDIRECIONADA para a canonica.
// Nao decide quem e destinatario valido: isso e vocabulario de Fonte e mora no adaptador.

const TELEFONE = '5511900000001@s.whatsapp.net';
const OPACO = '123456789012345@lid';

function direta(
  acervo: Parameters<typeof registrarConversa>[0],
  idExterno: string,
  configuracao: { id: string; fonte: 'whatsapp' } = CFG_WHATSAPP,
) {
  return registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: false, configuracao, bruto: '{}' });
}

test('lerConversaDeEnvio devolve natureza, Configuracao dona e endereco; Conversa inexistente e undefined', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Inquilino de teste');
    const grupo = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'grupo-de-teste@g.us', coletiva: true, bruto: '{}' });
    const pessoa = direta(acervo, TELEFONE);

    assert.deepEqual(lerConversaDeEnvio(acervo, grupo), {
      id: grupo, fonte: 'whatsapp', coletiva: true, configuracaoId: null, endereco: 'grupo-de-teste@g.us',
    });
    assert.deepEqual(lerConversaDeEnvio(acervo, pessoa), {
      id: pessoa, fonte: 'whatsapp', coletiva: false, configuracaoId: CFG_WHATSAPP.id, endereco: TELEFONE,
    });
    assert.equal(lerConversaDeEnvio(acervo, 'nao-existe'), undefined);
  } finally {
    c.limpar();
  }
});

test('sem par canonico a Conversa dada e a usada, e Conversa inexistente e dita', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Inquilino de teste');
    const pessoa = direta(acervo, TELEFONE);
    const r = resolverDestinoPorConversa(acervo, pessoa);
    assert.equal(r.tipo, 'conversa');
    if (r.tipo === 'conversa') {
      assert.equal(r.usada.id, pessoa);
      assert.equal(r.dada.id, pessoa);
    }
    assert.deepEqual(resolverDestinoPorConversa(acervo, 'nao-existe'), { tipo: 'inexistente' });
  } finally {
    c.limpar();
  }
});

test('a Conversa alternativa com par canonico e redirecionada para a canonica da MESMA Configuracao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Inquilino de teste');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: TELEFONE });
    const alternativa = direta(acervo, OPACO);
    const canonica = direta(acervo, TELEFONE);
    // A canonica de OUTRA Configuracao nao serve: o fio e da conta.
    direta(acervo, TELEFONE, CFG_WHATSAPP_SEGUNDA);

    const r = resolverDestinoPorConversa(acervo, alternativa);
    assert.equal(r.tipo, 'conversa');
    if (r.tipo === 'conversa') {
      assert.equal(r.dada.id, alternativa);
      assert.equal(r.usada.id, canonica);
      assert.equal(r.usada.endereco, TELEFONE);
      assert.equal(r.usada.configuracaoId, CFG_WHATSAPP.id);
    }
    // A canonica dada nao e redirecionada.
    const rc = resolverDestinoPorConversa(acervo, canonica);
    assert.equal(rc.tipo === 'conversa' && rc.usada.id === canonica, true);
  } finally {
    c.limpar();
  }
});

test('alternativa com par mas SEM Conversa canonica da Configuracao devolve o endereco canonico, para o ouvinte cria-la', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Inquilino de teste');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: TELEFONE });
    const alternativa = direta(acervo, OPACO);
    // So a OUTRA Configuracao tem a Conversa de telefone: para esta, a canonica ainda nao existe.
    direta(acervo, TELEFONE, CFG_WHATSAPP_SEGUNDA);

    const r = resolverDestinoPorConversa(acervo, alternativa);
    assert.equal(r.tipo, 'endereco');
    if (r.tipo === 'endereco') {
      assert.equal(r.endereco, TELEFONE);
      assert.equal(r.dada.id, alternativa);
    }
  } finally {
    c.limpar();
  }
});

test('o eco da mensagem enviada ao endereco alternativo cai na Conversa canonica, a MESMA que o Envio redirecionado usa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Inquilino de teste');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: TELEFONE });
    const alternativa = direta(acervo, OPACO);
    const canonica = direta(acervo, TELEFONE);

    const r = resolverDestinoPorConversa(acervo, alternativa);
    assert.equal(r.tipo === 'conversa' && r.usada.id === canonica, true);

    // O eco que a plataforma devolve da mensagem enviada ao endereco alternativo (fromMe, na forma opaca).
    receberEvento(
      acervo,
      [{ key: { remoteJid: OPACO, id: 'ECO-SINTETICO-1', fromMe: true }, messageTimestamp: 1_790_000_000, message: { conversation: 'oi' } }],
      { agora: 1_790_000_100_000, configuracao: CFG_WHATSAPP },
    );

    const por = (id: string): number =>
      (acervo.preparar('SELECT COUNT(*) AS n FROM mensagens WHERE conversa_id = ?').get(id) as { n: number }).n;
    assert.equal(por(canonica), 1, 'o eco aparece na Conversa canonica');
    assert.equal(por(alternativa), 0, 'e nao na alternativa');
  } finally {
    c.limpar();
  }
});
