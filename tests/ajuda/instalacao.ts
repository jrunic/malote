import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executar } from '../../src/cli/index.js';

/** Cria um diretório de instalação descartável e devolve o caminho e o limpador. */
export function instalacaoTemporaria(): { raiz: string; limpar: () => void } {
  const raiz = mkdtempSync(join(tmpdir(), 'malote-teste-'));
  return {
    raiz,
    limpar: () => rmSync(raiz, { recursive: true, force: true }),
  };
}

/** Roda a CLI capturando a saída. A pasta de teste é dado E estado — as categorias são testadas em tests/caminhos.test.ts. */
export function rodar(raiz: string, argumentos: string[]): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(argumentos, { dados: raiz, estado: raiz, escrever: (texto: string) => linhas.push(texto) });
  return { codigo, saida: linhas.join('\n') };
}

/**
 * Instalação com uma Chave e um Inquilino, com o Acervo já criado em disco.
 *
 * A consulta `conversas` no final é CARGA, não enfeite: `criarInquilino` não
 * cria o arquivo do Acervo — ele nasce na primeira abertura. Sem ela, quem
 * chamar bate no retorno antecipado "Acervo vazio" e mede código de saída
 * errado, verde pelo motivo errado.
 */
export function instalacaoComChave(raiz: string): { inquilino: string; chave: string } {
  const chave = /valor:\s*(\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
  assert.ok(chave, 'a CLI precisa devolver o valor da Chave de Operador');

  const criacao = rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']);
  const inquilino = /id:\s*(\S+)/.exec(criacao.saida)?.[1];
  assert.ok(inquilino, 'a CLI precisa devolver o id do Inquilino');

  assert.equal(rodar(raiz, ['conversas', '--inquilino', inquilino]).codigo, 0);
  return { inquilino, chave };
}

export function instalacaoComInquilino(raiz: string): string {
  return instalacaoComChave(raiz).inquilino;
}
