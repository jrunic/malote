import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import { PADROES_DO_DESTINO_REMOTO, configurarDestinoRemotoDeMidia } from '../src/registro/destino-remoto.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { processarUmaVez } from '../src/cli/transcricao.js';
import type { BuscadorDeMidiaRemota, ResultadoDaBusca } from '../src/nucleo/midia-remota.js';

/** O ffmpeg falso guarda o conteudo da entrada em `entrada.txt`: prova de ONDE o audio foi lido. */
function motorFalso(): { env: Record<string, string>; pasta: string; entradaVista: () => string | undefined } {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-motor-remoto-'));
  const ffmpeg = join(pasta, 'ffmpeg-falso.sh');
  const whisper = join(pasta, 'whisper-falso.sh');
  writeFileSync(
    ffmpeg,
    `#!/bin/sh\nentrada=""\nanterior=""\nfor arg; do\n  if [ "$anterior" = "-i" ]; then entrada="$arg"; fi\n  anterior="$arg"\ndone\n[ -f "$entrada" ] || exit 1\ncat "$entrada" > "${pasta}/entrada.txt"\nfor ultimo; do :; done\ntouch "$ultimo"\nexit 0\n`,
  );
  writeFileSync(whisper, '#!/bin/sh\necho "isto foi transcrito"\nexit 0\n');
  chmodSync(ffmpeg, 0o755);
  chmodSync(whisper, 0o755);
  const arquivo = join(pasta, 'entrada.txt');
  return {
    pasta,
    env: { MALOTE_WHISPER_BINARIO: whisper, MALOTE_WHISPER_MODELO: '/x/modelo.bin', MALOTE_FFMPEG_BINARIO: ffmpeg },
    entradaVista: () => (existsSync(arquivo) ? readFileSync(arquivo, 'utf8') : undefined),
  };
}

function ambiente(remoto: boolean) {
  const dados = mkdtempSync(join(tmpdir(), 'malote-worker-remoto-'));
  const destinoDir = mkdtempSync(join(tmpdir(), 'malote-destino-remoto-'));
  const registro = abrirRegistro(dados);
  const inquilinoId = criarInquilino(registro, { titularNome: 'Teste' });
  configurarDestinoDeMidia(registro, inquilinoId, { natureza: 'local', endereco: destinoDir });
  if (remoto) configurarDestinoRemotoDeMidia(registro, inquilinoId, { remoto: 'remoto_de_teste', ...PADROES_DO_DESTINO_REMOTO });
  registro.fechar();
  const acervo = abrirAcervo(join(dados, 'acervos'), inquilinoId);
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp', idExterno: '111@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
  });
  let n = 0;
  /** Um audio; `local` grava a copia local com este conteudo, `undefined` deixa so o remoto. */
  const audio = (local: string | undefined): { id: string; caminho: string } => {
    n += 1;
    const caminho = `audio/0${n}/0${n}/a${n}.opus`;
    if (local !== undefined) {
      mkdirSync(join(destinoDir, 'audio', `0${n}`, `0${n}`), { recursive: true });
      writeFileSync(join(destinoDir, caminho), local);
    }
    const mensagemId = registrarMensagem(acervo, {
      origemDaChegada: 'importacao', direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: `m${n}`,
      ocorridaEm: Date.parse('2026-09-01T12:00:00Z'), agora: Date.now(),
    });
    const id = registrarAnexo(acervo, { origemDaChegada: 'importacao', mensagemId, tipo: 'audio', presenca: 'presente', caminho });
    return { id, caminho };
  };
  const estado = (id: string): { estado: string; motivo_falha: string | null } | undefined => {
    const leitor = abrirAcervo(join(dados, 'acervos'), inquilinoId);
    try {
      return leitor.db.prepare('SELECT estado, motivo_falha FROM transcricoes WHERE anexo_id = ?').get(id) as never;
    } finally {
      leitor.fechar();
    }
  };
  return { dados, destinoDir, inquilinoId, acervo, audio, estado };
}

const buscadorQue = (resultado: ResultadoDaBusca, pedidos: string[] = []): BuscadorDeMidiaRemota => (p) => {
  pedidos.push(p.anexoId);
  return Promise.resolve(resultado);
};

function limpar(...pastas: string[]): void {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
}

test('audio so no remoto: o worker le pelo Servico, transcreve e remove a entrega temporaria', async () => {
  const a = ambiente(true);
  const m = motorFalso();
  try {
    const x = a.audio(undefined);
    a.acervo.fechar();
    const antes = readdirSync(tmpdir()).filter((n) => n.startsWith('malote-transcricao-entrega-'));
    const r = await processarUmaVez({
      dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscadorQue({ tipo: 'bytes', bytes: Buffer.from('audio do remoto') }),
    });
    assert.equal(r.processados, 1);
    assert.equal(a.estado(x.id)?.estado, 'concluida');
    assert.equal(m.entradaVista(), 'audio do remoto');
    const depois = readdirSync(tmpdir()).filter((n) => n.startsWith('malote-transcricao-entrega-'));
    assert.deepEqual(depois, antes, 'a pasta temporaria saiu');
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }
});

