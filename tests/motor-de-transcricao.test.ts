import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuracaoDoMotor } from '../src/cli/motor-de-transcricao.js';

test('configuracaoDoMotor devolve undefined sem as duas variaveis essenciais', () => {
  assert.equal(configuracaoDoMotor({}), undefined);
  assert.equal(configuracaoDoMotor({ MALOTE_WHISPER_BINARIO: '/x/whisper-cli' }), undefined);
});

test('configuracaoDoMotor resolve com defaults para ffmpeg, threads e idioma', () => {
  const config = configuracaoDoMotor({
    MALOTE_WHISPER_BINARIO: '/x/whisper-cli',
    MALOTE_WHISPER_MODELO: '/x/ggml-small.bin',
  });
  assert.deepEqual(config, {
    whisperBinario: '/x/whisper-cli',
    whisperModelo: '/x/ggml-small.bin',
    ffmpegBinario: 'ffmpeg',
    threads: 4,
    idioma: 'pt',
  });
});

test('configuracaoDoMotor honra MALOTE_FFMPEG_BINARIO, MALOTE_TRANSCRICAO_THREADS e MALOTE_TRANSCRICAO_IDIOMA', () => {
  const config = configuracaoDoMotor({
    MALOTE_WHISPER_BINARIO: '/x/whisper-cli',
    MALOTE_WHISPER_MODELO: '/x/ggml-small.bin',
    MALOTE_FFMPEG_BINARIO: '/usr/local/bin/ffmpeg',
    MALOTE_TRANSCRICAO_THREADS: '2',
    MALOTE_TRANSCRICAO_IDIOMA: 'en',
  });
  assert.equal(config?.ffmpegBinario, '/usr/local/bin/ffmpeg');
  assert.equal(config?.threads, 2);
  assert.equal(config?.idioma, 'en');
});
