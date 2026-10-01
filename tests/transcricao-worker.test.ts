import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { processarUmaVez } from '../src/cli/transcricao.js';

/**
 * Configura tambem o Destino de Midia do Inquilino, como toda instalacao
 * real tem — sem ele, `caminho` (sempre RELATIVO, #1106) nunca resolve.
 */
function ambienteDeTeste(opcoes: { semDestino?: boolean } = {}) {
  const dados = mkdtempSync(join(tmpdir(), 'malote-worker-'));
  const destinoDir = mkdtempSync(join(tmpdir(), 'malote-destino-'));
  const registro = abrirRegistro(dados);
  const inquilinoId = criarInquilino(registro, { titularNome: 'Teste' });
  if (opcoes.semDestino !== true) {
    configurarDestinoDeMidia(registro, inquilinoId, { natureza: 'local', endereco: destinoDir });
  }
  registro.fechar();
  const acervo = abrirAcervo(join(dados, 'acervos'), inquilinoId);
  return { dados, destinoDir, inquilinoId, acervo };
}

/** Grava o arquivo de audio RELATIVO ao Destino de Midia e registra o Anexo com esse caminho. */
function arquivoDeAudio(destinoDir: string, caminhoRelativo: string, conteudo = ''): void {
  mkdirSync(join(destinoDir, ...caminhoRelativo.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(join(destinoDir, caminhoRelativo), conteudo);
}

function anexoDeAudio(acervo: import('../src/nucleo/acervo.js').Acervo, caminho: string): string {
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '111@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
  const mensagemId = registrarMensagem(acervo, {
    direcao: 'recebida',
    conversaId,
    fonte: 'whatsapp',
    idExterno: 'm1',
    ocorridaEm: Date.parse('2026-09-01T12:00:00Z'),
    agora: Date.now(),
  });
  return registrarAnexo(acervo, { mensagemId, tipo: 'audio', presenca: 'presente', caminho });
}

test('processarUmaVez sem configuracao do motor nao toca o Acervo', async () => {
  const { dados, destinoDir, inquilinoId, acervo } = ambienteDeTeste();
  try {
    anexoDeAudio(acervo, '/x/a1.opus');
    acervo.fechar();

    const resultado = await processarUmaVez({ dados, env: {}, escrever: () => {} });
    assert.equal(resultado.motorConfigurado, false);
    assert.equal(resultado.processados, 0);

    const depois = abrirAcervo(join(dados, 'acervos'), inquilinoId);
    const linha = depois.db.prepare('SELECT COUNT(*) AS n FROM transcricoes').get() as { n: number };
    assert.equal(linha.n, 0);
    depois.fechar();
  } finally {
    rmSync(dados, { recursive: true, force: true });
    rmSync(destinoDir, { recursive: true, force: true });
  }
});

/**
 * O motor real (whisper.cpp) nao roda no CI — cobrimos a ORQUESTRACAO (spawn,
 * parse de saida, grava no banco) com um par ffmpeg/whisper FALSO: dois
 * scripts de shell executaveis apontados pelas variaveis de ambiente.
 */
function motorFalsoQueFunciona(): { whisperBinario: string; ffmpegBinario: string; pasta: string } {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-motor-falso-'));
  const ffmpeg = join(pasta, 'ffmpeg-falso.sh');
  const whisper = join(pasta, 'whisper-falso.sh');
  // ffmpeg de verdade recebe varios argumentos; o da entrada vem logo depois
  // de "-i", e o ULTIMO e o arquivo de saida. Resolve os dois em sh puro, sem
  // eval. Confere que a ENTRADA existe — como o ffmpeg real faz — senao o
  // mutante "nao junta o Destino de Midia" (#1106) nunca seria pego: sem essa
  // checagem, o fake aceita qualquer caminho, relativo ou nao.
  writeFileSync(
    ffmpeg,
    '#!/bin/sh\nentrada=""\nanterior=""\nfor arg; do\n  if [ "$anterior" = "-i" ]; then entrada="$arg"; fi\n  anterior="$arg"\ndone\nif [ ! -f "$entrada" ]; then\n  echo "Error opening input: No such file or directory" 1>&2\n  exit 1\nfi\nfor ultimo; do :; done\ntouch "$ultimo"\nexit 0\n',
  );
  writeFileSync(whisper, '#!/bin/sh\necho "isto foi transcrito"\nexit 0\n');
  chmodSync(ffmpeg, 0o755);
  chmodSync(whisper, 0o755);
  return { whisperBinario: whisper, ffmpegBinario: ffmpeg, pasta };
}

test('processarUmaVez com motor falso conclui a Transcricao', async () => {
  const { dados, destinoDir, inquilinoId, acervo } = ambienteDeTeste();
  const motor = motorFalsoQueFunciona();
  try {
    const caminhoRelativo = 'audio/0e/65/a1.opus';
    arquivoDeAudio(destinoDir, caminhoRelativo);
    anexoDeAudio(acervo, caminhoRelativo);
    acervo.fechar();

    const resultado = await processarUmaVez({
      dados,
      env: {
        MALOTE_WHISPER_BINARIO: motor.whisperBinario,
        MALOTE_WHISPER_MODELO: '/x/modelo.bin',
        MALOTE_FFMPEG_BINARIO: motor.ffmpegBinario,
      },
      escrever: () => {},
    });
    assert.equal(resultado.processados, 1);

    const depois = abrirAcervo(join(dados, 'acervos'), inquilinoId);
    const linha = depois.db
      .prepare('SELECT estado, texto FROM transcricoes WHERE anexo_id IS NOT NULL')
      .get() as { estado: string; texto: string };
    assert.equal(linha.estado, 'concluida');
    assert.equal(linha.texto, 'isto foi transcrito');
    depois.fechar();
  } finally {
    rmSync(dados, { recursive: true, force: true });
    rmSync(motor.pasta, { recursive: true, force: true });
    rmSync(destinoDir, { recursive: true, force: true });
  }
});

test('processarUmaVez com whisper falso que falha grava falhou com o motivo', async () => {
  const { dados, destinoDir, inquilinoId, acervo } = ambienteDeTeste();
  const motor = motorFalsoQueFunciona();
  writeFileSync(motor.whisperBinario, '#!/bin/sh\necho "erro simulado" 1>&2\nexit 1\n');
  try {
    const caminhoRelativo = 'audio/0e/65/a1.opus';
    arquivoDeAudio(destinoDir, caminhoRelativo);
    anexoDeAudio(acervo, caminhoRelativo);
    acervo.fechar();

    await processarUmaVez({
      dados,
      env: {
        MALOTE_WHISPER_BINARIO: motor.whisperBinario,
        MALOTE_WHISPER_MODELO: '/x/modelo.bin',
        MALOTE_FFMPEG_BINARIO: motor.ffmpegBinario,
      },
      escrever: () => {},
    });

    const depois = abrirAcervo(join(dados, 'acervos'), inquilinoId);
    const linha = depois.db
      .prepare('SELECT estado, motivo_falha AS motivoFalha FROM transcricoes WHERE anexo_id IS NOT NULL')
      .get() as { estado: string; motivoFalha: string };
    assert.equal(linha.estado, 'falhou');
    assert.match(linha.motivoFalha, /whisper\.cpp falhou/);
    depois.fechar();
  } finally {
    rmSync(dados, { recursive: true, force: true });
    rmSync(motor.pasta, { recursive: true, force: true });
    rmSync(destinoDir, { recursive: true, force: true });
  }
});

/**
 * Reproducao do #1106: o Anexo grava `caminho` RELATIVO ao Destino de
 * Midia (como `escrita.ts` sempre gravou — o Destino e configuracao por
 * Inquilino, nunca entra no Acervo), e o processo do worker roda de um
 * diretorio DIFERENTE do Destino — o caso normal em producao, onde
 * `malote servir` roda do checkout, nao do Destino de Midia. Sem juntar
 * `destino.endereco` + `caminho` antes de chamar o motor, o ffmpeg recebe
 * um caminho relativo que nao resolve a partir do cwd do processo e falha
 * com "No such file or directory" mesmo com o arquivo presente no disco.
 */
test('processarUmaVez resolve o caminho do Anexo contra o Destino de Midia do Inquilino', async () => {
  const { dados, destinoDir, inquilinoId, acervo } = ambienteDeTeste();
  const motor = motorFalsoQueFunciona();
  try {
    // Caminho RELATIVO, no mesmo formato que `escrita.ts` grava de verdade.
    const caminhoRelativo = join(inquilinoId, 'audio', '0e', '65', 'a1.opus');
    arquivoDeAudio(destinoDir, caminhoRelativo);

    anexoDeAudio(acervo, caminhoRelativo);
    acervo.fechar();

    await processarUmaVez({
      dados,
      env: {
        MALOTE_WHISPER_BINARIO: motor.whisperBinario,
        MALOTE_WHISPER_MODELO: '/x/modelo.bin',
        MALOTE_FFMPEG_BINARIO: motor.ffmpegBinario,
      },
      escrever: () => {},
    });

    const depois = abrirAcervo(join(dados, 'acervos'), inquilinoId);
    const linha = depois.db
      .prepare('SELECT estado, texto, motivo_falha AS motivoFalha FROM transcricoes WHERE anexo_id IS NOT NULL')
      .get() as { estado: string; texto: string | null; motivoFalha: string | null };
    assert.equal(linha.estado, 'concluida', `esperava concluida, veio '${linha.estado}' (${linha.motivoFalha})`);
    assert.equal(linha.texto, 'isto foi transcrito');
    depois.fechar();
  } finally {
    rmSync(dados, { recursive: true, force: true });
    rmSync(motor.pasta, { recursive: true, force: true });
    rmSync(destinoDir, { recursive: true, force: true });
  }
});

test('Inquilino sem Destino de Midia configurado e PULADO, sem marcar nada pendente', async () => {
  const { dados, destinoDir, inquilinoId, acervo } = ambienteDeTeste({ semDestino: true });
  const motor = motorFalsoQueFunciona();
  try {
    // O arquivo existe num lugar qualquer — se a guarda falhar e o worker
    // tentar mesmo assim, o caminho relativo cru nunca vai resolver contra
    // esse diretorio, então qualquer sucesso aqui seria falso-positivo.
    anexoDeAudio(acervo, 'audio/0e/65/a1.opus');
    acervo.fechar();

    const linhas: string[] = [];
    const resultado = await processarUmaVez({
      dados,
      env: {
        MALOTE_WHISPER_BINARIO: motor.whisperBinario,
        MALOTE_WHISPER_MODELO: '/x/modelo.bin',
        MALOTE_FFMPEG_BINARIO: motor.ffmpegBinario,
      },
      escrever: (l) => linhas.push(l),
    });
    assert.equal(resultado.processados, 0);
    assert.ok(linhas.some((l) => l.includes('Destino de Midia nao configurado')));

    const depois = abrirAcervo(join(dados, 'acervos'), inquilinoId);
    const linha = depois.db.prepare('SELECT COUNT(*) AS n FROM transcricoes').get() as { n: number };
    assert.equal(linha.n, 0, 'sem Destino, o Anexo nem deveria ser marcado pendente');
    depois.fechar();
  } finally {
    rmSync(dados, { recursive: true, force: true });
    rmSync(motor.pasta, { recursive: true, force: true });
    rmSync(destinoDir, { recursive: true, force: true });
  }
});

test('Acervo em forma diferente da corrente e PULADO, nunca migrado pelo worker', async () => {
  const { dados, destinoDir, inquilinoId, acervo } = ambienteDeTeste();
  const motor = motorFalsoQueFunciona();
  try {
    const versaoAntes = acervo.versaoDoSchema();
    acervo.fechar();
    // Forca a forma gravada para uma versao anterior, direto no arquivo —
    // sem passar por abrirAcervo, que migraria.
    const dbCru = new Database(join(dados, 'acervos', `${inquilinoId}.db`));
    dbCru.prepare('UPDATE versao_schema SET versao = ?').run(versaoAntes - 1);
    dbCru.close();

    const linhas: string[] = [];
    const resultado = await processarUmaVez({
      dados,
      env: {
        MALOTE_WHISPER_BINARIO: motor.whisperBinario,
        MALOTE_WHISPER_MODELO: '/x/modelo.bin',
        MALOTE_FFMPEG_BINARIO: motor.ffmpegBinario,
      },
      escrever: (l) => linhas.push(l),
    });
    assert.equal(resultado.processados, 0);
    assert.ok(linhas.some((l) => l.includes('Pulado')));

    // A forma no disco continua a anterior — o worker NAO migrou.
    const dbConfirma = new Database(join(dados, 'acervos', `${inquilinoId}.db`), { readonly: true });
    const linha = dbConfirma.prepare('SELECT versao FROM versao_schema').get() as { versao: number };
    assert.equal(linha.versao, versaoAntes - 1);
    dbConfirma.close();
  } finally {
    rmSync(dados, { recursive: true, force: true });
    rmSync(motor.pasta, { recursive: true, force: true });
    rmSync(destinoDir, { recursive: true, force: true });
  }
});
