import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario, type Cenario } from './ajuda/acervo.js';
import { RemotoEmMemoria } from './ajuda/remoto-em-memoria.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import {
  PADROES_DO_DESTINO_REMOTO,
  configurarDestinoRemotoDeMidia,
  type DestinoRemotoDeMidia,
} from '../src/registro/destino-remoto.js';
import { listarAnexosPresentes } from '../src/nucleo/anexos-presentes.js';
import { descartarAnexo } from '../src/nucleo/escrita.js';
import { passadaDeApagarCopiaLocal, passadaDeEnvio, type DependenciasDoServico } from '../src/cli/servico-de-armazenamento.js';
import { entregarAnexo } from '../src/cli/entrega-de-anexo.js';

const DIA = 24 * 60 * 60 * 1000;
const OPCOES = { tamanhoMaximo: 1024 * 1024, prazoMs: 5_000 };

function montar(c: Cenario, mudar: Partial<DestinoRemotoDeMidia> = {}) {
  const { id, acervo, destino } = c.inquilinoComArquivos();
  configurarDestinoDeMidia(c.registro, id, { natureza: 'local', endereco: destino });
  configurarDestinoRemotoDeMidia(c.registro, id, { remoto: 'remoto_de_teste', ...PADROES_DO_DESTINO_REMOTO, ...mudar });
  const remoto = new RemotoEmMemoria();
  let leituras = 0;
  let base = Date.now() + 11 * 60 * 1000;
  const saidas: string[] = [];
  const dep: DependenciasDoServico = {
    dados: c.raiz,
    estado: c.raiz,
    remoto,
    agora: () => base + 1_000 * leituras++,
    dormir: () => Promise.resolve(),
    escrever: (linha) => saidas.push(linha),
  };
  const imagem = (): { id: string; caminho: string } => {
    const a = listarAnexosPresentes(acervo, { limite: 10 }).find((x) => x.tipo === 'image');
    assert.ok(a, 'o cenario tem uma imagem');
    return a;
  };
  return { id, acervo, destino, remoto, dep, saidas, imagem, avancar: (ms: number) => (base += ms) };
}

test('entrega os bytes de um Anexo enviado, inclusive depois de a copia local ter saido', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    const img = m.imagem();
    const original = readFileSync(join(m.destino, img.caminho));
    await passadaDeEnvio(m.dep, m.id);

    const antes = await entregarAnexo(m.dep, m.id, img.id, OPCOES);
    assert.equal(antes.tipo, 'bytes');
    assert.ok(antes.tipo === 'bytes' && antes.bytes.equals(original));

    m.avancar(8 * DIA);
    assert.equal((await passadaDeApagarCopiaLocal(m.dep, m.id)).apagadas, 3);
    const depois = await entregarAnexo(m.dep, m.id, img.id, OPCOES);
    assert.ok(depois.tipo === 'bytes' && depois.bytes.equals(original), 'o Anexo so no remoto continua entregue');
  } finally {
    c.limpar();
  }
});

test('Anexo que nao tem Localizacao, nao existe ou nao e deste Inquilino e "sem-localizacao": nunca chega ao remoto', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const img = m.imagem();
    assert.deepEqual(await entregarAnexo(m.dep, m.id, img.id, OPCOES), { tipo: 'sem-localizacao' }, 'nunca enviado');
    assert.deepEqual(await entregarAnexo(m.dep, m.id, 'anexo-que-nao-existe', OPCOES), { tipo: 'sem-localizacao' });
    assert.deepEqual(await entregarAnexo(m.dep, 'inquilino-que-nao-existe', img.id, OPCOES), { tipo: 'sem-localizacao' });
    assert.ok(!m.remoto.chamadas.includes('read'), 'nenhuma leitura no remoto');
  } finally {
    c.limpar();
  }
});

test('acima do tamanho maximo: sinal de tamanho, e o remoto nao e lido', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const img = m.imagem();
    await passadaDeEnvio(m.dep, m.id);
    const r = await entregarAnexo(m.dep, m.id, img.id, { ...OPCOES, tamanhoMaximo: 3 });
    assert.equal(r.tipo, 'grande-demais');
    assert.ok(r.tipo === 'grande-demais' && r.maximo === 3 && r.tamanho > 3);
    assert.ok(!m.remoto.chamadas.includes('read'));
  } finally {
    c.limpar();
  }
});

