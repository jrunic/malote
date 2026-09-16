import type { Acervo } from '../../src/nucleo/acervo.js';

/**
 * COUNT(*) de toda tabela, para provar que o ensaio nao escreveu e que a
 * segunda passagem da resolucao nao produziu linha nova.
 */
export function contarTudo(acervo: Acervo): Record<string, number> {
  const tabelas = acervo.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const conta: Record<string, number> = {};
  for (const { name } of tabelas) {
    const linha = acervo.db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
    conta[name] = linha.n;
  }
  return conta;
}

/**
 * Quem aponta para qual Identificador, tabela por tabela.
 *
 * Compara REFERENCIAS, nunca existencia de linha em `identificadores`: o
 * Identificador canonico que a resolucao cria sobrevive ao desfazer de
 * proposito — o produto nunca remove Identificador, e um sem referencia nenhuma
 * e inerte. Comparar linhas faria o teste de reversibilidade falhar por esse
 * efeito colateral, que nao e o que se esta medindo.
 */
export function fotografiaDeReferencias(acervo: Acervo): string {
  const alvos: ReadonlyArray<{ tabela: string; campo: string; ordem: string }> = [
    { tabela: 'mensagens', campo: 'autor_id', ordem: 'id' },
    { tabela: 'atribuicoes_de_nome', campo: 'identificador_id', ordem: 'id' },
    { tabela: 'transicoes_de_participacao', campo: 'identificador_id', ordem: 'id' },
    {
      tabela: 'participacoes',
      campo: 'identificador_id',
      ordem: 'conversa_id, identificador_id',
    },
    {
      tabela: 'cartoes_de_catalogo',
      campo: 'identificador_id',
      ordem: 'identificador_id, cartao',
    },
  ];
  const partes: string[] = [];
  for (const { tabela, campo, ordem } of alvos) {
    const linhas = acervo.db
      .prepare(`SELECT ${ordem}, "${campo}" AS alvo FROM "${tabela}" ORDER BY ${ordem}`)
      .all();
    partes.push(`${tabela}=${JSON.stringify(linhas)}`);
  }
  return partes.join('\n');
}
