import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarExportador } from '../src/cli/exportar.js';
import type { CartaoCompartilhado } from '../src/nucleo/contato-compartilhado.js';

const ANA: CartaoCompartilhado = {
  nome: 'Ana Souza',
  organizacao: 'Eletrica Souza',
  nomeComercial: null,
  valores: [
    { tipo: 'telefone', texto: '+55 65 99999-1234', digitos: '5565999991234', rotulo: 'cell' },
    { tipo: 'email', texto: 'ana@exemplo.com', digitos: null, rotulo: null },
  ],
};

test('exportar mostra o cartao em txt e traz o campo no json', () => {
  const mensagemLida = {
    id: 'm1',
    conversaId: 'c1',
    fonte: 'whatsapp' as const,
    autorId: null,
    conteudo: null,
    ocorridaEm: Date.parse('2026-06-01T12:30:05Z'),
    direcao: 'recebida' as const,
    anexos: [],
    contatosCompartilhados: [{ id: 'x', posicao: 0, ...ANA }],
  };
  const exportar = (formato: 'txt' | 'json'): string => {
    const linhas: string[] = [];
    const e = criarExportador({
      formato,
      conversaId: 'c1',
      filtros: {},
      exportadoEm: '2026-10-13T12:00:00.000Z',
      autores: [],
      escrever: (l) => linhas.push(l),
    });
    e.acrescentar([mensagemLida]);
    e.concluir();
    return linhas.join('\n');
  };

  assert.match(exportar('txt'), /\[contato: Ana Souza — Eletrica Souza\] \+55 65 99999-1234, ana@exemplo\.com/);
  const json = JSON.parse(exportar('json')) as { mensagens: Array<{ contatosCompartilhados: Array<{ nome: string }> }> };
  assert.equal(json.mensagens[0]?.contatosCompartilhados[0]?.nome, 'Ana Souza');
});
