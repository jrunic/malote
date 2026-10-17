import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { buscarMensagens } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = 1_791_300_000_000;
const INSTANTE = Math.floor((AGORA - 60_000) / 1000);
const DIRETA = '5511000000000@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';
const REMETENTE = '5511000000009@s.whatsapp.net';

function evento(id: string, message: Record<string, unknown>, remoteJid = DIRETA): MensagemRecebida {
  return {
    key: { remoteJid, id, fromMe: false, ...(remoteJid === GRUPO ? { participant: REMETENTE } : {}) },
    messageTimestamp: INSTANTE,
    message,
  };
}

const AVISO = { dataSharingContext: { showMmDisclosure: true, parameters: [{ key: 'chave-sintetica', stringData: 'aviso-fixo-sintetico' }] } };

/** A forma medida em campo: texto e um botao de link, sozinha no evento, em grupo. */
const interativa = (id: string, corpo: string): MensagemRecebida =>
  evento(
    id,
    {
      interactiveMessage: {
        body: { text: corpo },
        nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: '{"url":"https://exemplo.invalid/botao"}' }] },
      },
      messageContextInfo: { deviceListMetadataVersion: 2 },
    },
    GRUPO,
  );

/** O modelo interativo: corpo, rodape, botoes e, em 9 de 12, a imagem do cabecalho. */
const modeloInterativo = (id: string, corpo: string): MensagemRecebida =>
  evento(id, {
    templateMessage: {
      templateId: 'modelo-sintetico',
      interactiveMessageTemplate: {
        header: {
          title: '',
          hasMediaAttachment: true,
          imageMessage: { mimetype: 'image/jpeg', url: 'https://exemplo.invalid/cabecalho', directPath: '/v/sintetico/cabecalho', mediaKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
        },
        body: { text: corpo },
        footer: { text: 'rodape-sintetico-do-modelo' },
        nativeFlowMessage: { buttons: [{ name: 'cta_url', buttonParamsJson: '{"url":"https://exemplo.invalid/modelo"}' }] },
      },
      contextInfo: AVISO,
    },
  });

/** O modelo hidratado: titulo sempre vazio, texto de conteudo, rodape e botoes de resposta rapida. */
const modeloHidratado = (id: string, corpo: string): MensagemRecebida =>
  evento(id, {
    templateMessage: {
      templateId: 'modelo-hidratado-sintetico',
      hydratedTemplate: {
        hydratedTitleText: '',
        hydratedContentText: corpo,
        hydratedFooterText: 'rodape-hidratado-sintetico',
        hydratedButtons: [{ index: 0, quickReplyButton: { displayText: 'Sim', id: '1' } }],
      },
      contextInfo: AVISO,
    },
  });

function cena() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular de Teste');
  const receber = (eventos: MensagemRecebida[]) => receberEvento(acervo, eventos, { agora: AGORA, configuracao: CFG_WHATSAPP });
  const mensagens = () =>
    acervo.db.prepare('SELECT id_externo, conteudo, bruto, autor_id FROM mensagens ORDER BY id_externo').all() as {
      id_externo: string;
      conteudo: string | null;
      bruto: string;
      autor_id: string | null;
    }[];
  const anexos = () => (acervo.db.prepare('SELECT COUNT(*) AS n FROM anexos').get() as { n: number }).n;
  /** O endereco do autor gravado: o valor do Identificador, nao so a presenca de um. */
  const autorDe = (autorId: string | null): string | undefined =>
    autorId === null ? undefined : (acervo.db.prepare('SELECT valor FROM identificadores WHERE id = ?').get(autorId) as { valor: string } | undefined)?.valor;
  return { acervo, receber, mensagens, anexos, autorDe, limpar: c.limpar };
}

test('a mensagem interativa de conta comercial vira Mensagem, com o corpo como texto e sem Anexo', () => {
  const k = cena();
  try {
    const ev = interativa('INT1', 'corpo sintetico da interativa');
    const r = k.receber([ev]);
    assert.equal(r.gravados, 1);
    assert.equal(r.descartados.length, 0);
    assert.equal(r.ignorados['interactiveMessage'], undefined);
    const [m] = k.mensagens();
    assert.equal(m?.conteudo, 'corpo sintetico da interativa');
    assert.deepEqual(JSON.parse(m?.bruto ?? 'null'), ev, 'o bruto tem de guardar o evento inteiro, botoes e links incluidos');
    assert.equal(k.autorDe(m?.autor_id ?? null), REMETENTE, 'em grupo a Mensagem e do remetente do evento, nao do grupo');
    assert.equal(k.anexos(), 0);
  } finally {
    k.limpar();
  }
});