test('Escolha 2 (b): com Localizacao le pelo Servico mesmo havendo copia local; sem Localizacao le a copia local', async () => {
  const a = ambiente(true);
  const m = motorFalso();
  try {
    const x = a.audio('copia local');
    a.acervo.fechar();
    await processarUmaVez({
      dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscadorQue({ tipo: 'bytes', bytes: Buffer.from('do remoto') }),
    });
    assert.equal(m.entradaVista(), 'do remoto');
    assert.equal(a.estado(x.id)?.estado, 'concluida');
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }
  const b = ambiente(true);
  const n = motorFalso();
  try {
    b.audio('copia local de audio ainda nao enviado');
    b.acervo.fechar();
    await processarUmaVez({ dados: b.dados, env: n.env, escrever: () => {}, buscarMidiaRemota: buscadorQue({ tipo: 'sem-localizacao' }) });
    assert.equal(n.entradaVista(), 'copia local de audio ainda nao enviado');
  } finally {
    limpar(b.dados, b.destinoDir, n.pasta);
  }
});

test('Inquilino sem Destino Remoto: o Servico nem e consultado', async () => {
  const a = ambiente(false);
  const m = motorFalso();
  const pedidos: string[] = [];
  try {
    a.audio('local');
    a.acervo.fechar();
    const r = await processarUmaVez({
      dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscadorQue({ tipo: 'bytes', bytes: Buffer.from('x') }, pedidos),
    });
    assert.equal(r.processados, 1);
    assert.deepEqual(pedidos, []);
    assert.equal(m.entradaVista(), 'local');
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }
});

test('Servico fora do ar: com copia local usa a local; sem ela NAO e falha — fica pendente e volta depois do adiamento', async () => {
  const a = ambiente(true);
  const m = motorFalso();
  const pedidos: string[] = [];
  const adiados = new Map<string, number>();
  let agora = 1_000_000;
  const linhas: string[] = [];
  try {
    const com = a.audio('copia local');
    a.acervo.fechar();
    await processarUmaVez({
      dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscadorQue({ tipo: 'servico-fora' }), adiados, agora: () => agora,
    });
    assert.equal(a.estado(com.id)?.estado, 'concluida', 'com copia local, o Servico fora nao derruba a transcricao');
    assert.equal(m.entradaVista(), 'copia local');
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }

  const b = ambiente(true);
  const n = motorFalso();
  try {
    const so = b.audio(undefined);
    b.acervo.fechar();
    const fora: BuscadorDeMidiaRemota = (p) => {
      pedidos.push(p.anexoId);
      return Promise.resolve({ tipo: 'servico-fora' });
    };
    const r1 = await processarUmaVez({ dados: b.dados, env: n.env, escrever: (l) => linhas.push(l), buscarMidiaRemota: fora, adiados, agora: () => agora });
    assert.equal(r1.processados, 0);
    assert.equal(b.estado(so.id)?.estado, 'pendente', 'nao virou falha terminal');
    assert.equal(pedidos.length, 1);

    agora += 60_000;
    await processarUmaVez({ dados: b.dados, env: n.env, escrever: () => {}, buscarMidiaRemota: fora, adiados, agora: () => agora });
    assert.equal(pedidos.length, 1, 'dentro do adiamento nao se tenta de novo');

    agora += 10 * 60_000;
    const volta = await processarUmaVez({
      dados: b.dados, env: n.env, escrever: () => {}, buscarMidiaRemota: buscadorQue({ tipo: 'bytes', bytes: Buffer.from('voltou') }), adiados, agora: () => agora,
    });
    assert.equal(volta.processados, 1);
    assert.equal(b.estado(so.id)?.estado, 'concluida');
    assert.match(linhas.join('\n'), /nao entregou o audio/);
  } finally {
    limpar(b.dados, b.destinoDir, n.pasta);
  }
});

test('o audio que o Servico nao entrega nao trava os outros da fila', async () => {
  const a = ambiente(true);
  const m = motorFalso();
  try {
    const preso = a.audio(undefined);
    const livre = a.audio('copia local do que nao foi enviado');
    a.acervo.fechar();
    const porAnexo: BuscadorDeMidiaRemota = (p) =>
      Promise.resolve(p.anexoId === preso.id ? { tipo: 'servico-fora' } : { tipo: 'sem-localizacao' });
    // A ordem da fila e por identificador (aleatorio): o preso pode vir antes ou depois. Em qualquer ordem, a passada
    // transcreve o livre, e a seguinte tenta o preso, adia e o deixa pendente.
    const adiados = new Map<string, number>();
    const r1 = await processarUmaVez({ dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: porAnexo, adiados });
    assert.equal(r1.processados, 1);
    assert.equal(a.estado(livre.id)?.estado, 'concluida');
    const r2 = await processarUmaVez({ dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: porAnexo, adiados });
    assert.equal(r2.processados, 0);
    assert.equal(a.estado(preso.id)?.estado, 'pendente');
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }
});

