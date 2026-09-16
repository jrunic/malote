import { randomUUID } from 'node:crypto';
import type { Acervo } from './acervo.js';
import type { Fonte } from './tipos.js';
import { emOperacao } from './trilha.js';

/**
 * O Estado de Sincronização é o que o Adaptador precisa lembrar entre
 * execuções: qual Material já entrou. Vive no Acervo — recriar o Acervo apaga
 * o registro junto, e o produto nunca afirma que um Material entrou contra um
 * banco que não o contém.
 */

export interface MaterialRegistrado {
  id: string;
  configuracaoId: string;
  fonte: Fonte;
  impressao: string;
  registradoEm: string;
  conversasCriadas: number;
  mensagensCriadas: number;
}

export interface EntradaDeMaterial {
  configuracaoId: string;
  fonte: Fonte;
  impressao: string;
  conversasCriadas: number;
  mensagensCriadas: number;
}

interface Linha {
  id: string;
  configuracao_id: string;
  fonte: string;
  impressao: string;
  registrado_em: string;
  conversas_criadas: number;
  mensagens_criadas: number;
}

function paraMaterial(l: Linha): MaterialRegistrado {
  return {
    id: l.id,
    configuracaoId: l.configuracao_id,
    fonte: l.fonte as Fonte,
    impressao: l.impressao,
    registradoEm: l.registrado_em,
    conversasCriadas: l.conversas_criadas,
    mensagensCriadas: l.mensagens_criadas,
  };
}

/**
 * Registra que um Material entrou POR INTEIRO. Chamado só quando a importação
 * termina: importação interrompida no meio não deixa registro, e a execução
 * seguinte processa o material do começo.
 */
export function registrarMaterialConcluido(acervo: Acervo, entrada: EntradaDeMaterial): void {
  const materialId = randomUUID();
  // Uma Operacao por MATERIAL, nunca uma por Mensagem: a conta real tem mais de
  // um milhao delas, e registrar cada uma dobraria o Acervo. A tabela materiais
  // ja e a trilha da ingestao desde o ciclo 4 — esta Operacao a REFERENCIA.
  //
  // IRREVERSIVEL, e a causa a nomear ao recusar desfazer e "reverter um
  // Material e recriar o Acervo" — a operacao existe e e outra.
  emOperacao(acervo, { natureza: 'importar-material', reversibilidade: 'irreversivel' }, (op) => {
    acervo.preparar(
        `INSERT INTO materiais
         (id, configuracao_id, fonte, impressao, registrado_em, conversas_criadas, mensagens_criadas)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (configuracao_id, impressao) DO UPDATE SET
         registrado_em     = excluded.registrado_em,
         conversas_criadas = excluded.conversas_criadas,
         mensagens_criadas = excluded.mensagens_criadas`,
      )
      .run(
        materialId,
        entrada.configuracaoId,
        entrada.fonte,
        entrada.impressao,
        new Date().toISOString(),
        entrada.conversasCriadas,
        entrada.mensagensCriadas,
      );

    // Rele o id: com `ON CONFLICT DO UPDATE`, reimportar o mesmo Material
    // mantem a linha ANTIGA, e `materialId` nao e o que ficou gravado.
    // Referenciar o UUID novo apontaria para linha inexistente.
    const gravado = acervo.preparar('SELECT id FROM materiais WHERE configuracao_id = ? AND impressao = ?')
      .get(entrada.configuracaoId, entrada.impressao) as { id: string };
    op.referencia({ tabela: 'materiais', chave: gravado.id });
  });
}

export function materialJaEntrou(
  acervo: Acervo,
  configuracaoId: string,
  impressao: string,
): MaterialRegistrado | null {
  const l = acervo.preparar('SELECT * FROM materiais WHERE configuracao_id = ? AND impressao = ?')
    .get(configuracaoId, impressao) as Linha | undefined;
  return l === undefined ? null : paraMaterial(l);
}

export function listarMateriais(acervo: Acervo, configuracaoId: string): MaterialRegistrado[] {
  const linhas = acervo.preparar('SELECT * FROM materiais WHERE configuracao_id = ? ORDER BY registrado_em, rowid')
    .all(configuracaoId) as Linha[];
  return linhas.map(paraMaterial);
}

export function ultimoMaterial(acervo: Acervo, configuracaoId: string): MaterialRegistrado | null {
  const l = acervo.preparar(
      `SELECT * FROM materiais WHERE configuracao_id = ?
        ORDER BY registrado_em DESC, rowid DESC LIMIT 1`,
    )
    .get(configuracaoId) as Linha | undefined;
  return l === undefined ? null : paraMaterial(l);
}
