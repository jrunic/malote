// tests/conexao-reenvio-biblioteca-real.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar, type EventoDeReenvio } from '../src/adaptadores/whatsapp/conexao.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

/**
 * Criterios 1 e 2 (#1420) de ponta a ponta, com a BIBLIOTECA REAL montando as mensagens: o socket falso envia com
 * `generateWAMessage` (sem rede, upload simulado), emite o eco como a biblioteca faz (`messages.upsert` com a mensagem
 * montada), a Conexao o normaliza e a recepcao de verdade o grava num Acervo real. Depois:
 * - pela memoria (mesma Conexao), o pedido devolve a mensagem montada;
 * - pelo Acervo (Conexao nova, o reinicio), o pedido devolve o bruto gravado reconstituido;
 * e nos dois a codificacao `proto.Message.encode` e igual a da mensagem enviada. O discriminador do Envio (so a
 * Mensagem com Envio da Configuracao) e da porta do nucleo, e nao e medido aqui: o leitor injetado le direto.
 */

interface MensagemDaBiblioteca {
  key: { id?: string };
  message: unknown;
}
interface BibliotecaReal {
  proto: {
    Message: { encode: (m: unknown) => { finish: () => Uint8Array }; fromObject: (o: unknown) => unknown };
    WebMessageInfo: { fromObject: (o: unknown) => unknown };
  };
  generateWAMessage: (jid: string, conteudo: unknown, opcoes: unknown) => Promise<MensagemDaBiblioteca>;
}

