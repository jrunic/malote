import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { processarUmaVez } from '../src/cli/transcricao.js';

function ambienteDeTeste() {
  const dados = mkdtempSync(join(tmpdir(), 'malote-worker-'));
  const registro = abrirRegistro(dados);
  const inquilinoId = criarInquilino(registro, { titularNome: 'Teste' });
  registro.fechar();
  const acervo = abrirAcervo(join(dados, 'acervos'), inquilinoId);
  return { dados, inquilinoId, acervo };
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
  const { dados, inquilinoId, acervo } = ambienteDeTeste();
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
  // ffmpeg de verdade recebe varios argumentos e o ULTIMO e o arquivo de
  // saida; pegar o ultimo posicional em sh puro, sem eval.
  writeFileSync(ffmpeg, '#!/bin/sh\nfor ultimo; do :; done\ntouch "$ultimo"\nexit 0\n');
  writeFileSync(whisper, '#!/bin/sh\necho "isto foi transcrito"\nexit 0\n');
  chmodSync(ffmpeg, 0o755);
  chmodSync(whisper, 0o755);
  return { whisperBinario: whisper, ffmpegBinario: ffmpeg, pasta };
}

test('processarUmaVez com motor falso conclui a Transcricao', async () => {
  const { dados, inquilinoId, acervo } = ambienteDeTeste();
  const motor = motorFalsoQueFunciona();
  try {
    const caminhoDoAudio = join(motor.pasta, 'a1.opus');
    writeFileSync(caminhoDoAudio, '');
    anexoDeAudio(acervo, caminhoDoAudio);
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
  }
});

test('processarUmaVez com whisper falso que falha grava falhou com o motivo', async () => {
  const { dados, inquilinoId, acervo } = ambienteDeTeste();
  const motor = motorFalsoQueFunciona();
  writeFileSync(motor.whisperBinario, '#!/bin/sh\necho "erro simulado" 1>&2\nexit 1\n');
  try {
    const caminhoDoAudio = join(motor.pasta, 'a1.opus');
    writeFileSync(caminhoDoAudio, '');
    anexoDeAudio(acervo, caminhoDoAudio);
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
  }
});

test('Acervo em forma diferente da corrente e PULADO, nunca migrado pelo worker', async () => {
  const { dados, inquilinoId, acervo } = ambienteDeTeste();
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
  }
});
