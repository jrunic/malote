import type { Acervo } from '../../nucleo/acervo.js';
import {
  contarMensagensDoEndereco,
  listarConversasDiretasDoEndereco,
  listarIdentificadoresPorSufixo,
} from '../../nucleo/enderecos-do-acervo.js';
import { emOperacao, type Operacao } from '../../nucleo/trilha.js';
import { outraFormaDoCelular } from './celular-br.js';
import { resolverEnderecoDeWhatsapp, situacaoNoEstoque } from './resolver-celular.js';

const FONTE = 'whatsapp' as const;
const SUFIXO_DE_TELEFONE = '@s.whatsapp.net';
const PAGINA = 1000;
const LOTE_PADRAO = 500;

export interface OpcoesDoEstoqueDoCelular {
  comEfeito: boolean;
  /** No maximo este numero de pares criados. Inteiro maior que zero. */
  limite?: number;
  /** Numeros por transacao (padrao 500). Uma transacao por lote, para nao segurar o escritor do ouvinte. */
  tamanhoDoLote?: number;
  /** Chamado ao fim de cada lote, com quantos numeros ele tinha: o progresso de uma varredura longa. */
  aoTerminarLote?: (numeros: number) => void;
  /** SO PARA TESTE: chamado depois do plano e antes da Operacao, para simular o ouvinte que aprende pares nesse intervalo. */
  ganchoDeTeste?: { antesDosLotes?: () => void };
}

/**
 * Um lote falhou (o escritor do ouvinte nao liberou em 5 s, por exemplo) com a Operacao ja aberta: os lotes anteriores ficaram
 * gravados. Repetir o comando completa o que falta, mas numa SEGUNDA Operacao: a volta inteira pede o `desfazer` das duas.
 */
export class EstoqueInterrompidoError extends Error {
  constructor(
    readonly operacaoId: string,
    readonly criados: number,
    readonly causa: unknown,
  ) {
    super(`o estoque do celular parou com ${criados} par(es) ja criado(s) na Operacao ${operacaoId}: ${String(causa)}`);
    this.name = 'EstoqueInterrompidoError';
  }
}

export interface RelatorioDoEstoqueDoCelular {
  /** Identificadores de WhatsApp com endereco de telefone examinados. */
  candidatos: number;
  /** Dos candidatos, os que nao sao celular brasileiro pela regra (fixo, 9 seguido de 0 a 5, outro pais). */
  naoCelular: number;
  /** Numeros de celular distintos: as duas formas contam como um. */
  celulares: number;
  /** Numeros cujo par das duas formas ja existe. */
  jaResolvidos: number;
  /** Numeros cuja outra forma e alternativa de outro endereco: achado, nao ganham par. */
  conflitos: number;
  /** Numeros com as duas formas gravadas como Identificador: sem par, com as Mensagens e as Conversas de cada forma. */
  duasFormas: Array<{ formas: [string, string]; mensagens: [number, number]; conversas: [number, number] }>;
  /** Numeros com uma Conversa direta em cada forma, da mesma Configuracao: a duplicata que o par nao desfaz. */
  conversasDuplicadas: Array<{ formas: [string, string]; configuracaoId: string }>;
  /** Pares que a Operacao criaria (ensaio) ou tentou criar (efeito). */
  aCriar: number;
  /** Dos pares a criar, os que seguem a forma canonica de um par LID que ja existia (os legados inclusive). */
  respeitados: number;
  /**
   * Dos respeitados, os em que o canonico do par LID e a forma NAO gravada: a forma gravada vira a alternativa, e
   * `identidade resolver-enderecos` reconcilia o que ja apontava para ela (o mesmo par nasceria ao vivo).
   */
  legados: number;
  /** Pares de fato criados. Zero no ensaio. */
  criados: number;
  operacaoId: string | null;
  gravou: boolean;
}

/**
 * Aprende o par das duas formas do celular brasileiro para o ESTOQUE (#1376): para cada Identificador de WhatsApp que e celular,
 * resolve pelo MESMO resolvedor da recepcao (a forma gravada e a canonica; o canonico de um par LID e respeitado; as duas
 * gravadas ficam sem par). Ensaio por padrao: conta e nao escreve. A leitura do Acervo todo roda em paginas, fora de
 * transacao; a escrita e UMA Operacao `por-efeito` (o `desfazer` remove so os pares dela), aberta antes dos lotes, com uma
 * transacao por lote (o ouvinte segue no ar) e um efeito por par.
 */
