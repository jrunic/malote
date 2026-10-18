import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar, executarReprocessar, ehReprocessarQueGravaEdicao, carregarDecodificadorOuAvisar } from '../src/cli/index.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { caminhosDaConta } from '../src/cli/ouvir.js';
import { derramar } from '../src/cli/derrame.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { cifrarEdicao, decodificadorDeTeste, segredoSintetico } from './ajuda/edicao-cifrada.js';

const GRUPO = '120363000000000001@g.us';
const AUTOR = '5511000000009@lid';
const T_ORIGINAL = Math.floor(Date.parse('2026-09-08T12:00:00Z') / 1000);
const T_EDICAO = Date.parse('2026-09-08T12:05:00Z');
const TEXTO_NOVO = 'TEXTO-SINTETICO-DA-EDICAO-QUE-NAO-PODE-VAZAR';

function instalacao() {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Cassian' });
  resolverConfiguracao(registro, id, 'whatsapp', 'principal');
  registro.fechar();
  return { raiz, id, limpar };
}

function original(id: string, segredo: Buffer): unknown {
  return {
    key: { remoteJid: GRUPO, id, fromMe: false, participant: AUTOR },
    messageTimestamp: T_ORIGINAL,
    message: { conversation: 'texto original', messageContextInfo: { messageSecret: segredo.toString('base64') } },
  };
}

function edicao(idEvento: string, alvoId: string, segredo: Buffer): unknown {
  const { encIv, encPayload } = cifrarEdicao({
    segredo,
    idOriginal: alvoId,
    editor: AUTOR,
    claro: { protocolMessage: { type: 'MESSAGE_EDIT', key: { id: alvoId }, editedMessage: { conversation: TEXTO_NOVO }, timestampMs: T_EDICAO } },
  });
  return {
    key: { remoteJid: GRUPO, id: idEvento, fromMe: false, participant: AUTOR },
    messageTimestamp: Math.floor(T_EDICAO / 1000),
    message: { secretEncryptedMessage: { targetMessageKey: { remoteJid: GRUPO, fromMe: false, id: alvoId }, encPayload, encIv, secretEncType: 'MESSAGE_EDIT' } },
  };
}

function edicoesNoAcervo(raiz: string, id: string): Array<{ texto: string; origem: string }> {
  const acervo = abrirAcervoSomenteLeitura(`${raiz}/acervos`, id);
  try {
    return acervo.preparar('SELECT texto, origem FROM edicoes').all() as Array<{ texto: string; origem: string }>;
  } finally {
    acervo.fechar();
  }
}

const ARGS = (verbo: string, id: string): string[] => ['ouvinte', verbo, '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'];

test('reprocessar-descartados com o decodificador grava a edicao guardada, diz so a contagem e esvazia a guarda', () => {
  const i = instalacao();
  try {
    const segredo = segredoSintetico();
    const guarda = caminhosDaConta(i.raiz, 'principal').guarda;
    mkdirSync(dirname(guarda), { recursive: true });
    const linha = (evento: unknown, motivo: string): string => JSON.stringify({ em: '2026-09-08T00:00:00.000Z', motivo, evento });
    writeFileSync(guarda, `${linha(original('ORIG-1', segredo), 'qualquer')}\n${linha(edicao('EV-1', 'ORIG-1', segredo), 'secretEncryptedMessage')}\n`);
    const linhas: string[] = [];
    const codigo = executar(ARGS('reprocessar-descartados', i.id), {
      dados: i.raiz,
      estado: i.raiz,
      escrever: (t: string) => linhas.push(t),
      ouvinteEscrevendo: () => false,
      decodificador: decodificadorDeTeste,
    });
    assert.equal(codigo, 0, linhas.join('\n'));
    const saida = linhas.join('\n');
    assert.match(saida, /2 evento\(s\) lido\(s\), 2 gravado\(s\), 0 mantido\(s\) na guarda, 0 retirado\(s\) por serem ruido\./);
    assert.match(saida, /1 edicao\(oes\) de Mensagem gravada\(s\)\./);
    assert.equal(saida.includes(TEXTO_NOVO), false, 'o texto da edicao vazou para a saida do comando');
    assert.equal(existsSync(guarda), false);
    assert.deepEqual(edicoesNoAcervo(i.raiz, i.id), [{ texto: TEXTO_NOVO, origem: 'cifrada' }]);
  } finally {
    i.limpar();
  }
});