const CONTATO = '5511900000001@s.whatsapp.net';
const COLETIVA = '120363000000000001@g.us';
const OPACO = '100000000000001@lid';
const DA_CONTA = '5511900000009:3@s.whatsapp.net';
const silencioso = {
  level: 'silent',
  child() {
    return silencioso;
  },
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const upload = (): Promise<{ mediaUrl: string; directPath: string }> =>
  Promise.resolve({ mediaUrl: 'https://midia.exemplo/x', directPath: '/v/t62/x?ccb=1' });

interface ConfigDoSocket {
  getMessage?: (chave: { remoteJid?: string; id?: string }) => Promise<unknown>;
}

/** A biblioteca REAL, com `default` trocado por um socket que monta, ecoa e devolve como `sendMessage` faz. */
function bibliotecaComSocketFalso(real: BibliotecaReal): { lib: unknown; configs: ConfigDoSocket[] } {
  const configs: ConfigDoSocket[] = [];
  let sequencia = 0;
  const lib = {
    ...(real as object),
    default: (config: ConfigDoSocket) => {
      configs.push(config);
      const ouvintes = new Map<string, ((d: unknown) => void)[]>();
      return {
        ev: {
          on: (nome: string, f: (d: unknown) => void) => {
            ouvintes.set(nome, [...(ouvintes.get(nome) ?? []), f]);
          },
        },
        requestPairingCode: () => Promise.resolve('12345678'),
        sendMessage: async (jid: string, conteudo: unknown) => {
          const m = await real.generateWAMessage(jid, conteudo, {
            userJid: DA_CONTA,
            upload,
            logger: silencioso,
            messageId: `3EB0REAL${String((sequencia += 1)).padStart(8, '0')}`,
          });
          // O eco: `sendMessage` emite a mensagem montada em `messages.upsert` (messages-send.js:705).
          for (const f of ouvintes.get('messages.upsert') ?? []) f({ type: 'append', messages: [m] });
          return m;
        },
      };
    },
    useMultiFileAuthState: () => Promise.resolve({ state: { creds: 'sintetico' }, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401, connectionClosed: 428, connectionLost: 408 },
    DEFAULT_CONNECTION_CONFIG: { logger: silencioso },
  };
  return { lib, configs };
}

const lerBruto = (acervo: Acervo, referencia: string): string | undefined =>
  (
    acervo.db.prepare("SELECT bruto FROM mensagens WHERE fonte = 'whatsapp' AND id_externo = ?").get(referencia) as
      | { bruto: string }
      | undefined
  )?.bruto;

const CASOS: { nome: string; jid: string; conteudo: (lib: BibliotecaReal) => Record<string, unknown> }[] = [
  { nome: 'texto para contato', jid: CONTATO, conteudo: () => ({ text: 'ola' }) },
  { nome: 'texto para coletiva', jid: COLETIVA, conteudo: () => ({ text: 'ola coletiva' }) },
  { nome: 'texto para endereco opaco', jid: OPACO, conteudo: () => ({ text: 'ola opaco' }) },
  {
    nome: 'resposta a mensagem citada (imagem aninhada)',
    jid: COLETIVA,
    conteudo: (lib) => ({
      text: 'resposta',
      // `quoted` vai nas opcoes da biblioteca; o socket falso so recebe o conteudo, entao a citada vai no contextInfo.
      contextInfo: {
        stanzaId: 'CITADA-SINTETICA',
        participant: '5511900000002@s.whatsapp.net',
        quotedMessage: (
          lib.proto.WebMessageInfo.fromObject({
            message: {
              imageMessage: {
                mimetype: 'image/jpeg',
                mediaKey: randomBytes(32),
                fileSha256: randomBytes(32),
                fileLength: '5000000000',
                jpegThumbnail: randomBytes(200),
              },
            },
          }) as { message: unknown }
        ).message,
      },
    }),
  },
  {
    nome: 'imagem',
    jid: CONTATO,
    conteudo: () => ({
      image: randomBytes(2000),
      mimetype: 'image/jpeg',
      caption: 'legenda',
      jpegThumbnail: randomBytes(300).toString('base64'),
    }),
  },
  {
    nome: 'documento',
    jid: CONTATO,
    conteudo: () => ({ document: randomBytes(3000), mimetype: 'application/pdf', fileName: 'a.pdf', caption: 'doc' }),
  },
  {
    nome: 'audio',
    jid: CONTATO,
    conteudo: () => ({ audio: randomBytes(3000), mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 3 }),
  },
];

const codificar = (lib: BibliotecaReal, m: unknown): string => Buffer.from(lib.proto.Message.encode(m).finish()).toString('hex');

test('criterios 1 e 2 com a biblioteca real: pela memoria e, depois do reinicio, pelo Acervo, a codificacao e a enviada', async () => {
  const real = (await import('baileys')) as unknown as BibliotecaReal;
  const c = cenario();
  const pasta = mkdtempSync(join(tmpdir(), 'malote-reenvio-real-'));
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const aoReceber = (mensagens: MensagemRecebida[]): void => {
      const r = receberEvento(acervo, mensagens, {
        origemDaChegada: 'ao-vivo',
        agora: Date.now() + 60_000,
        configuracao: CFG_WHATSAPP,
      });
      assert.equal(r.recusados.length, 0, JSON.stringify(r.recusados));
    };

    // Primeira Conexao: envia cada caso; o eco e gravado pela recepcao de verdade.
    const um = bibliotecaComSocketFalso(real);
    const eventos1: EventoDeReenvio[] = [];
    const lidos1: string[] = [];
    const c1 = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(um.lib),
      aoReceber,
      aoPedidoDeReenvio: {
        lerDoAcervo: (ref) => {
          lidos1.push(ref);
          return lerBruto(acervo, ref);
        },
        aoEvento: (e) => eventos1.push(e),
      },
    });
    const enviados: { nome: string; jid: string; id: string; codificada: string }[] = [];
    for (const caso of CASOS) {
      // A mensagem montada e capturada por quem a recebe na rede: a memoria a devolve, e e ela que se compara.
      const r = await c1.enviar(caso.jid, caso.conteudo(real));
      assert.ok(r !== undefined, caso.nome);
      const pela = await um.configs[0]!.getMessage!({ remoteJid: caso.jid, id: r.keyId });
      assert.ok(pela !== undefined, `${caso.nome}: achada na memoria`);
      const bruto = lerBruto(acervo, r.keyId);
      assert.ok(bruto !== undefined, `${caso.nome}: o eco foi gravado`);
      enviados.push({ nome: caso.nome, jid: caso.jid, id: r.keyId, codificada: codificar(real, pela) });
    }
    assert.deepEqual(lidos1, [], 'criterio 1: a memoria acertou, o Acervo nao foi tocado');
    for (const e of eventos1) {
      const idade = e.tipo === 'pedido' ? e.idadeSegundos : undefined;
      assert.ok(typeof idade === 'number' && idade >= 0, 'a idade pela memoria');
    }
    assert.ok(eventos1.every((e) => e.tipo === 'pedido' && e.resultado === 'achada-na-memoria'));
    c1.parar();

    // Reinicio: Conexao nova, memoria vazia. So o Acervo atende.
    const dois = bibliotecaComSocketFalso(real);
    const eventos2: EventoDeReenvio[] = [];
    const c2 = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(dois.lib),
      aoReceber,
      aoPedidoDeReenvio: { lerDoAcervo: (ref) => lerBruto(acervo, ref), aoEvento: (e) => eventos2.push(e) },
    });
    for (const e of enviados) {
      const reconstituida = await dois.configs[0]!.getMessage!({ remoteJid: e.jid, id: e.id });
      assert.ok(reconstituida !== undefined, `${e.nome}: achada no Acervo`);
      assert.equal(codificar(real, reconstituida), e.codificada, `${e.nome}: a mesma codificacao`);
    }
    assert.deepEqual(
      eventos2.map((e) => (e.tipo === 'pedido' ? [e.resultado, e.enderecoDoRecibo] : e.tipo)),
      enviados.map(() => ['achada-no-acervo', 'igual']),
    );
    for (const e of eventos2) {
      // O instante do eco gravado e texto: a idade pelo Acervo passa pela conversao de verdade.
      const idade = e.tipo === 'pedido' ? e.idadeSegundos : undefined;
      assert.ok(typeof idade === 'number' && idade >= 0, 'a idade pelo Acervo');
    }
    c2.parar();
  } finally {
    c.limpar();
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('a memoria devolve o objeto que o socket devolveu ao enviar (a referencia, sem copia)', async () => {
  const real = (await import('baileys')) as unknown as BibliotecaReal;
  const pasta = mkdtempSync(join(tmpdir(), 'malote-reenvio-real-'));
  try {
    const um = bibliotecaComSocketFalso(real);
    const montadas: unknown[] = [];
    const lib = um.lib as { default: (c: ConfigDoSocket) => { sendMessage: (j: string, c: unknown) => Promise<MensagemDaBiblioteca> } };
    const original = lib.default;
    lib.default = (config) => {
      const sock = original(config);
      const enviar = sock.sendMessage;
      sock.sendMessage = async (j, c) => {
        const m = await enviar(j, c);
        montadas.push(m.message);
        return m;
      };
      return sock;
    };
    const conexao = await conectar({
      pastaDoVinculo: pasta,
      registrar: () => undefined,
      aoTerminar: () => undefined,
      carregarBiblioteca: () => Promise.resolve(lib),
      aoReceber: () => undefined,
      aoPedidoDeReenvio: { lerDoAcervo: () => undefined, aoEvento: () => undefined },
    });
    const r = await conexao.enviar(CONTATO, { text: 'x' });
    assert.equal(await um.configs[0]!.getMessage!({ remoteJid: CONTATO, id: r!.keyId }), montadas[0]);
    conexao.parar();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
