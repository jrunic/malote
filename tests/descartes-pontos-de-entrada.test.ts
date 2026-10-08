// tests/descartes-pontos-de-entrada.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { paraDrenar } from './ajuda/drenagem.js';
import { executar } from '../src/cli/index.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { caminhosDaConta, drenar, ouvir } from '../src/cli/ouvir.js';
import { derramar } from '../src/cli/derrame.js';
import { marcarUltimoEvento } from '../src/cli/ultimo-evento.js';
import {
  anotarDescartes,
  falhasDeDescartes,
  lerDescartes,
  registrarDescartes,
} from '../src/cli/descartes.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { cenario } from './ajuda/acervo.js';

const AGORA = Date.parse('2026-10-07T12:00:00Z');
const INSTANTE = Math.floor((AGORA - 60_000) / 1000);
const DIA = '2026-10-07';
const SEGREDO = 'TEXTO-SINTETICO-QUE-NAO-PODE-APARECER';

// Instante no passado FIXO, para os testes que reprocessam com `Date.now()` real.
const PASSADO = Math.floor(Date.parse('2026-09-08T12:00:00Z') / 1000);

function descartavel(id: string, instante = INSTANTE): MensagemRecebida {
  return {
    key: { remoteJid: '5511000000000@s.whatsapp.net', id, fromMe: false },
    messageTimestamp: instante,
    message: { protocolMessage: { type: 'REVOKE', texto: SEGREDO } },
  };
}

function comum(id: string, instante = INSTANTE): MensagemRecebida {
  return {
    key: { remoteJid: '5511000000000@s.whatsapp.net', id, fromMe: false },
    messageTimestamp: instante,
    message: { conversation: 'oi' },
  };
}

function bibliotecaQueEntrega(mensagens: unknown[]): { disparar: () => void } {
  const ouvintes = new Map<string, (dado: unknown) => void>();
  return {
    default: () => ({
      ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
      requestPairingCode: () => Promise.resolve('12345678'),
    }),
    useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
    DisconnectReason: { loggedOut: 401 },
    disparar: (): void => {
      setImmediate(() => {
        ouvintes.get('messages.upsert')?.({ type: 'notify', messages: mensagens });
        setImmediate(() =>
          ouvintes.get('connection.update')?.({
            connection: 'close',
            lastDisconnect: { error: { output: { statusCode: 401 } } },
          }),
        );
      });
    },
  } as unknown as { disparar: () => void };
}

test('a RECEPCAO ao vivo anota os descartes do lote no contador da conta', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Padme' });
    resolverConfiguracao(registro, id, 'whatsapp', 'teste');
    registro.fechar();
    const caminhos = caminhosDaConta(raiz, 'viva');
    mkdirSync(caminhos.vinculo, { recursive: true });
    writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
    abrirAcervo(join(raiz, 'acervos'), id).fechar();

    const biblioteca = bibliotecaQueEntrega([descartavel('D1'), descartavel('D2'), comum('M1')]);
    const linhas: string[] = [];
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'viva', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      agora: () => AGORA,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        setImmediate(() => biblioteca.disparar());
        return Promise.resolve(biblioteca as never);
      },
    });
    assert.equal(codigo, 1, `nao chegou ao logout: ${linhas.join(' | ')}`);
    assert.deepEqual(lerDescartes(caminhos.descartes), { [DIA]: { 'protocolMessage:REVOKE': 2 } });
    assert.equal(linhas.join('\n').includes(SEGREDO), false, 'o conteudo vazou para a saida');
  } finally {
    limpar();
  }
});

test('a DRENAGEM anota os descartes do lote que tinha derramado', async () => {
  const d = await paraDrenar();
  try {
    derramar(d.caminho, [descartavel('X1'), comum('X2')]);
    const anotados: string[][] = [];
    drenar(d.acervo, d.caminho, d.cfg, () => AGORA, () => undefined, undefined, (r) => {
      anotados.push(r.descartados.map((e) => e.motivo));
    });
    assert.deepEqual(anotados, [['protocolMessage:REVOKE']]);
  } finally {
    d.limpar();
  }
});

test('o reprocessar do DERRAME anota os descartes', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Cassian' });
    resolverConfiguracao(registro, id, 'whatsapp', 'principal');
    registro.fechar();
    const caminhos = caminhosDaConta(raiz, 'principal');
    derramar(caminhos.derrame, [descartavel('R1', PASSADO), comum('R2', PASSADO)]);
    const linhas: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false },
    );
    assert.equal(codigo, 0, linhas.join('\n'));
    const serie = lerDescartes(caminhos.descartes);
    const total = Object.values(serie).reduce((s, b) => s + (b['protocolMessage:REVOKE'] ?? 0), 0);
    assert.equal(total, 1);
  } finally {
    limpar();
  }
});

test('o reprocessar do derrame INTERROMPIDO nao anota: so a rodada completa conta', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Jyn' });
    resolverConfiguracao(registro, id, 'whatsapp', 'principal');
    registro.fechar();
    const caminhos = caminhosDaConta(raiz, 'principal');
    // O segundo lote nao e evento: `receberEvento` lanca (erro que NAO e banco ocupado) e a rodada para.
    derramar(caminhos.derrame, [descartavel('I1', PASSADO)]);
    derramar(caminhos.derrame, [null]);
    const saida: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'],
      { dados: raiz, estado: raiz, escrever: (t: string) => saida.push(t), ouvinteEscrevendo: () => false },
    );
    // `executar` NAO lanca: o erro vira codigo diferente de zero e a mensagem (medido: codigo 1).
    assert.notEqual(codigo, 0, saida.join('\n'));
    assert.deepEqual(lerDescartes(caminhos.descartes), {}, 'anotou uma rodada que nao terminou');
  } finally {
    limpar();
  }
});

test('falha ao gravar o contador NAO propaga e e contada no processo', () => {
  const c = cenario();
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    const r = receberEvento(acervo, [descartavel('F1')], { agora: AGORA, configuracao: CFG_WHATSAPP });
    // Um ARQUIVO no lugar da pasta: criar o diretorio do contador falha com ENOTDIR.
    const bloqueio = join(raiz, 'bloqueio');
    writeFileSync(bloqueio, 'x');
    const avisos: string[] = [];
    const antes = falhasDeDescartes();
    registrarDescartes({ descartes: join(bloqueio, 'descartes.json') }, r, AGORA, (t) => avisos.push(t));
    assert.equal(falhasDeDescartes(), antes + 1);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]?.includes(SEGREDO), false);
    assert.equal(avisos[0]?.includes(bloqueio), false, 'o aviso carrega caminho');
  } finally {
    limpar();
    c.limpar();
  }
});

test('ouvinte estado --json traz a serie; a saida DEFAULT segue a de hoje', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const caminhos = caminhosDaConta(raiz, 'c');
    mkdirSync(join(raiz, 'ouvinte', 'c'), { recursive: true });
    marcarUltimoEvento(caminhos.ultimoEvento, AGORA);
    anotarDescartes(caminhos.descartes, { protocolMessage: 3 }, AGORA);

    const padrao: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c'], {
      dados: raiz, estado: raiz, escrever: (t: string) => padrao.push(t),
    });
    assert.deepEqual(padrao, ['2026-10-07T12:00:00.000Z']);

    const json: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], {
      dados: raiz, estado: raiz, escrever: (t: string) => json.push(t),
    });
    const lido = JSON.parse(json.join('')) as { descartes: unknown };
    assert.deepEqual(lido.descartes, { [DIA]: { protocolMessage: 3 } });
  } finally {
    limpar();
  }
});
