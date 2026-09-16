import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import {
  gravarArquivoDeAnexo,
  gravarArquivoDeAnexoDeCaminho,
} from '../src/nucleo/arquivo-de-anexo.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const AGORA = Date.UTC(2026, 8, 4);

function dadosDoAnexo(acervo: Acervo, anexoId: string) {
  return acervo.db
    .prepare('SELECT presenca, caminho, tamanho, impressao FROM anexos WHERE id = ?')
    .get(anexoId) as {
    presenca: string;
    caminho: string;
    tamanho: number;
    impressao: string;
  };
}

test('gravar por caminho produz o mesmo tamanho e a mesma impressao que gravar por bytes', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const conteudo = Buffer.from('conteudo sintetico, o mesmo pelos dois caminhos');
    const origem = join(mkdtempSync(join(tmpdir(), 'malote-origem-')), 'arquivo.bin');
    writeFileSync(origem, conteudo);

    const porBytes = c.registrarAnexo(acervo, { tipo: 'image', ocorridaEm: AGORA });
    const porCaminho = c.registrarAnexo(acervo, { tipo: 'image', ocorridaEm: AGORA });

    gravarArquivoDeAnexo(acervo, { anexoId: porBytes, destino, bytes: conteudo });
    const r = gravarArquivoDeAnexoDeCaminho(acervo, { anexoId: porCaminho, destino, origem });

    const a = dadosDoAnexo(acervo, porBytes);
    const b = dadosDoAnexo(acervo, porCaminho);
    // Compara o que o ACERVO gravou, nao o caminho: sao dois Anexos, entao o
    // caminho difere de proposito. O que tem de bater e tamanho e impressao.
    assert.equal(b.tamanho, a.tamanho);
    assert.equal(b.impressao, a.impressao);
    assert.equal(b.presenca, 'presente');
    assert.ok(r.modo === 'vinculo' || r.modo === 'copia');
  } finally {
    c.limpar();
  }
});

test('vinculo rigido: a origem continua legivel e o arquivo e o MESMO inode', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const conteudo = Buffer.from('bytes que precisam sobreviver na origem');
    const origem = join(mkdtempSync(join(tmpdir(), 'malote-origem-')), 'arquivo.bin');
    writeFileSync(origem, conteudo);

    const anexoId = c.registrarAnexo(acervo, { tipo: 'image', ocorridaEm: AGORA });
    const r = gravarArquivoDeAnexoDeCaminho(acervo, { anexoId, destino, origem });

    assert.equal(r.modo, 'vinculo', 'caiu para copia no mesmo sistema de arquivos');
    // A origem PERMANECE: e o que sustenta "o Acervo antigo permanece intacto
    // ate aceite explicito".
    assert.deepEqual(readFileSync(origem), conteudo);
    // Mesmo inode e a prova DIRETA de que nao houve copia. Medir espaco livre
    // depois de gravar e medida indireta, que oscila com qualquer outra coisa
    // rodando na maquina.
    assert.equal(statSync(join(destino, r.caminho)).ino, statSync(origem).ino);
  } finally {
    c.limpar();
  }
});

test('sistema de arquivos diferente: cai para copia, e a origem continua intacta', (t) => {
  // A queda para copia so pode ser exercitada com DOIS sistemas de arquivos de
  // verdade. Simular a falha de `linkSync` mediria o mock, nao o produto.
  // Quem tiver um segundo sistema montado aponta a variavel; sem ela, o teste
  // se declara PULADO com a razao dita — nunca passa em silencio.
  const outro = process.env['MALOTE_TESTE_OUTRO_FS'];
  if (outro === undefined) {
    t.skip('defina MALOTE_TESTE_OUTRO_FS com um caminho em outro sistema de arquivos');
    return;
  }

  const c = cenario();
  try {
    const destino = join(outro, `destino-${process.pid}`);
    mkdirSync(destino, { recursive: true });
    const { acervo } = c.novoInquilino('Titular de Teste');
    const conteudo = Buffer.from('bytes que atravessam sistema de arquivos');
    const origem = join(mkdtempSync(join(tmpdir(), 'malote-origem-')), 'arquivo.bin');
    writeFileSync(origem, conteudo);

    const anexoId = c.registrarAnexo(acervo, { tipo: 'image', ocorridaEm: AGORA });
    const r = gravarArquivoDeAnexoDeCaminho(acervo, { anexoId, destino, origem });

    assert.equal(r.modo, 'copia', 'vinculou atraves de sistemas de arquivos diferentes');
    const gravado = join(destino, r.caminho);
    assert.deepEqual(readFileSync(gravado), conteudo);
    assert.notEqual(statSync(gravado).ino, statSync(origem).ino, 'e o mesmo inode: nao copiou');
    assert.deepEqual(readFileSync(origem), conteudo);
    assert.equal(dadosDoAnexo(acervo, anexoId).presenca, 'presente');
  } finally {
    c.limpar();
  }
});
