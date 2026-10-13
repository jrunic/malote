import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { executar } from '../src/cli/index.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const ANA = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Souza\nTEL;waid=5565999991234:+55 65 99999-1234\nEND:VCARD';

/** Instalacao com UM Inquilino e uma Mensagem do backup cujo cartao ainda nao foi extraido. */
function instalacao(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '5565900000001@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
  const mensagemId = registrarMensagem(acervo, {
    conversaId,
    fonte: 'whatsapp',
    idExterno: 'b1',
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z'),
    agora: AGORA,
    direcao: 'recebida',
    bruto: '{}',
  });
  registrarAnexo(acervo, {
    mensagemId,
    tipo: 'contact',
    presenca: 'nunca-obtido',
    bruto: JSON.stringify({ ZVCARDSTRING: ANA, ZVCARDNAME: '' }),
  });
  acervo.fechar();
  return { raiz, inquilino, limpar };
}

const rodar = (raiz: string, args: string[]): { codigo: number; saida: string } => {
  const linhas: string[] = [];
  const codigo = executar(args, { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) });
  return { codigo, saida: linhas.join('\n') };
};

test('CLI: sem --com-efeito e ensaio; com --com-efeito exige --confirmo; com os dois grava', () => {
  const { raiz, inquilino, limpar } = instalacao();
  try {
    const ensaio = rodar(raiz, ['contato-compartilhado', 'extrair', '--inquilino', inquilino]);
    assert.equal(ensaio.codigo, 0, ensaio.saida);
    assert.match(ensaio.saida, /Ensaio/);
    assert.match(ensaio.saida, /Nada foi escrito/);

    const semConfirmo = rodar(raiz, ['contato-compartilhado', 'extrair', '--inquilino', inquilino, '--com-efeito']);
    assert.notEqual(semConfirmo.codigo, 0);
    assert.match(semConfirmo.saida, /--confirmo/);

    const grava = rodar(raiz, ['contato-compartilhado', 'extrair', '--inquilino', inquilino, '--com-efeito', '--confirmo', '--json']);
    assert.equal(grava.codigo, 0, grava.saida);
    assert.match(grava.saida, /"criados": 1/);
    assert.equal(grava.saida.includes('Ana Souza'), false, 'o relatorio so conta, nunca traz o texto do cartao');
  } finally {
    limpar();
  }
});

test('CLI: sem --inquilino e erro de uso', () => {
  const { raiz, limpar } = instalacao();
  try {
    const r = rodar(raiz, ['contato-compartilhado', 'extrair']);
    assert.notEqual(r.codigo, 0);
  } finally {
    limpar();
  }
});