test('reprocessar-descartados sem o decodificador deixa a edicao cifrada na guarda e nao fala de edicao', () => {
  const i = instalacao();
  try {
    const segredo = segredoSintetico();
    const guarda = caminhosDaConta(i.raiz, 'principal').guarda;
    mkdirSync(dirname(guarda), { recursive: true });
    const linha = (evento: unknown, motivo: string): string => JSON.stringify({ em: '2026-09-08T00:00:00.000Z', motivo, evento });
    writeFileSync(guarda, `${linha(original('ORIG-1', segredo), 'qualquer')}\n${linha(edicao('EV-1', 'ORIG-1', segredo), 'secretEncryptedMessage')}\n`);
    const linhas: string[] = [];
    executar(ARGS('reprocessar-descartados', i.id), {
      dados: i.raiz,
      estado: i.raiz,
      escrever: (t: string) => linhas.push(t),
      ouvinteEscrevendo: () => false,
    });
    const saida = linhas.join('\n');
    assert.match(saida, /2 evento\(s\) lido\(s\), 1 gravado\(s\), 1 mantido\(s\) na guarda/);
    assert.equal(/edicao\(oes\)/.test(saida), false);
    assert.deepEqual(edicoesNoAcervo(i.raiz, i.id), []);
  } finally {
    i.limpar();
  }
});

test('ouvinte reprocessar (derrame) grava a edicao derramada depois da original e diz so a contagem', () => {
  const i = instalacao();
  try {
    const segredo = segredoSintetico();
    const derrame = caminhosDaConta(i.raiz, 'principal').derrame;
    derramar(derrame, [original('ORIG-1', segredo)]);
    derramar(derrame, [edicao('EV-1', 'ORIG-1', segredo)]);
    const linhas: string[] = [];
    const codigo = executar(ARGS('reprocessar', i.id), {
      dados: i.raiz,
      estado: i.raiz,
      escrever: (t: string) => linhas.push(t),
      ouvinteEscrevendo: () => false,
      decodificador: decodificadorDeTeste,
    });
    assert.equal(codigo, 0, linhas.join('\n'));
    const saida = linhas.join('\n');
    assert.match(saida, /2 lote\(s\) reprocessado\(s\), 1 gravada/);
    assert.match(saida, /1 edicao\(oes\) de Mensagem gravada\(s\)\./);
    assert.equal(saida.includes(TEXTO_NOVO), false);
    assert.equal(existsSync(derrame), false);
    assert.deepEqual(edicoesNoAcervo(i.raiz, i.id), [{ texto: TEXTO_NOVO, origem: 'cifrada' }]);
  } finally {
    i.limpar();
  }
});

test('o ponto de entrada carrega o decodificador uma vez, e a falha em carregar vira aviso, nunca erro', async () => {
  const semAviso: string[] = [];
  const bom = await carregarDecodificadorOuAvisar((t: string) => semAviso.push(t), async () => decodificadorDeTeste);
  assert.equal(bom, decodificadorDeTeste);
  assert.equal(semAviso.length, 0);

  const avisos: string[] = [];
  const ruim = await carregarDecodificadorOuAvisar((t: string) => avisos.push(t), async (): Promise<never> => {
    throw new Error('biblioteca quebrada');
  });
  assert.equal(ruim, undefined);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0] ?? '', /decodificador de edicao indisponivel/);
  assert.match(avisos[0] ?? '', /biblioteca quebrada/);
});

test('com a biblioteca REAL: o carregador padrao do comando decifra e grava a edicao cifrada com protobuf verdadeiro', async () => {
  const lib = (await import('baileys')) as unknown as {
    proto: {
      Message: {
        create: (o: unknown) => unknown;
        encode: (m: unknown) => { finish: () => Uint8Array };
        ProtocolMessage: { Type: { MESSAGE_EDIT: number } };
      };
    };
  };
  const i = instalacao();
  try {
    const segredo = segredoSintetico();
    const claro = Buffer.from(
      lib.proto.Message.encode(
        lib.proto.Message.create({
          protocolMessage: {
            type: lib.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { id: 'ORIG-1' },
            editedMessage: { extendedTextMessage: { text: TEXTO_NOVO } },
            timestampMs: T_EDICAO,
          },
        }),
      ).finish(),
    );
    const { encIv, encPayload } = cifrarEdicao({ segredo, idOriginal: 'ORIG-1', editor: AUTOR, claro });
    const envelope = {
      key: { remoteJid: GRUPO, id: 'EV-1', fromMe: false, participant: AUTOR },
      messageTimestamp: Math.floor(T_EDICAO / 1000),
      message: { secretEncryptedMessage: { targetMessageKey: { remoteJid: GRUPO, fromMe: false, id: 'ORIG-1' }, encPayload, encIv, secretEncType: 'MESSAGE_EDIT' } },
    };
    const guarda = caminhosDaConta(i.raiz, 'principal').guarda;
    mkdirSync(dirname(guarda), { recursive: true });
    const linha = (evento: unknown, motivo: string): string => JSON.stringify({ em: '2026-09-08T00:00:00.000Z', motivo, evento });
    writeFileSync(guarda, `${linha(original('ORIG-1', segredo), 'qualquer')}\n${linha(envelope, 'secretEncryptedMessage')}\n`);

    const avisos: string[] = [];
    const decodificador = await carregarDecodificadorOuAvisar((t: string) => avisos.push(t));
    assert.equal(avisos.length, 0, avisos.join(' | '));
    assert.ok(decodificador !== undefined);

    const linhas: string[] = [];
    const codigo = executar(ARGS('reprocessar-descartados', i.id), {
      dados: i.raiz,
      estado: i.raiz,
      escrever: (t: string) => linhas.push(t),
      ouvinteEscrevendo: () => false,
      decodificador,
    });
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.match(linhas.join('\n'), /1 edicao\(oes\) de Mensagem gravada\(s\)\./);
    assert.deepEqual(edicoesNoAcervo(i.raiz, i.id), [{ texto: TEXTO_NOVO, origem: 'cifrada' }]);
  } finally {
    i.limpar();
  }
});

