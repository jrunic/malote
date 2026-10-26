import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo, type Acervo } from '../src/nucleo/acervo.js';
import { executar } from '../src/cli/index.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarContatosCompartilhados, type CartaoCompartilhado } from '../src/nucleo/contato-compartilhado.js';
import { linhasDeContatoCompartilhado } from '../src/cli/contatos-compartilhados-texto.js';

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const ANA: CartaoCompartilhado = {
  nome: 'Ana Souza',
  organizacao: 'Eletrica Souza',
  nomeComercial: null,
  valores: [
    { tipo: 'telefone', texto: '+55 65 99999-1234', digitos: '5565999991234', rotulo: 'cell' },
    { tipo: 'email', texto: 'ana@exemplo.com', digitos: null, rotulo: null },
  ],
};

function conversa(acervo: Acervo): string {
  return registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '5565900000001@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
}

function mensagem(acervo: Acervo, conversaId: string, idExterno: string, minuto: number): string {
  return registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z') + minuto * 60_000,
    agora: AGORA,
    direcao: 'recebida',
  });
}

test('a linha de texto mostra o nome, a organizacao e os valores do cartao', () => {
  const linhas = linhasDeContatoCompartilhado([{ id: 'x', posicao: 0, ...ANA }]);
  assert.deepEqual(linhas, ['    [contato: Ana Souza — Eletrica Souza] +55 65 99999-1234, ana@exemplo.com']);
  assert.deepEqual(linhasDeContatoCompartilhado([]), []);
  assert.deepEqual(linhasDeContatoCompartilhado(undefined), [], 'servidor antigo nao traz o campo');
  assert.deepEqual(
    linhasDeContatoCompartilhado([{ id: 'y', posicao: 0, nome: 'Sem Valor', organizacao: null, nomeComercial: null, valores: [] }]),
    ['    [contato: Sem Valor]'],
  );
});

test('a saida de texto de mensagens mostra o cartao onde o conteudo e vazio', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
    registro.fechar();
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
    const cv = conversa(acervo);
    registrarContatosCompartilhados(acervo, mensagem(acervo, cv, 'm1', 1), [ANA]);
    acervo.fechar();

    const linhas: string[] = [];
    const codigo = executar(['mensagens', '--inquilino', inquilino, '--conversa', cv], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
    });

    assert.equal(codigo, 0);
    const saida = linhas.join('\n');
    assert.match(saida, /\(sem texto\)/);
    assert.match(saida, /\[contato: Ana Souza — Eletrica Souza\] \+55 65 99999-1234, ana@exemplo\.com/);
  } finally {
    limpar();
  }
});
