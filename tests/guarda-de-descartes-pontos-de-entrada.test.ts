// tests/guarda-de-descartes-pontos-de-entrada.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { derramar } from '../src/cli/derrame.js';
import { falhasDeDescartes, lerDescartes } from '../src/cli/descartes.js';
import type { MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';

const AGORA = Date.parse('2026-10-07T12:00:00Z');
const INSTANTE = Math.floor((AGORA - 60_000) / 1000);
const PASSADO = Math.floor(Date.parse('2026-09-08T12:00:00Z') / 1000);
const SEGREDO = 'TEXTO-SINTETICO-QUE-NAO-PODE-APARECER';

function evento(id: string, message: Record<string, unknown> | null, extra: Partial<MensagemRecebida> = {}, instante = INSTANTE): MensagemRecebida {
  return { key: { remoteJid: '5511000000000@s.whatsapp.net', id, fromMe: false }, messageTimestamp: instante, message, ...extra };
}
const descartavel = (id: string, instante = INSTANTE): MensagemRecebida =>
  evento(id, { protocolMessage: { type: 'REVOKE', texto: SEGREDO } }, {}, instante);
const comum = (id: string, instante = INSTANTE): MensagemRecebida => evento(id, { conversation: 'oi' }, {}, instante);
const cifrada = (id: string): MensagemRecebida => evento(id, null, { messageStubType: 'CIPHERTEXT' });

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
        // O logout e agendado ANTES, num `finally`: se a recepcao deixar a excecao escapar, o teste
        // cai limpo em vez de pendurar o processo (detectar por pendurar nao e detectar).
        try {
          ouvintes.get('messages.upsert')?.({ type: 'notify', messages: mensagens });
        } finally {
          setImmediate(() =>
            ouvintes.get('connection.update')?.({
              connection: 'close',
              lastDisconnect: { error: { output: { statusCode: 401 } } },
            }),
          );
        }
      });
    },
  } as unknown as { disparar: () => void };
}

async function ouvirComLote(mensagens: unknown[], antes?: (c: ReturnType<typeof caminhosDaConta>) => void) {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Padme' });
  resolverConfiguracao(registro, id, 'whatsapp', 'teste');
  registro.fechar();
  const caminhos = caminhosDaConta(raiz, 'viva');
  mkdirSync(caminhos.vinculo, { recursive: true });
  writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
  abrirAcervo(join(raiz, 'acervos'), id).fechar();
  antes?.(caminhos);
  const biblioteca = bibliotecaQueEntrega(mensagens);
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
  return { raiz, id, caminhos, linhas, codigo, limpar };
}

const idsGuardados = (caminho: string): string[] =>
  readFileSync(caminho, 'utf8').split('\n').filter((l) => l !== '').map((l) => (JSON.parse(l) as { evento: MensagemRecebida }).evento.key.id);

test('a RECEPCAO guarda o descartado e nao o ruido, e CONTA os dois', async () => {
  const r = await ouvirComLote([descartavel('D1'), cifrada('C1'), comum('M1')]);
  try {
    assert.equal(r.codigo, 1, r.linhas.join(' | '));
    assert.deepEqual(idsGuardados(r.caminhos.guarda), ['D1']);
    assert.deepEqual(lerDescartes(r.caminhos.descartes), { '2026-10-07': { 'protocolMessage:REVOKE': 1, cifrada: 1 } });
    assert.match(r.linhas.join('\n'), /descartes guardados: 1/);
    assert.equal(r.linhas.join('\n').includes(SEGREDO), false, 'o conteudo vazou para a saida');
  } finally {
    r.limpar();
  }
});

test('a DRENAGEM, chamada pela recepcao, guarda o que o lote derramado descartou', async () => {
  const r = await ouvirComLote([comum('M1')], (caminhos) => {
    mkdirSync(join(caminhos.derrame, '..'), { recursive: true });
    derramar(caminhos.derrame, [descartavel('DRENADO1')]);
  });
  try {
    assert.equal(r.codigo, 1, r.linhas.join(' | '));
    assert.deepEqual(idsGuardados(r.caminhos.guarda), ['DRENADO1']);
  } finally {
    r.limpar();
  }
});

