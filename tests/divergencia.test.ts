import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { trazerArquivos } from '../src/adaptadores/whatsapp/trazer.js';
import { conferirDisco } from '../src/nucleo/relatorio-de-acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

function comUmArquivo() {
  return backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: null,
        tipo: 1,
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
        caminhoDeMidia: 'Media/a/1/x.jpg',
        conteudoDeMidia: 'abcde',
      },
    ],
  });
}

test('sem divergência, os dois lados vêm zerados', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  const b = comUmArquivo();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    trazerArquivos(acervo, b.raiz, { destino: d.raiz });

    const r = conferirDisco(acervo, d.raiz);
    assert.equal(r.conferiu, true);
    assert.equal(r.presentesSemArquivo.length, 0);
    assert.equal(r.arquivosSemAnexo.length, 0);
    assert.equal(r.tamanhoDivergente.length, 0);
  } finally {
    b.limpar();
    d.limpar();
    c.limpar();
  }
});

test('arquivo apagado por fora aparece como Anexo presente sem arquivo', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  const b = comUmArquivo();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    trazerArquivos(acervo, b.raiz, { destino: d.raiz });

    const { caminho } = acervo.db
      .prepare('SELECT caminho FROM anexos WHERE caminho IS NOT NULL')
      .get() as { caminho: string };
    rmSync(join(d.raiz, caminho));

    const r = conferirDisco(acervo, d.raiz);
    assert.equal(r.conferiu, true);
    assert.equal(r.presentesSemArquivo.length, 1, 'o banco diz presente e o disco não tem');
    assert.equal(r.arquivosSemAnexo.length, 0);
  } finally {
    b.limpar();
    d.limpar();
    c.limpar();
  }
});

test('arquivo que nenhum Anexo reivindica aparece no outro sentido', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  const b = comUmArquivo();
  try {
    const leia = c.novoInquilino('Leia Organa');
    // SEGUNDO Inquilino na MESMA raiz de Destino — que o schema permite. Sem
    // ele, varrer a raiz ou a subarvore da o mesmo resultado, e a mutacao que
    // troca uma pela outra passaria verde.
    const han = c.novoInquilino('Han Solo');
    importarMaterial(leia.acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    importarMaterial(han.acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    trazerArquivos(leia.acervo, b.raiz, { destino: d.raiz });
    trazerArquivos(han.acervo, b.raiz, { destino: d.raiz });

    // Orfao: dentro da subarvore de LEIA, sem Anexo que o aponte.
    const orfao = join(d.raiz, leia.id, 'image', 'ff', 'ff');
    mkdirSync(orfao, { recursive: true });
    writeFileSync(join(orfao, `${'deadbeef'.repeat(4)}.jpg`), 'sobra');

    const r = conferirDisco(leia.acervo, d.raiz);
    assert.equal(r.presentesSemArquivo.length, 0);
    assert.equal(
      r.arquivosSemAnexo.length,
      1,
      'só o órfão de Leia — os arquivos de Han estão na mesma raiz e NÃO contam',
    );
  } finally {
    b.limpar();
    d.limpar();
    c.limpar();
  }
});

test('tamanho diferente do gravado é divergência, e não ausência', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  const b = comUmArquivo();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    trazerArquivos(acervo, b.raiz, { destino: d.raiz });

    const { caminho } = acervo.db
      .prepare('SELECT caminho FROM anexos WHERE caminho IS NOT NULL')
      .get() as { caminho: string };
    writeFileSync(join(d.raiz, caminho), 'conteudo bem maior que o original');

    const r = conferirDisco(acervo, d.raiz);
    assert.equal(r.presentesSemArquivo.length, 0, 'o arquivo existe');
    assert.equal(r.tamanhoDivergente.length, 1, 'só o tamanho não bate');
  } finally {
    b.limpar();
    d.limpar();
    c.limpar();
  }
});

test('Destino inacessível declara que não conferiu, em vez de contar tudo como perdido', () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  const b = comUmArquivo();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    trazerArquivos(acervo, b.raiz, { destino: d.raiz });

    const r = conferirDisco(acervo, '/caminho/que/nao/existe/em/lugar/nenhum');
    assert.equal(r.conferiu, false, 'o relatório precisa DIZER que não pôde conferir');
    assert.equal(
      r.presentesSemArquivo.length,
      0,
      'Destino desmontado NÃO pode contar todo Anexo como ausente do disco: ' +
        'seria falha de montagem lida como perda de acervo',
    );
  } finally {
    b.limpar();
    d.limpar();
    c.limpar();
  }
});
