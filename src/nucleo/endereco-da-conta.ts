import type { Acervo } from './acervo.js';
import {
  aprenderCorrespondencia,
  CorrespondenciaEmConflitoError,
  resolverEndereco,
} from './correspondencia.js';
import { registrarIdentificador } from './escrita.js';
import { emOperacao } from './trilha.js';
import type { Fonte } from './tipos.js';

/**
 * Declara ao Acervo o endereco da PROPRIA conta (spec #1149): o Identificador
 * do endereco canonico e, quando a Fonte tem outra forma dele, a
 * correspondencia alternativo para canonico.
 *
 * O nucleo nao nomeia ferramenta: fala de endereco canonico e
 * alternativo. Quem sabe qual e qual e o Adaptador.
 *
 * So o que MUDA abre Operacao. O ouvinte chama isto a cada conexao, e uma
 * Operacao vazia por religacao dobraria a trilha de um processo que roda por
 * meses — a mesma razao do envelope de aprendizado ao vivo.
 */
export interface EntradaDeEnderecoDaConta {
  fonte: Fonte;
  canonico: string;
  alternativo?: string;
}

export interface ResultadoDeEnderecoDaConta {
  identificadorCriado: boolean;
  correspondenciaAprendida: boolean;
  /** A correspondencia ja existia apontando para OUTRO canonico: a primeira permanece. */
  conflito: boolean;
}

export function declararEnderecosDaConta(
  acervo: Acervo,
  entrada: EntradaDeEnderecoDaConta,
): ResultadoDeEnderecoDaConta {
  const existe =
    acervo.preparar('SELECT 1 AS ok FROM identificadores WHERE fonte = ? AND valor = ?')
      .get(entrada.fonte, entrada.canonico) !== undefined;
  const alternativoPendente =
    entrada.alternativo !== undefined &&
    resolverEndereco(acervo, entrada.fonte, entrada.alternativo) === entrada.alternativo;
  const jaMapeadoParaOutro =
    entrada.alternativo !== undefined &&
    !alternativoPendente &&
    resolverEndereco(acervo, entrada.fonte, entrada.alternativo) !== entrada.canonico;

  // Nada a escrever: ou ja esta tudo gravado, ou a correspondencia aponta para OUTRO
  // canonico (conflito conhecido: relatado, e sem Operacao vazia a cada conexao).
  if (existe && !alternativoPendente) {
    return { identificadorCriado: false, correspondenciaAprendida: false, conflito: jaMapeadoParaOutro };
  }

  let identificadorCriado = false;
  let correspondenciaAprendida = false;
  let conflito = jaMapeadoParaOutro;
  emOperacao(
    acervo,
    {
      natureza: 'declarar-endereco-da-conta',
      reversibilidade: 'irreversivel',
      // Como o aprendizado ao vivo: nenhum `op.valor` e chamado aqui, entao ligar o efeito nao muda nada
      // observavel — mutante EQUIVALENTE, medido em 05/10/2026; nao gastar um teste tentando mata-lo.
      registraEfeito: false,
    },
    () => {
      identificadorCriado = registrarIdentificador(acervo, {
        fonte: entrada.fonte,
        valor: entrada.canonico,
      }).criado;
      if (entrada.alternativo !== undefined && alternativoPendente) {
        try {
          aprenderCorrespondencia(acervo, {
            fonte: entrada.fonte,
            alternativo: entrada.alternativo,
            canonico: entrada.canonico,
          });
          correspondenciaAprendida = true;
        } catch (erro) {
          if (!(erro instanceof CorrespondenciaEmConflitoError)) throw erro;
          conflito = true;
        }
      }
    },
  );
  return { identificadorCriado, correspondenciaAprendida, conflito };
}