export function aprenderFormasDoCelular(
  acervo: Acervo,
  opcoes: OpcoesDoEstoqueDoCelular,
): RelatorioDoEstoqueDoCelular {
  if (opcoes.limite !== undefined && (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0)) {
    throw new RangeError('o limite precisa ser um inteiro maior que zero');
  }
  const lote = opcoes.tamanhoDoLote ?? LOTE_PADRAO;
  if (!Number.isInteger(lote) || lote <= 0) throw new RangeError('o tamanho do lote precisa ser um inteiro maior que zero');

  const relatorio: RelatorioDoEstoqueDoCelular = {
    candidatos: 0,
    naoCelular: 0,
    celulares: 0,
    jaResolvidos: 0,
    conflitos: 0,
    duasFormas: [],
    conversasDuplicadas: [],
    aCriar: 0,
    respeitados: 0,
    legados: 0,
    criados: 0,
    operacaoId: null,
    gravou: false,
  };
  const plano: string[] = [];
  const vistos = new Set<string>();

  let cursor = '';
  for (;;) {
    const pagina = listarIdentificadoresPorSufixo(acervo, FONTE, SUFIXO_DE_TELEFONE, cursor, PAGINA);
    if (pagina.length === 0) break;
    cursor = pagina[pagina.length - 1]!;
    for (const valor of pagina) {
      relatorio.candidatos += 1;
      const outra = outraFormaDoCelular(valor);
      if (outra === null) {
        relatorio.naoCelular += 1;
        continue;
      }
      const formas: [string, string] = valor < outra ? [valor, outra] : [outra, valor];
      const chave = formas.join('|');
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      relatorio.celulares += 1;

      const conversas = formas.map((f) => listarConversasDiretasDoEndereco(acervo, FONTE, f));
      for (const a of conversas[0]!) {
        if (a.configuracaoId !== null && conversas[1]!.some((b) => b.configuracaoId === a.configuracaoId)) {
          relatorio.conversasDuplicadas.push({ formas, configuracaoId: a.configuracaoId });
        }
      }

      const situacao = situacaoNoEstoque(acervo, valor);
      if (situacao === 'ja-resolvido') relatorio.jaResolvidos += 1;
      else if (situacao === 'conflito') relatorio.conflitos += 1;
      else if (situacao === 'duas-formas') {
        relatorio.duasFormas.push({
          formas,
          mensagens: [contarMensagensDoEndereco(acervo, FONTE, formas[0]), contarMensagensDoEndereco(acervo, FONTE, formas[1])],
          conversas: [conversas[0]!.length, conversas[1]!.length],
        });
      } else if (situacao === 'cria' || situacao === 'cria-respeitando-canonico' || situacao === 'cria-legado') {
        if (opcoes.limite !== undefined && plano.length >= opcoes.limite) continue;
        plano.push(valor);
        if (situacao !== 'cria') relatorio.respeitados += 1;
        if (situacao === 'cria-legado') relatorio.legados += 1;
      }
    }
  }
  relatorio.aCriar = plano.length;
  if (!opcoes.comEfeito || plano.length === 0) return relatorio;

  opcoes.ganchoDeTeste?.antesDosLotes?.();
  const operacaoId = emOperacao(
    acervo,
    { natureza: 'aprender-formas-do-celular', reversibilidade: 'por-efeito', emTransacao: false },
    (op) => {
      try {
        for (let i = 0; i < plano.length; i += lote) {
          const dosLote = plano.slice(i, i + lote);
          // `immediate`: a leitura que decide e a escrita ficam sob o mesmo lock, e o ouvinte nao aprende o par no meio.
          acervo.db
            .transaction(() => {
              for (const valor of dosLote) relatorio.criados += aprenderUm(acervo, valor, op);
            })
            .immediate();
          opcoes.aoTerminarLote?.(dosLote.length);
        }
      } catch (causa) {
        throw new EstoqueInterrompidoError(op.id, relatorio.criados, causa);
      }
      return op.id;
    },
  );
  // Operacao vazia (o ouvinte aprendeu tudo no intervalo) nao e devolvida: nao ha o que desfazer.
  relatorio.operacaoId = relatorio.criados > 0 ? operacaoId : null;
  relatorio.gravou = relatorio.criados > 0;
  return relatorio;
}

/** Aprende o par de um endereco e devolve quantos pares nasceram (0 se o ouvinte o aprendeu no intervalo). */
function aprenderUm(acervo: Acervo, valor: string, op: Operacao): number {
  let nasceram = 0;
  const contador: Operacao = {
    id: op.id,
    valor(relato) {
      nasceram += 1;
      op.valor(relato);
    },
    referencia: (relato) => op.referencia(relato),
  };
  resolverEnderecoDeWhatsapp(acervo, valor, contador);
  return nasceram;
}
