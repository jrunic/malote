import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar } from '../src/cli/index.js';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-06-05T12:00:00Z');

function ambienteDeTeste(raiz: string, linhas: string[]) {
  return {
    dados: raiz,
    estado: raiz,
    escrever: (t: string) => linhas.push(t),
  };
}

test('malote mensagens sem --conversa lista atraves de todas as Conversas', () => {
  const c = cenario();
  try {
    const { id: inquilino, acervo } = c.novoInquilino('Padme');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'a@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: AGORA, agora: AGORA, direcao: 'recebida', conteudo: 'oi',
    });
    acervo.fechar();

    const linhas: string[] = [];
    const codigo = executar(
      ['mensagens', '--inquilino', inquilino, '--json'],
      ambienteDeTeste(c.raiz, linhas),
    );
    assert.equal(codigo, 0);
    const saida = JSON.parse(linhas.join('\n')) as { conversaId: string }[];
    assert.equal(saida.length, 1);
    assert.equal(saida[0]?.conversaId, conversaId);
  } finally {
    c.limpar();
  }
});

test('malote mensagens --direcao recebida filtra sem --conversa', () => {
  const c = cenario();
  try {
    const { id: inquilino, acervo } = c.novoInquilino('Padme');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'a@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'm-enviada',
      ocorridaEm: AGORA, agora: AGORA, direcao: 'enviada',
    });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'm-recebida',
      ocorridaEm: AGORA + 1000, agora: AGORA + 1000, direcao: 'recebida',
    });
    acervo.fechar();

    const linhas: string[] = [];
    executar(
      ['mensagens', '--inquilino', inquilino, '--direcao', 'recebida', '--json'],
      ambienteDeTeste(c.raiz, linhas),
    );
    const saida = JSON.parse(linhas.join('\n')) as unknown[];
    assert.equal(saida.length, 1);
  } finally {
    c.limpar();
  }
});

test('malote mensagens --conversa continua exigindo a Conversa e ordenando cronologicamente por default', () => {
  const c = cenario();
  try {
    const { id: inquilino, acervo } = c.novoInquilino('Padme');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: 'a@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'm1',
      ocorridaEm: AGORA, agora: AGORA, direcao: 'recebida',
    });
    registrarMensagem(acervo, {
      conversaId, fonte: 'whatsapp', idExterno: 'm2',
      ocorridaEm: AGORA + 1000, agora: AGORA + 1000, direcao: 'recebida',
    });
    acervo.fechar();

    const linhas: string[] = [];
    executar(
      ['mensagens', '--inquilino', inquilino, '--conversa', conversaId, '--json'],
      ambienteDeTeste(c.raiz, linhas),
    );
    const saida = JSON.parse(linhas.join('\n')) as { id: string; ocorridaEm: number }[];
    assert.equal(saida.length, 2);
    assert.ok(saida[0]!.ocorridaEm < saida[1]!.ocorridaEm, 'cronologica: mais antiga primeiro, sem regressao');
  } finally {
    c.limpar();
  }
});
