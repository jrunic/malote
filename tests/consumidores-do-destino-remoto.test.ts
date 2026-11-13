import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { instalacaoComChave, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { conferirDisco } from '../src/nucleo/relatorio-de-acervo.js';
import { aplicarRetencao } from '../src/nucleo/retencao.js';
import { listarAnexosPresentes } from '../src/nucleo/anexos-presentes.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { abrirLocalizacao, caminhoDaLocalizacao, marcarCopiaLocalRemovida, registrarFalhaDeEnvio, registrarLocalizacao } from '../src/registro/localizacao.js';
import { descartarAnexo, registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { linhasDaOperacao, listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { gravarArquivoDeAnexo } from '../src/nucleo/arquivo-de-anexo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('a conferencia de disco nao acusa como perda o Anexo que so esta no remoto', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const [a, b] = listarAnexosPresentes(acervo, { limite: 10 });
    assert.ok(a && b);
    rmSync(join(destino, a.caminho));
    rmSync(join(destino, b.caminho));

    const semLocalizacao = conferirDisco(acervo, destino);
    assert.equal(semLocalizacao.presentesSemArquivo.length, 2);
    assert.deepEqual(semLocalizacao.soNoRemoto, []);

    const comLocalizacao = conferirDisco(acervo, destino, { comLocalizacao: new Set([a.id]) });
    assert.deepEqual(comLocalizacao.soNoRemoto, [a.caminho]);
    assert.deepEqual(comLocalizacao.presentesSemArquivo, [b.caminho], 'o outro continua acusado: nada diz que esta no remoto');
  } finally {
    c.limpar();
  }
});

test('a retencao so conta como liberado o que saiu do disco, e trata o arquivo ja ausente por so estar no remoto', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const videos = listarAnexosPresentes(acervo, { limite: 10 }).filter((a) => a.tipo === 'video');
    assert.equal(videos.length, 2);
    const [semCopia, comCopia] = videos as [(typeof videos)[number], (typeof videos)[number]];
    rmSync(join(destino, semCopia.caminho)); // a copia local ja tinha saido

    const r = aplicarRetencao(acervo, { politica: { tipos: ['video'] }, destino, agora: Date.now(), comEfeito: true });
    assert.equal(r.descartados, 2);
    assert.equal(r.semArquivoLocal, 1);
    assert.equal(r.falhas, 0);
    assert.equal(r.bytesLiberados, comCopia.tamanho, 'so o arquivo que existia no disco libera bytes');
    assert.ok(!existsSync(join(destino, comCopia.caminho)));
  } finally {
    c.limpar();
  }
});

/** Um Inquilino com um Anexo `presente`, a copia local ja removida e a Localizacao dizendo que esta no remoto. */
function instalacaoComAnexoSoNoRemoto() {
  const { raiz, limpar } = instalacaoTemporaria();
  const { inquilino, chave } = instalacaoComChave(raiz);
  const destino = join(raiz, 'midia-local');
  mkdirSync(destino, { recursive: true });
  configurarDestinoDeMidia(abrirRegistro(raiz), inquilino, { natureza: 'local', endereco: destino });
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  let caminho: string;
  try {
    const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'c@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP });
    const mensagemId = registrarMensagem(acervo, {
      origemDaChegada: 'importacao', direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: Date.parse('2026-09-01T12:00:00Z'), agora: Date.now(),
    });
    const anexoId = registrarAnexo(acervo, { origemDaChegada: 'importacao', mensagemId, tipo: 'image', presenca: 'nunca-obtido' });
    gravarArquivoDeAnexo(acervo, { origemDaChegada: 'importacao', anexoId, destino, bytes: Buffer.from('bytes do anexo') });
    const a = listarAnexosPresentes(acervo, { limite: 10 })[0] as { id: string; caminho: string; tamanho: number | null; impressao: string | null };
    caminho = a.caminho;
    const base = abrirLocalizacao(raiz, inquilino);
    try {
      registrarLocalizacao(base, {
        anexoId: a.id, remoto: 'remoto_de_teste', caminhoRemoto: 'x/y.jpg', idNoRemoto: null,
        tamanho: a.tamanho ?? 0, hash: a.impressao ?? 'h', verificadaEm: new Date().toISOString(),
      });
      marcarCopiaLocalRemovida(base, a.id, new Date().toISOString());
    } finally {
      base.fechar();
    }
    rmSync(join(destino, a.caminho));
  } finally {
    acervo.fechar();
  }
  return { raiz, limpar, inquilino, chave, caminho };
}

test('acervo recriar recusa um Inquilino com Localizacao, e so com --descartar-localizacao a descarta junto', () => {
  const i = instalacaoComAnexoSoNoRemoto();
  try {
    const recusa = rodar(i.raiz, ['acervo', 'recriar', '--inquilino', i.inquilino, '--chave', i.chave, '--confirmo']);
    assert.notEqual(recusa.codigo, 0);
    assert.match(recusa.saida, /Localizacao/);
    assert.match(recusa.saida, /--descartar-localizacao/);
    assert.ok(existsSync(join(i.raiz, 'acervos', `${i.inquilino}.db`)), 'o Acervo ficou');
    assert.ok(existsSync(caminhoDaLocalizacao(i.raiz, i.inquilino)), 'a Localizacao ficou');

    const ok = rodar(i.raiz, ['acervo', 'recriar', '--inquilino', i.inquilino, '--chave', i.chave, '--confirmo', '--descartar-localizacao']);
    assert.equal(ok.codigo, 0, ok.saida);
    assert.match(ok.saida, /Localizacao.*descartada/);
    assert.ok(!existsSync(join(i.raiz, 'acervos', `${i.inquilino}.db`)));
    assert.ok(!existsSync(caminhoDaLocalizacao(i.raiz, i.inquilino)));
  } finally {
    i.limpar();
  }
});

