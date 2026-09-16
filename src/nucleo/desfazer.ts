import type { Acervo } from './acervo.js';
import { emOperacao, lerOperacao, type LinhaDeEfeito, type OperacaoVista } from './trilha.js';
import {
  desfazerMesclagem,
  desvincularIdentificador,
  vincularIdentificador,
} from './identidade.js';
import type { ProcedenciaDeVinculo } from './tipos.js';
import { TABELAS_QUE_APONTAM_PARA_IDENTIFICADOR } from './resolucao-retroativa.js';

/** A Operacao ja foi desfeita. O indice unico do schema e a guarda dura. */
export class OperacaoJaDesfeitaError extends Error {
  constructor(
    readonly operacaoId: string,
    readonly desfeitaPor: string,
  ) {
    super(`Operacao ${operacaoId} ja foi desfeita pela Operacao ${desfeitaPor}.`);
    this.name = 'OperacaoJaDesfeitaError';
  }
}

/**
 * Recusa nomeada. Nao e buraco: e o desenho.
 *
 * O criterio 13 da spec exige que desfazer o irreversivel RECUSE com a causa
 * dita, em vez de falhar em silencio ou fingir que reverteu.
 */
export class OperacaoIrreversivelError extends Error {
  constructor(
    readonly operacaoId: string,
    readonly natureza: string,
    causa: string,
  ) {
    super(`Operacao ${operacaoId} (${natureza}) nao pode ser desfeita: ${causa}`);
    this.name = 'OperacaoIrreversivelError';
  }
}

/** Por que cada natureza nao volta. Chave ausente = a natureza se desfaz. */
const NAO_SE_DESFAZ: Record<string, string> = {
  'criar-pessoa':
    'o produto nunca remove Pessoa — e ela que guarda o historico de nomes e o registro do que foi desfeito.',
  'registrar-nome':
    'nome nao se apaga; a Atribuicao de Nome e acrescimo, e o nome corrente sai da precedencia.',
  'descartar-anexo':
    'o arquivo saiu do disco e nada o traz de volta. O Descritor continua no Acervo.',
  'importar-material':
    'reverter um Material e recriar o Acervo — `malote acervo recriar` — e reimportar.',
  'desfazer-mesclagem': 'desfazer um desfazer e refazer: mescle de novo, com `pessoa mesclar`.',
  'desfazer-operacao': 'desfazer um desfazer e refazer: repita o ato original.',
};

export interface ItemRecusado {
  linha: number;
  causa: string;
}

export interface ResultadoDoDesfazer {
  operacaoId: string;
  /** A Operacao NOVA, que aponta para a desfeita. */
  desfazerId: string;
  desfeitos: number;
  recusados: ItemRecusado[];
}

/**
 * Recusa antes de escrever. Exportada porque o ENSAIO da CLI usa exatamente
 * esta checagem — duas copias divergiriam, e o ensaio passaria a mentir sobre
 * o que aconteceria de verdade.
 */
export function conferirSeDesfazivel(vista: OperacaoVista): void {
  if (vista.desfeitaPor !== null) {
    throw new OperacaoJaDesfeitaError(vista.id, vista.desfeitaPor);
  }
  const causa = NAO_SE_DESFAZ[vista.natureza];
  if (causa !== undefined) {
    throw new OperacaoIrreversivelError(vista.id, vista.natureza, causa);
  }
  if (vista.reversibilidade === 'irreversivel') {
    throw new OperacaoIrreversivelError(
      vista.id,
      vista.natureza,
      'declarada irreversivel quando foi gravada.',
    );
  }
  if (vista.inquilinoId !== null) {
    throw new OperacaoIrreversivelError(
      vista.id,
      vista.natureza,
      'decisao de configuracao se desfaz REDEFININDO, com o comando que a definiu. ' +
        'Veja o valor anterior em `malote operacao ver`.',
    );
  }
}

/**
 * O ato de mesclagem ainda e o ATIVO daquela Pessoa?
 *
 * Sem esta checagem, desfazer um lote depois de a Pessoa ter sido remesclada
 * desfaria a mesclagem NOVA, silenciosamente — reverteria trabalho que nao e
 * o registrado. E o flanco do criterio 14.
 */