test('bytes que o remoto devolve sem conferir com a Impressao de Anexo nunca saem: e "inacessivel", nao "nao existe"', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const img = m.imagem();
    await passadaDeEnvio(m.dep, m.id);
    m.remoto.conteudoTrocado = Buffer.from('conteudo de outro arquivo');
    const r = await entregarAnexo(m.dep, m.id, img.id, OPCOES);
    assert.equal(r.tipo, 'inacessivel');
    // o mesmo tamanho, mas conteudo diferente: o hash e o que decide
    const original = readFileSync(join(m.destino, img.caminho));
    m.remoto.conteudoTrocado = Buffer.alloc(original.length, 1);
    assert.equal((await entregarAnexo(m.dep, m.id, img.id, OPCOES)).tipo, 'inacessivel');
    m.remoto.conteudoTrocado = undefined;
    assert.equal((await entregarAnexo(m.dep, m.id, img.id, OPCOES)).tipo, 'bytes');
  } finally {
    c.limpar();
  }
});

test('o remoto que perdeu o arquivo ou falhou na leitura e "inacessivel"', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const img = m.imagem();
    await passadaDeEnvio(m.dep, m.id);
    m.remoto.leiturasComErro = 1;
    assert.equal((await entregarAnexo(m.dep, m.id, img.id, OPCOES)).tipo, 'inacessivel');
    const caminhoNoRemoto = [...m.remoto.arquivos.keys()].find((k) => k.endsWith(img.caminho.split('/').slice(-2).join('')));
    assert.ok(caminhoNoRemoto);
    m.remoto.arquivos.delete(caminhoNoRemoto);
    const r = await entregarAnexo(m.dep, m.id, img.id, OPCOES);
    assert.ok(r.tipo === 'inacessivel' && /nao tem o arquivo/.test(r.motivo));
  } finally {
    c.limpar();
  }
});

test('Anexo que mudou depois do envio, ou Localizacao de outro remoto, nao se entrega', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const img = m.imagem();
    await passadaDeEnvio(m.dep, m.id);
    m.acervo.db.prepare('UPDATE anexos SET impressao = ? WHERE id = ?').run('a'.repeat(64), img.id);
    const mudou = await entregarAnexo(m.dep, m.id, img.id, OPCOES);
    assert.ok(mudou.tipo === 'inacessivel' && /mudou depois do envio/.test(mudou.motivo));
    m.acervo.db.prepare('UPDATE anexos SET impressao = ? WHERE id = ?').run(createHash('sha256').update(readFileSync(join(m.destino, img.caminho))).digest('hex'), img.id);
    assert.equal((await entregarAnexo(m.dep, m.id, img.id, OPCOES)).tipo, 'bytes', 'com a Impressao de volta, entrega');

    configurarDestinoRemotoDeMidia(c.registro, m.id, { remoto: 'outro_remoto', ...PADROES_DO_DESTINO_REMOTO });
    const outro = await entregarAnexo(m.dep, m.id, img.id, OPCOES);
    assert.ok(outro.tipo === 'inacessivel' && /outro remoto/.test(outro.motivo));
  } finally {
    c.limpar();
  }
});

test('Inquilino sem Destino Remoto declarado e "sem-localizacao", sem aviso no log', async () => {
  const c = cenario();
  try {
    const { id, destino } = c.inquilinoComArquivos();
    configurarDestinoDeMidia(c.registro, id, { natureza: 'local', endereco: destino });
    const saidas: string[] = [];
    const dep: DependenciasDoServico = {
      dados: c.raiz, estado: c.raiz, remoto: new RemotoEmMemoria(), agora: Date.now, dormir: () => Promise.resolve(), escrever: (l) => saidas.push(l),
    };
    assert.deepEqual(await entregarAnexo(dep, id, 'qualquer', OPCOES), { tipo: 'sem-localizacao' });
    assert.deepEqual(saidas, []);
  } finally {
    c.limpar();
  }
});

test('Anexo descartado pela retencao, que ainda tem Localizacao, nao se entrega: e "sem-localizacao"', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const img = m.imagem();
    await passadaDeEnvio(m.dep, m.id);
    assert.equal((await entregarAnexo(m.dep, m.id, img.id, OPCOES)).tipo, 'bytes', 'antes de descartar, entrega');
    descartarAnexo(m.acervo, img.id, { politica: 'teste', quando: Date.now() });
    const lidas = m.remoto.chamadas.filter((x) => x === 'read').length;
    assert.deepEqual(await entregarAnexo(m.dep, m.id, img.id, OPCOES), { tipo: 'sem-localizacao' });
    assert.equal(m.remoto.chamadas.filter((x) => x === 'read').length, lidas, 'o remoto nao foi lido');

    // So a Presenca: o Anexo volta a ter caminho mas nao esta `presente` (a guarda de Presenca e a unica a barra-lo).
    m.acervo.db.prepare("UPDATE anexos SET presenca = 'nunca-obtido', caminho = ? WHERE id = ?").run(img.caminho, img.id);
    assert.deepEqual(await entregarAnexo(m.dep, m.id, img.id, OPCOES), { tipo: 'sem-localizacao' });
    assert.equal(m.remoto.chamadas.filter((x) => x === 'read').length, lidas, 'o remoto nao foi lido');
  } finally {
    c.limpar();
  }
});