test('acervo recriar sem Localizacao segue como antes, e recusa com o Servico no ar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave } = instalacaoComChave(raiz);
    assert.equal(rodar(raiz, ['acervo', 'recriar', '--inquilino', inquilino, '--chave', chave, '--confirmo']).codigo, 0);
  } finally {
    limpar();
  }
  const i = instalacaoComAnexoSoNoRemoto();
  try {
    mkdirSync(join(i.raiz, 'armazenamento'), { recursive: true });
    writeFileSync(join(i.raiz, 'armazenamento', 'servico.pid'), String(process.pid));
    const r = rodar(i.raiz, ['acervo', 'recriar', '--inquilino', i.inquilino, '--chave', i.chave, '--confirmo', '--descartar-localizacao']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /Servico de Armazenamento esta no ar/);
    assert.ok(existsSync(caminhoDaLocalizacao(i.raiz, i.inquilino)));
  } finally {
    i.limpar();
  }
});

test('operador espaco separa o que esta em disco do que so existe no remoto; acervo relatar nao acusa perda', () => {
  const i = instalacaoComAnexoSoNoRemoto();
  try {
    const espaco = rodar(i.raiz, ['operador', 'espaco', '--chave', i.chave]);
    assert.equal(espaco.codigo, 0, espaco.saida);
    assert.match(espaco.saida, /0 bytes em disco/);
    assert.match(espaco.saida, /14 bytes so no remoto/);

    const relatorio = rodar(i.raiz, ['acervo', 'relatar', '--inquilino', i.inquilino]);
    assert.equal(relatorio.codigo, 0, relatorio.saida);
    assert.match(relatorio.saida, /Divergencia: 0 presentes sem arquivo/);
    assert.match(relatorio.saida, /1 presentes sem arquivo local, mas com Localizacao/);
    assert.match(relatorio.saida, /14 desses bytes ja so existem no Destino Remoto/);
  } finally {
    i.limpar();
  }
});

test('acervo recriar --descartar-localizacao deixa a trilha: a Operacao diz que a Localizacao existiu e quantos Anexos ela mapeava', () => {
  const i = instalacaoComAnexoSoNoRemoto();
  try {
    const ok = rodar(i.raiz, ['acervo', 'recriar', '--inquilino', i.inquilino, '--chave', i.chave, '--confirmo', '--descartar-localizacao']);
    assert.equal(ok.codigo, 0, ok.saida);
    const registro = abrirRegistro(i.raiz);
    try {
      const op = listarOperacoesCruas(registro).find((o) => o.natureza === 'recriar-acervo');
      assert.ok(op);
      const descartada = linhasDaOperacao(registro, op.id).find((l) => l.tabela === 'localizacoes');
      assert.equal(descartada?.campo, 'descartada');
      assert.equal(descartada?.antes, '1 Anexos com Localizacao');
    } finally {
      registro.fechar();
    }
  } finally {
    i.limpar();
  }
});

test('acervo recriar descarta tambem a base da Localizacao que nao tem envios (so falhas), sem pedir a bandeira', () => {
  const i = instalacaoComAnexoSoNoRemoto();
  try {
    // Uma base sem Localizacao nenhuma, so com uma falha de envio: aponta para um Anexo que o recriar apaga.
    const base = abrirLocalizacao(i.raiz, i.inquilino);
    try {
      base.db.prepare('DELETE FROM localizacoes').run();
      registrarFalhaDeEnvio(base, 'anexo-qualquer', 'falhou', new Date().toISOString());
    } finally {
      base.fechar();
    }
    const ok = rodar(i.raiz, ['acervo', 'recriar', '--inquilino', i.inquilino, '--chave', i.chave, '--confirmo']);
    assert.equal(ok.codigo, 0, ok.saida);
    assert.ok(!existsSync(caminhoDaLocalizacao(i.raiz, i.inquilino)), 'a base sem envios tambem foi descartada');
  } finally {
    i.limpar();
  }
});

test('operador espaco nao subtrai do "em disco" a Localizacao de Anexo que a retencao ja descartou', () => {
  const i = instalacaoComAnexoSoNoRemoto();
  try {
    const acervo = abrirAcervo(join(i.raiz, 'acervos'), i.inquilino);
    try {
      const a = listarAnexosPresentes(acervo, { limite: 10 })[0] as { id: string };
      descartarAnexo(acervo, a.id, { politica: 'teste', quando: Date.now() });
    } finally {
      acervo.fechar();
    }
    const espaco = rodar(i.raiz, ['operador', 'espaco', '--chave', i.chave]);
    assert.equal(espaco.codigo, 0, espaco.saida);
    assert.doesNotMatch(espaco.saida, /so no remoto/, 'o descartado nao conta como "so no remoto"');
    assert.doesNotMatch(espaco.saida, /-\d+ bytes em disco/);
  } finally {
    i.limpar();
  }
});
