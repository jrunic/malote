import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { executar } from '../src/cli/index.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';

const AGORA = Date.parse('2026-10-18T12:00:00Z');
const IMAGEM = { mimetype: 'image/jpeg', mediaKey: 'AAECAwQFBgcICQoLDA0ODw==', directPath: '/v/t62/sintetico' };
const BRUTO = JSON.stringify({
  key: { remoteJid: 'x@s.whatsapp.net', id: 'E' },
  message: { templateMessage: { interactiveMessageTemplate: { body: { text: 'oferta' }, header: { imageMessage: IMAGEM } } } },
});

/** Instalacao com UM Inquilino e UMA Mensagem de modelo com imagem no cabecalho, sem Anexo. */
function instalacao(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '5565900000001@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP });
  registrarMensagem(acervo, { origemDaChegada: 'importacao', conversaId, fonte: 'whatsapp', idExterno: 'M1', ocorridaEm: Date.parse('2026-10-14T10:00:00Z'), agora: AGORA, direcao: 'recebida', bruto: BRUTO });
  acervo.fechar();
  return { raiz, inquilino, limpar };
}

const rodar = (raiz: string, args: string[]): { codigo: number; saida: string } => {
  const linhas: string[] = [];
  const codigo = executar(args, { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) });
  return { codigo, saida: linhas.join('\n') };
};

const anexosNoAcervo = (raiz: string, inquilino: string): number => {
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  try {
    return (acervo.db.prepare('SELECT COUNT(*) AS n FROM anexos').get() as { n: number }).n;
  } finally {
    acervo.fechar();
  }
};

test('CLI: sem --com-efeito e ensaio; com --com-efeito exige --confirmo; com os dois cria o Anexo', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const ensaio = rodar(raiz, ['midia', 'extrair-imagem-de-modelo', '--inquilino', inquilino]);
    assert.equal(ensaio.codigo, 0, ensaio.saida);
    assert.match(ensaio.saida, /Ensaio: 1 Mensagem\(ns\) de modelo com imagem, 1 Anexo\(s\) a criar/);
    assert.match(ensaio.saida, /Nada foi escrito/);
    assert.equal(anexosNoAcervo(raiz, inquilino), 0);

    const semConfirmo = rodar(raiz, ['midia', 'extrair-imagem-de-modelo', '--inquilino', inquilino, '--com-efeito']);
    assert.notEqual(semConfirmo.codigo, 0);
    assert.match(semConfirmo.saida, /--confirmo/);
    assert.equal(anexosNoAcervo(raiz, inquilino), 0);

    const grava = rodar(raiz, ['midia', 'extrair-imagem-de-modelo', '--inquilino', inquilino, '--com-efeito', '--confirmo', '--json']);
    assert.equal(grava.codigo, 0, grava.saida);
    assert.match(grava.saida, /"criados": 1/);
    assert.equal(grava.saida.includes('oferta'), false, 'o relatorio so conta, nunca traz o texto da Mensagem');
    assert.equal(grava.saida.includes('AAECAwQ'), false, 'nem a chave da midia');
    assert.equal(anexosNoAcervo(raiz, inquilino), 1);

    const denovo = rodar(raiz, ['midia', 'extrair-imagem-de-modelo', '--inquilino', inquilino, '--com-efeito', '--confirmo']);
    assert.equal(denovo.codigo, 0);
    assert.match(denovo.saida, /0 Anexo\(s\) criado\(s\)/);
    assert.equal(anexosNoAcervo(raiz, inquilino), 1);
  } finally {
    limpar();
  }
});

test('CLI: sem --inquilino e erro de uso', () => {
  const { raiz, limpar } = instalacao();
  try {
    const r = rodar(raiz, ['midia', 'extrair-imagem-de-modelo']);
    assert.notEqual(r.codigo, 0);
  } finally {
    limpar();
  }
});
