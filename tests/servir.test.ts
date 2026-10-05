import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { emitirChaveDeAcesso } from '../src/registro/chave-de-acesso.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { pedirGet } from '../src/cli/cliente.js';
import { servir } from '../src/cli/servir.js';
import { criarServidor } from '../src/rede/servidor.js';
import { cenario } from './ajuda/acervo.js';
import { semearIdentidade } from './ajuda/identidade.js';

/** Espera POR EVENTO, com teto: o aquecimento do worker de leitura fica entre o `criar` e o `listen` (#1132). */
async function esperarPor(condicao: () => boolean, ms = 10_000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicao() && Date.now() < limite) await new Promise((r) => setTimeout(r, 25));
}

test('servir sobe e desliga o worker de transcricao junto do SIGTERM', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-servir-'));
  try {
    let iniciado = 0;
    let parado = 0;
    const iniciarFalso = () => {
      iniciado += 1;
      return () => {
        parado += 1;
      };
    };

    const promessa = servir(['--porta', '0'], {
      dados,
      estado: dados,
      escrever: () => {},
      iniciarWorker: iniciarFalso,
    });

    await esperarPor(() => iniciado === 1); // o listener subiu e o worker de transcricao foi iniciado
    assert.equal(iniciado, 1);
    process.emit('SIGTERM');
    await promessa;
    assert.equal(parado, 1);
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('servir NAO anuncia "somente leitura": nomeia as duas rotas de escrita', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-servir-'));
  try {
    const linhas: string[] = [];
    const promessa = servir(['--porta', '0'], {
      dados,
      estado: dados,
      escrever: (l) => linhas.push(l),
      iniciarWorker: () => () => {},
    });
    await esperarPor(() => linhas.some((l) => l.startsWith('[transcricao]')));
    process.emit('SIGTERM');
    await promessa;

    const saida = linhas.join('\n');
    assert.doesNotMatch(saida, /somente leitura/i, 'o anuncio mente: ha duas rotas de escrita');
    assert.match(saida, /\/transcricoes\/solicitar/);
    assert.match(saida, /\/envios\/solicitar/);
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

function motorFalsoQueDorme(segundos: number): { whisperBinario: string; ffmpegBinario: string; pasta: string } {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-motor-falso-servir-'));
  const ffmpeg = join(pasta, 'ffmpeg-falso.sh');
  const whisper = join(pasta, 'whisper-falso.sh');
  writeFileSync(ffmpeg, '#!/bin/sh\nfor ultimo; do :; done\ntouch "$ultimo"\nexit 0\n');
  writeFileSync(whisper, `#!/bin/sh\nsleep ${segundos}\necho "texto"\nexit 0\n`);
  chmodSync(ffmpeg, 0o755);
  chmodSync(whisper, 0o755);
  return { whisperBinario: whisper, ffmpegBinario: ffmpeg, pasta };
}

test('requisicao HTTP responde normalmente enquanto uma transcricao esta em andamento', async () => {
  // Medido DESTA linha, e nao so da chamada fetch: se transcrever() bloquear
  // o event loop de verdade (execFileSync em vez de execFile), o bloqueio
  // acontece DENTRO do proprio setTimeout(300) mais abaixo — o processo e
  // de UMA thread, e o `Date.now()` que abrisse depois do bloqueio nunca o
  // veria. So o tempo de parede do teste INTEIRO denuncia isso.
  const inicioTotal = Date.now();
  const dados = mkdtempSync(join(tmpdir(), 'malote-servir-concorrencia-'));
  const motor = motorFalsoQueDorme(2);
  const envAntes = {
    MALOTE_WHISPER_BINARIO: process.env['MALOTE_WHISPER_BINARIO'],
    MALOTE_WHISPER_MODELO: process.env['MALOTE_WHISPER_MODELO'],
    MALOTE_FFMPEG_BINARIO: process.env['MALOTE_FFMPEG_BINARIO'],
    MALOTE_TRANSCRICAO_INTERVALO_MS: process.env['MALOTE_TRANSCRICAO_INTERVALO_MS'],
  };
  try {
    const registro = abrirRegistro(dados);
    const inquilinoId = criarInquilino(registro, { titularNome: 'Teste' });
    const chave = emitirChaveDeAcesso(registro, inquilinoId);
    registro.fechar();

    const acervo = abrirAcervo(join(dados, 'acervos'), inquilinoId);
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '111@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const mensagemId = registrarMensagem(acervo, {
      direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: Date.parse('2026-09-01T12:00:00Z'), agora: Date.now(),
    });
    const caminhoDoAudio = join(motor.pasta, 'a1.opus');
    writeFileSync(caminhoDoAudio, '');
    registrarAnexo(acervo, { mensagemId, tipo: 'audio', presenca: 'presente', caminho: caminhoDoAudio });
    acervo.fechar();

    process.env['MALOTE_WHISPER_BINARIO'] = motor.whisperBinario;
    process.env['MALOTE_WHISPER_MODELO'] = '/x/modelo.bin';
    process.env['MALOTE_FFMPEG_BINARIO'] = motor.ffmpegBinario;
    process.env['MALOTE_TRANSCRICAO_INTERVALO_MS'] = '100'; // dispara rapido, para o teste nao esperar 30s

    const linhas: string[] = [];
    const promessaDoServir = servir(['--porta', '0'], { dados, estado: dados, escrever: (l) => linhas.push(l) });
    // Espera o suficiente para o listener subir E o worker pegar o elegivel
    // (intervalo de 100ms) e entrar no sleep de 2s do whisper falso.
    await esperarPor(() => linhas.some((l) => l.startsWith('Servindo em ')));
    await new Promise((r) => setTimeout(r, 300));

    const linhaDoEndereco = linhas.find((l) => l.startsWith('Servindo em '));
    assert.ok(linhaDoEndereco !== undefined, 'servidor nao anunciou o endereco');
    const porta = linhaDoEndereco!.match(/:(\d+)$/)?.[1];
    assert.ok(porta !== undefined, 'nao achei a porta na linha anunciada');

    const inicioDaChamada = Date.now();
    const resposta = await pedirGet(`http://127.0.0.1:${porta}`, chave.valor, '/conversas');
    const duracaoDaChamada = Date.now() - inicioDaChamada;
    assert.equal(resposta.status, 200);
    assert.ok(
      duracaoDaChamada < 1000,
      `esperava resposta rapida, levou ${duracaoDaChamada}ms — event loop bloqueado?`,
    );
    // A prova real: o teste INTEIRO (que inclui a espera de 300ms antes da
    // chamada) tem de terminar bem antes do sleep de 2s do whisper falso.
    // Se transcrever() bloqueasse o event loop, o Date.now() usado no
    // duracaoDaChamada so passaria a contar DEPOIS do bloqueio ja ter
    // acontecido, e o assert acima passaria mesmo com o processo travado.
    const duracaoTotal = Date.now() - inicioTotal;
    assert.ok(
      duracaoTotal < 1500,
      `teste inteiro levou ${duracaoTotal}ms — deveria ser bem menor que os 2000ms do sleep do whisper falso`,
    );

    process.emit('SIGTERM');
    await promessaDoServir;
  } finally {
    process.env['MALOTE_WHISPER_BINARIO'] = envAntes.MALOTE_WHISPER_BINARIO;
    process.env['MALOTE_WHISPER_MODELO'] = envAntes.MALOTE_WHISPER_MODELO;
    process.env['MALOTE_FFMPEG_BINARIO'] = envAntes.MALOTE_FFMPEG_BINARIO;
    process.env['MALOTE_TRANSCRICAO_INTERVALO_MS'] = envAntes.MALOTE_TRANSCRICAO_INTERVALO_MS;
    rmSync(dados, { recursive: true, force: true });
    rmSync(motor.pasta, { recursive: true, force: true });
  }
});

test('servir recusa --trabalhadores e --prazo fora da faixa (#1132)', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-servir-'));
  try {
    for (const args of [['--trabalhadores', '0'], ['--trabalhadores', '17'], ['--trabalhadores', 'x'], ['--prazo', '0'], ['--prazo', '301'], ['--prazo', 'x']]) {
      const linhas: string[] = [];
      const codigo = await servir(['--porta', '0', ...args], { dados, estado: dados, escrever: (l) => linhas.push(l), iniciarWorker: () => () => {} });
      assert.equal(codigo, 2, args.join(' '));
      assert.match(linhas.join('\n'), /--trabalhadores|--prazo/);
    }
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('servir RECUSA subir (codigo 1) se o worker de leitura nao carrega (#1132)', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-servir-'));
  try {
    const linhas: string[] = [];
    const codigo = await servir(['--porta', '0'], {
      dados,
      estado: dados,
      escrever: (l) => linhas.push(l),
      iniciarWorker: () => () => {},
      criar: (o) => criarServidor({ ...o, arquivoDoTrabalhador: new URL('file:///nao/existe/trabalhador.ts') }),
    });
    assert.equal(codigo, 1);
    assert.match(linhas.join('\n'), /worker de leitura/);
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('servir abre o Registro uma vez ao subir, antes de aceitar requisicao (#1132)', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-servir-'));
  try {
    const linhas: string[] = [];
    const promessa = servir(['--porta', '0'], { dados, estado: dados, escrever: (l) => linhas.push(l), iniciarWorker: () => () => {} });
    await esperarPor(() => existsSync(join(dados, 'registro.db')));
    assert.ok(existsSync(join(dados, 'registro.db')), 'o Registro existe (e migrado) antes de qualquer requisicao');
    await esperarPor(() => linhas.some((l) => l.startsWith('Servindo em '))); // o SIGTERM so e tratado depois da subida
    process.emit('SIGTERM');
    await promessa;
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});

test('PARADA GRACIOSA: a leitura que cabe nos 5 s de espera termina e responde 200 antes de o servidor parar (#1132)', async () => {
  const c = cenario();
  const { id, acervo } = c.novoInquilino('A');
  semearIdentidade(acervo);
  acervo.fechar();
  const chave = emitirChaveDeAcesso(c.registro, id).valor;
  try {
    const linhas: string[] = [];
    const promessa = servir(['--porta', '0', '--prazo', '30'], {
      dados: c.raiz,
      estado: c.raiz,
      escrever: (l) => linhas.push(l),
      iniciarWorker: () => () => {},
      criar: (o) => criarServidor({ ...o, ganchoDeTeste: { instrucaoDoTrabalhador: () => ({ dormirMs: 1500 }) } }),
    });
    await esperarPor(() => /http:\/\/[\d.]+:\d+/.test(linhas.join('\n')));
    const porta = Number(/http:\/\/[\d.]+:(\d+)/.exec(linhas.join('\n'))![1]);
    const leitura = fetch(`http://127.0.0.1:${porta}/relatorio`, { headers: { authorization: `Bearer ${chave}` } }).then(
      (r) => r.status,
      () => 'cortada',
    );
    await new Promise((r) => setTimeout(r, 400));
    process.emit('SIGTERM');
    assert.equal(await promessa, 0);
    // Sem a espera (`pararLeituras`), `closeAllConnections` cortaria a leitura no meio e o cliente veria a conexao cair.
    assert.equal(await leitura, 200);
  } finally {
    c.limpar();
  }
});

test('PARADA: SIGTERM com uma leitura lenta em andamento termina em ate 6 s, mesmo com a thread principal livre (#1132)', async () => {
  const c = cenario();
  const { id, acervo } = c.novoInquilino('A');
  semearIdentidade(acervo);
  acervo.fechar();
  const chave = emitirChaveDeAcesso(c.registro, id).valor;
  try {
    const linhas: string[] = [];
    const promessa = servir(['--porta', '0', '--prazo', '30'], {
      dados: c.raiz,
      estado: c.raiz,
      escrever: (l) => linhas.push(l),
      iniciarWorker: () => () => {},
      criar: (o) => criarServidor({ ...o, ganchoDeTeste: { instrucaoDoTrabalhador: () => ({ dormirMs: 20_000 }) } }),
    });
    // O aquecimento do worker fica entre o `criar` e o `listen`: espera POR EVENTO (a linha de subida), com teto.
    await esperarPor(() => /http:\/\/[\d.]+:\d+/.test(linhas.join('\n')));
    const porta = Number(/http:\/\/[\d.]+:(\d+)/.exec(linhas.join('\n'))![1]);
    void fetch(`http://127.0.0.1:${porta}/relatorio`, { headers: { authorization: `Bearer ${chave}` } }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
    const t0 = Date.now();
    process.emit('SIGTERM');
    assert.equal(await promessa, 0);
    // 5.000 ms de espera das leituras em andamento, mais o terminate e o closeAllConnections: 7.000 ms de teto (o
    // criterio de produto e 6 s, com folga de CI Linux); sem a parada em etapas, seriam 20 s de leitura lenta.
    assert.ok(Date.now() - t0 < 7000, `parou em ${Date.now() - t0} ms`);
  } finally {
    c.limpar();
  }
});