function atoAindaAtivo(acervo: Acervo, atoId: string): { absorvidaId: string } | null {
  const ato = acervo.preparar(
      `SELECT a.absorvida_id FROM atos_de_mesclagem a
        WHERE a.id = ? AND a.tipo = 'mesclagem'
          AND NOT EXISTS (SELECT 1 FROM atos_de_mesclagem d
                           WHERE d.tipo = 'desfazer' AND d.desfaz_id = a.id)
          AND EXISTS (SELECT 1 FROM pessoas p
                       WHERE p.id = a.absorvida_id AND p.absorvida_por IS NOT NULL)`,
    )
    .get(atoId) as { absorvida_id: string } | undefined;
  return ato === undefined ? null : { absorvidaId: ato.absorvida_id };
}

/**
 * Linhas que o desfazer NAO percorre, porque outra linha ja as cobre.
 *
 * Vincular e desvincular escrevem tres linhas — `pessoa_id`, `procedencia` e
 * `vinculado_em` — que sao UM ato so. Quem carrega o ato e a de `pessoa_id`;
 * as irmas descrevem o mesmo movimento. Percorre-las produziria duas recusas
 * espurias por vinculo desfeito, e o relatorio diria "recusei" sobre trabalho
 * que foi feito.
 */
/** As colunas da chave primaria, na ordem que o schema declarou. */
function colunasDaChave(acervo: Acervo, tabela: string): string[] {
  const info = acervo.preparar(`PRAGMA table_info("${tabela}")`).all() as Array<{
    name: string;
    pk: number;
  }>;
  return info
    .filter((c) => c.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
}

/**
 * Os valores da chave, na convencao da resolucao retroativa: JSON quando a
 * chave e composta, a cadeia crua quando e de coluna unica.
 */
function valoresDaChave(chave: string): string[] {
  return chave.startsWith('[') ? (JSON.parse(chave) as string[]) : [chave];
}

/** As linhas de uma MESMA linha de tabela apagada, na ordem em que foram relatadas. */
function grupoDaLinhaApagada(l: LinhaDeEfeito, todas: LinhaDeEfeito[]): LinhaDeEfeito[] {
  return todas.filter(
    (o) =>
      o.natureza === 'valor' &&
      o.tabela === l.tabela &&
      o.chave === l.chave &&
      o.depois === null &&
      o.antes !== null,
  );
}

/**
 * A fusao da resolucao retroativa relata UMA linha por coluna da linha
 * apagada, porque e assim que ela pode ser reinserida inteira. Reinserir uma
 * vez por coluna criaria a mesma linha N vezes — ou esbarraria na chave.
 * So a primeira do grupo reinsere; as demais sao irmas e nao tem trabalho.
 */
function ehIrmaDeLinhaApagada(l: LinhaDeEfeito, todas: LinhaDeEfeito[]): boolean {
  if (l.natureza !== 'valor') return false;
  if (!(TABELAS_QUE_APONTAM_PARA_IDENTIFICADOR as readonly string[]).includes(l.tabela)) {
    return false;
  }
  if (l.depois !== null) return false;
  const grupo = grupoDaLinhaApagada(l, todas);
  return grupo.length > 1 && grupo[0] !== l;
}

function ehIrmaDeVinculo(l: LinhaDeEfeito, todas: LinhaDeEfeito[]): boolean {
  if (l.tabela !== 'identificadores') return false;
  if (l.campo !== 'procedencia' && l.campo !== 'vinculado_em') return false;
  return todas.some(
    (o) => o.tabela === 'identificadores' && o.chave === l.chave && o.campo === 'pessoa_id',
  );
}

/** Desfaz UMA linha de efeito. Devolve a causa quando recusa, ou null. */
function desfazerLinha(acervo: Acervo, l: LinhaDeEfeito, todas: LinhaDeEfeito[]): string | null {
  if (l.natureza === 'referencia') {
    if (l.tabela !== 'atos_de_mesclagem') return `referencia a ${l.tabela} nao tem desfazer`;
    const ativo = atoAindaAtivo(acervo, l.chave);
    if (ativo === null) {
      return 'a mesclagem ja nao esta ativa — foi desfeita ou a Pessoa foi remesclada depois';
    }
    desfazerMesclagem(acervo, { absorvidaId: ativo.absorvidaId });
    return null;
  }

  if (l.tabela === 'identificadores' && l.campo === 'pessoa_id') {
    // Vinculo que NASCEU aqui: antes vazio, depois com Pessoa. Desfazer e
    // desvincular. As linhas irmas — procedencia e vinculado_em — sao do mesmo
    // ato e nao precisam de tratamento proprio.
    if (l.antes === null && l.depois !== null) {
      desvincularIdentificador(acervo, l.chave);
      return null;
    }
    // Desvinculo: antes com Pessoa, depois vazio. Desfazer e revincular, com a
    // Procedencia que a linha IRMA da mesma Operacao guardou.
    if (l.antes !== null && l.depois === null) {
      const irma = todas.find(
        (o) => o.tabela === 'identificadores' && o.chave === l.chave && o.campo === 'procedencia',
      );
      const procedencia = (irma?.antes ?? 'material') as ProcedenciaDeVinculo;
      // `vinculado_em` volta como AGORA, e nao como era: revincular e uma
      // afirmacao nova, feita hoje. A data que o campo guarda e a da afirmacao
      // que VALE, e a que vale passou a ser esta. Quando o vinculo nasceu fica
      // na trilha, que e onde essa informacao deve estar.
      vincularIdentificador(acervo, {
        identificadorId: l.chave,
        pessoaId: l.antes,
        procedencia,
      });
      return null;
    }
  }

  // Pessoa criada dentro de um lote: a mesma razao da natureza `criar-pessoa`,
  // dita com as mesmas palavras. Causa generica aqui faria o relatorio de um
  // lote de 922 Pessoas dizer "nao tem porta" 922 vezes, sem explicar nada.
  if (l.tabela === 'pessoas' && l.campo === 'id') {
    return NAO_SE_DESFAZ['criar-pessoa'] as string;
  }

  // Resolucao retroativa de endereco: as cinco tabelas do inventario.
  if ((TABELAS_QUE_APONTAM_PARA_IDENTIFICADOR as readonly string[]).includes(l.tabela)) {
    // Linha que a fusao apagou: reinsere inteira, a partir das linhas irmas.
    if (l.depois === null && l.antes !== null) {
      const grupo = grupoDaLinhaApagada(l, todas);
      const colunas = grupo.map((o) => o.campo as string);
      const valores = grupo.map((o) => o.antes);
      acervo.preparar(
          `INSERT INTO "${l.tabela}" (${colunas.map((c) => `"${c}"`).join(', ')}) ` +
            `VALUES (${colunas.map(() => '?').join(', ')})`,
        )
        .run(...valores);
      return null;
    }
    // Referencia repontada: volta ao endereco anterior. A chave gravada e a da
    // linha DEPOIS da troca — e por ela que se acha a linha hoje.
    if (l.antes !== null && l.depois !== null && l.campo !== null) {
      const pk = colunasDaChave(acervo, l.tabela);
      const valores = valoresDaChave(l.chave);
      const onde = pk.map((c) => `"${c}" = ?`).join(' AND ');
      acervo.preparar(`UPDATE "${l.tabela}" SET "${l.campo}" = ? WHERE ${onde}`)
        .run(l.antes, ...valores);
      return null;
    }
  }

  return `${l.tabela}.${l.campo ?? '(referencia)'} nao tem porta de restauracao`;
}

/**
 * Desfaz uma Operacao pelo identificador.
 *
 * NUNCA escreve SQL cru: anda as linhas ao contrario e chama as PORTAS. Por
 * isso o rastro do desfazer vem de graca — cada porta chamada aqui dentro se
 * junta, pela reentrancia, a Operacao que este desfazer abriu, e grava as
 * proprias linhas nela.
 *
 * Item a item: uma linha recusada nao aborta as demais, e o relatorio diz qual
 * e por que. E o mesmo contrato do `aplicarLote`.
 */
export function desfazerOperacao(acervo: Acervo, operacaoId: string): ResultadoDoDesfazer {
  const vista = lerOperacao(acervo, operacaoId);
  if (vista === null) throw new Error(`Operacao desconhecida: ${operacaoId}`);
  conferirSeDesfazivel(vista);

  let desfeitos = 0;
  const recusados: ItemRecusado[] = [];

  const desfazerId = emOperacao(
    acervo,
    { natureza: 'desfazer-operacao', reversibilidade: 'irreversivel', desfazId: operacaoId },
    (op) => {
      // Ordem inversa: a ultima escrita foi a que empilhou por cima.
      const linhas = [...vista.efeito]
        .reverse()
        .filter((l) => !ehIrmaDeVinculo(l, vista.efeito))
        .filter((l) => !ehIrmaDeLinhaApagada(l, vista.efeito));
      for (let i = 0; i < linhas.length; i += 1) {
        const l = linhas[i] as LinhaDeEfeito;
        let causa: string | null;
        try {
          causa = desfazerLinha(acervo, l, vista.efeito);
        } catch (erro) {
          causa = erro instanceof Error ? erro.name : 'erro desconhecido';
        }
        if (causa === null) desfeitos += 1;
        else recusados.push({ linha: linhas.length - i, causa });
      }
      return op.id;
    },
  );

  return { operacaoId, desfazerId, desfeitos, recusados };
}