test('o reprocessar do DERRAME guarda o que o lote descartou', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Cassian' });
    resolverConfiguracao(registro, id, 'whatsapp', 'principal');
    registro.fechar();
    const caminhos = caminhosDaConta(raiz, 'principal');
    derramar(caminhos.derrame, [descartavel('RD1', PASSADO), comum('RD2', PASSADO)]);
    const linhas: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false },
    );
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.deepEqual(idsGuardados(caminhos.guarda), ['RD1']);
  } finally {
    limpar();
  }
});

test('subir o ouvinte sem evento NAO cria o contador nem a guarda (criterio 14)', async () => {
  const r = await ouvirComLote([]);
  try {
    assert.equal(r.codigo, 1, r.linhas.join(' | '));
    assert.equal(existsSync(r.caminhos.descartes), false);
    assert.equal(existsSync(r.caminhos.guarda), false);
  } finally {
    r.limpar();
  }
});

// O prazo e o PISO, nao a deteccao. A asserção que detecta e `codigo === 1`: se a excecao da
// guarda propagar, `ouvir` rejeita e o teste cai. O prazo existe porque a biblioteca falsa engole a
// excecao no `setImmediate`, nunca dispara o logout e a suite inteira penduraria.
test('falha ao gravar a GUARDA nao perde a Mensagem e nao derruba o ouvinte', { timeout: 10_000 }, async () => {
  const antes = falhasDeDescartes();
  // Um DIRETORIO no lugar do arquivo: o append falha com EISDIR.
  const r = await ouvirComLote([descartavel('D1'), comum('M1')], (caminhos) => {
    mkdirSync(caminhos.guarda, { recursive: true });
  });
  try {
    assert.equal(r.codigo, 1, r.linhas.join(' | '));
    assert.ok(falhasDeDescartes() > antes, 'a falha nao foi contada');
    assert.match(r.linhas.join('\n'), /falha ao gravar a guarda/);
    // O contador, independente, anotou mesmo assim.
    assert.deepEqual(lerDescartes(r.caminhos.descartes), { '2026-10-07': { 'protocolMessage:REVOKE': 1 } });
    // So o AVISO da falha nao pode carregar caminho (as linhas de partida do ouvinte citam a raiz).
    const avisos = r.linhas.filter((l) => l.includes('falha ao gravar'));
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0]?.includes(r.raiz), false, 'o aviso carrega caminho');
    // A Mensagem do mesmo lote entrou no Acervo.
    const acervo = abrirAcervoSomenteLeitura(join(r.raiz, 'acervos'), r.id);
    try {
      const n = acervo.preparar('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
      assert.equal(n.n, 1);
    } finally {
      acervo.fechar();
    }
  } finally {
    r.limpar();
  }
});

test('ouvinte estado --json traz o que esta guardado; a saida DEFAULT nao muda', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const caminhos = caminhosDaConta(raiz, 'c');
    mkdirSync(join(raiz, 'ouvinte', 'c'), { recursive: true });
    writeFileSync(caminhos.ultimoEvento, '2026-10-07T12:00:00.000Z\n');
    writeFileSync(caminhos.guarda, `${JSON.stringify({ evento: descartavel('G1') })}\n${JSON.stringify({ evento: descartavel('G2') })}\n`);

    const padrao: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c'], { dados: raiz, estado: raiz, escrever: (t: string) => padrao.push(t) });
    assert.deepEqual(padrao, ['2026-10-07T12:00:00.000Z']);

    const json: string[] = [];
    executar(['ouvinte', 'estado', '--conta', 'c', '--json'], { dados: raiz, estado: raiz, escrever: (t: string) => json.push(t) });
    const lido = JSON.parse(json.join('')) as { guarda: { eventos: number; bytes: number } };
    assert.equal(lido.guarda.eventos, 2);
    assert.ok(lido.guarda.bytes > 0);
  } finally {
    limpar();
  }
});