test('audio acima do tamanho maximo da entrega: falha terminal com o motivo', async () => {
  const a = ambiente(true);
  const m = motorFalso();
  try {
    const x = a.audio(undefined);
    a.acervo.fechar();
    await processarUmaVez({
      dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscadorQue({ tipo: 'grande-demais', tamanho: 99, maximo: 50 }),
    });
    const e = a.estado(x.id);
    assert.equal(e?.estado, 'falhou');
    assert.match(e?.motivo_falha ?? '', /acima do tamanho maximo/);
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }
});

test('Servico fora do ar com uma fila longa so no remoto: o audio com copia local e transcrito na mesma passada, e o Servico e perguntado uma vez', async () => {
  const a = ambiente(true);
  const m = motorFalso();
  const pedidos: string[] = [];
  try {
    for (let i = 0; i < 40; i += 1) a.audio(undefined);
    const local = a.audio('copia local do audio recem-chegado');
    a.acervo.fechar();
    const r = await processarUmaVez({
      dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscadorQue({ tipo: 'servico-fora' }, pedidos), adiados: new Map(),
    });
    assert.equal(r.processados, 1);
    assert.equal(a.estado(local.id)?.estado, 'concluida');
    assert.equal(m.entradaVista(), 'copia local do audio recem-chegado');
    assert.equal(pedidos.length, 1, 'depois do primeiro "fora", a passada nao pergunta de novo a cada audio da fila');
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }
});

test('o Servico que declara o audio inacessivel de forma permanente: depois de 3 tentativas vira falha com o motivo', async () => {
  const a = ambiente(true);
  const m = motorFalso();
  const adiados = new Map<string, number>();
  const tentativas = new Map<string, number>();
  let agora = 5_000_000;
  const buscar: BuscadorDeMidiaRemota = () => Promise.resolve({ tipo: 'inacessivel', motivo: 'o remoto nao tem o arquivo' });
  try {
    const x = a.audio(undefined);
    a.acervo.fechar();
    for (let passada = 1; passada <= 2; passada += 1) {
      const r = await processarUmaVez({ dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscar, adiados, tentativas, agora: () => agora });
      assert.equal(r.processados, 0, `passada ${passada}: ainda pendente`);
      assert.equal(a.estado(x.id)?.estado, 'pendente');
      agora += 6 * 60_000;
    }
    const ultima = await processarUmaVez({ dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscar, adiados, tentativas, agora: () => agora });
    assert.equal(ultima.processados, 1);
    const e = a.estado(x.id);
    assert.equal(e?.estado, 'falhou');
    assert.match(e?.motivo_falha ?? '', /nao entrega o audio.*o remoto nao tem o arquivo/);
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }
});

test('Servico ocupado: o audio so no remoto espera 1 minuto, sem marcar o Servico como fora do ar, e depois e transcrito', async () => {
  const a = ambiente(true);
  const m = motorFalso();
  const adiados = new Map<string, number>();
  let agora = 9_000_000;
  const pedidos: string[] = [];
  const respostas: ResultadoDaBusca[] = [{ tipo: 'ocupado' }, { tipo: 'bytes', bytes: Buffer.from('agora foi') }];
  const buscar: BuscadorDeMidiaRemota = (p) => {
    pedidos.push(p.anexoId);
    return Promise.resolve(respostas.shift() as ResultadoDaBusca);
  };
  try {
    const x = a.audio(undefined);
    a.acervo.fechar();
    const base = { dados: a.dados, env: m.env, escrever: () => {}, buscarMidiaRemota: buscar, adiados, agora: () => agora };
    assert.equal((await processarUmaVez(base)).processados, 0);
    assert.equal(a.estado(x.id)?.estado, 'pendente');
    assert.ok(![...adiados.keys()].some((k) => k.startsWith('servico-fora:')), 'ocupado nao e "fora do ar"');
    agora += 30_000;
    assert.equal((await processarUmaVez({ ...base, agora: () => agora })).processados, 0);
    assert.equal(pedidos.length, 1, 'dentro do minuto nao se pergunta de novo');
    agora += 40_000;
    assert.equal((await processarUmaVez({ ...base, agora: () => agora })).processados, 1);
    assert.equal(a.estado(x.id)?.estado, 'concluida');
  } finally {
    limpar(a.dados, a.destinoDir, m.pasta);
  }
});