test('o despacho: so os dois reprocessos que gravam edicao pedem o decodificador', () => {
  assert.equal(ehReprocessarQueGravaEdicao(['ouvinte', 'reprocessar-descartados', '--inquilino', 'x']), true);
  assert.equal(ehReprocessarQueGravaEdicao(['ouvinte', 'reprocessar']), true);
  assert.equal(ehReprocessarQueGravaEdicao(['ouvinte', 'estado']), false);
  assert.equal(ehReprocessarQueGravaEdicao(['transcricao', 'reprocessar']), false);
  assert.equal(ehReprocessarQueGravaEdicao(['envio', 'reprocessar']), false);
  assert.equal(ehReprocessarQueGravaEdicao(['midia', 'reprocessar']), false);
  assert.equal(ehReprocessarQueGravaEdicao([]), false);
});

test('executarReprocessar carrega o decodificador, entrega ao comando e a edicao entra', async () => {
  const i = instalacao();
  try {
    const segredo = segredoSintetico();
    const guarda = caminhosDaConta(i.raiz, 'principal').guarda;
    mkdirSync(dirname(guarda), { recursive: true });
    const linha = (evento: unknown, motivo: string): string => JSON.stringify({ em: '2026-09-08T00:00:00.000Z', motivo, evento });
    writeFileSync(guarda, `${linha(original('ORIG-1', segredo), 'qualquer')}\n${linha(edicao('EV-1', 'ORIG-1', segredo), 'secretEncryptedMessage')}\n`);
    const linhas: string[] = [];
    let carregou = 0;
    const codigo = await executarReprocessar(
      ARGS('reprocessar-descartados', i.id),
      { dados: i.raiz, estado: i.raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false },
      async () => {
        carregou += 1;
        return decodificadorDeTeste;
      },
    );
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.equal(carregou, 1);
    assert.deepEqual(edicoesNoAcervo(i.raiz, i.id), [{ texto: TEXTO_NOVO, origem: 'cifrada' }]);
  } finally {
    i.limpar();
  }
});

test('executarReprocessar com o carregador quebrado avisa na saida de erro e o comando segue, com a edicao guardada', async () => {
  const i = instalacao();
  try {
    const segredo = segredoSintetico();
    const guarda = caminhosDaConta(i.raiz, 'principal').guarda;
    mkdirSync(dirname(guarda), { recursive: true });
    const linha = (evento: unknown, motivo: string): string => JSON.stringify({ em: '2026-09-08T00:00:00.000Z', motivo, evento });
    writeFileSync(guarda, `${linha(original('ORIG-1', segredo), 'qualquer')}\n${linha(edicao('EV-1', 'ORIG-1', segredo), 'secretEncryptedMessage')}\n`);
    const linhas: string[] = [];
    const erros: string[] = [];
    const codigo = await executarReprocessar(
      ARGS('reprocessar-descartados', i.id),
      { dados: i.raiz, estado: i.raiz, escrever: (t: string) => linhas.push(t), erro: (t: string) => erros.push(t), ouvinteEscrevendo: () => false },
      async (): Promise<never> => {
        throw new Error('biblioteca quebrada');
      },
    );
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.equal(erros.length, 1);
    assert.match(erros[0] ?? '', /decodificador de edicao indisponivel/);
    assert.match(linhas.join('\n'), /2 evento\(s\) lido\(s\), 1 gravado\(s\), 1 mantido\(s\) na guarda/);
    assert.deepEqual(edicoesNoAcervo(i.raiz, i.id), []);
  } finally {
    i.limpar();
  }
});