test('o modelo interativo vira Mensagem so com o corpo; rodape, aviso e imagem do cabecalho ficam no bruto, sem Anexo', () => {
  const k = cena();
  try {
    const r = k.receber([modeloInterativo('MOD1', 'corpo sintetico do modelo')]);
    assert.equal(r.gravados, 1);
    const [m] = k.mensagens();
    assert.equal(m?.conteudo, 'corpo sintetico do modelo');
    assert.equal(m?.conteudo?.includes('rodape-sintetico-do-modelo'), false, 'o rodape entrou no texto');
    assert.equal(m?.conteudo?.includes('aviso-fixo-sintetico'), false, 'o aviso de compartilhamento entrou no texto');
    assert.match(m?.bruto ?? '', /rodape-sintetico-do-modelo/);
    assert.match(m?.bruto ?? '', /cabecalho/);
    assert.equal(k.anexos(), 0, 'a imagem do cabecalho nao vira Anexo nesta tarefa');
  } finally {
    k.limpar();
  }
});

test('o modelo hidratado vira Mensagem com o texto de conteudo; titulo vazio e rodape ficam fora do texto', () => {
  const k = cena();
  try {
    k.receber([modeloHidratado('HID1', 'corpo sintetico hidratado')]);
    const [m] = k.mensagens();
    assert.equal(m?.conteudo, 'corpo sintetico hidratado');
    assert.match(m?.bruto ?? '', /rodape-hidratado-sintetico/);
    assert.equal(k.autorDe(m?.autor_id ?? null), DIRETA, 'em conversa direta o autor e o outro lado');
  } finally {
    k.limpar();
  }
});

test('evento dos dois tipos SEM corpo de texto NAO vira Mensagem: segue descartado com o rotulo do tipo', () => {
  const k = cena();
  try {
    const r = k.receber([
      evento('SEM1', { interactiveMessage: { nativeFlowMessage: { buttons: [] } } }, GRUPO),
      interativa('SEM2', ''),
      modeloHidratado('SEM3', ''),
      evento('SEM4', { templateMessage: { templateId: 'x', interactiveMessageTemplate: { header: { title: '' }, body: {} } } }),
    ]);
    assert.equal(r.gravados, 0);
    assert.deepEqual(r.descartados.map((d) => [d.motivo, d.ruido]), [
      ['interactiveMessage', false],
      ['interactiveMessage', false],
      ['templateMessage', false],
      ['templateMessage', false],
    ]);
    assert.equal(r.ignorados['interactiveMessage'], 2);
    assert.equal(r.ignorados['templateMessage'], 2);
    assert.equal(k.mensagens().length, 0, 'um evento sem corpo virou Mensagem vazia');
  } finally {
    k.limpar();
  }
});

test('a busca acha o corpo de cada forma', () => {
  const k = cena();
  try {
    k.receber([
      interativa('B1', 'palavraunicaum na interativa'),
      modeloInterativo('B2', 'palavraunicadois no modelo interativo'),
      modeloHidratado('B3', 'palavraunicatres no modelo hidratado'),
    ]);
    for (const [palavra, id] of [['palavraunicaum', 'B1'], ['palavraunicadois', 'B2'], ['palavraunicatres', 'B3']] as const) {
      const achadas = buscarMensagens(k.acervo, { texto: palavra });
      assert.equal(achadas.length, 1, `a busca nao achou ${palavra}`);
      const idExterno = (k.acervo.db.prepare('SELECT id_externo FROM mensagens WHERE id = ?').get(achadas[0]?.id) as { id_externo: string }).id_externo;
      assert.equal(idExterno, id);
    }
  } finally {
    k.limpar();
  }
});

test('a reentrega do mesmo evento NAO duplica a Mensagem', () => {
  const k = cena();
  try {
    const ev = modeloInterativo('REE1', 'corpo sintetico do modelo');
    k.receber([ev]);
    k.receber([ev]);
    assert.equal(k.mensagens().length, 1);
  } finally {
    k.limpar();
  }
});

test('o mesmo tipo dentro de uma Mensagem CITADA nunca gera Mensagem', () => {
  const k = cena();
  try {
    k.receber([
      evento('CIT1', {
        extendedTextMessage: {
          text: 'respondendo',
          contextInfo: { quotedMessage: { interactiveMessage: { body: { text: 'texto-da-citada' } } } },
        },
      }),
    ]);
    assert.deepEqual(k.mensagens().map((m) => [m.id_externo, m.conteudo]), [['CIT1', 'respondendo']]);
  } finally {
    k.limpar();
  }
});
