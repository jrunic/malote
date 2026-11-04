import type { Acervo } from '../../nucleo/acervo.js';
import {
  aprenderCorrespondencia,
  enderecoEhCanonico,
  enderecoTemIdentificador,
  resolverEndereco,
} from '../../nucleo/correspondencia.js';
import { emOperacao, type Operacao } from '../../nucleo/trilha.js';
import { outraFormaDoCelular } from './celular-br.js';

const FONTE = 'whatsapp' as const;

interface Escolha {
  canonico: string;
  alternativo: string;
  /**
   * Falso quando a escolha e so "a que chegou" (regra 3) E essa forma nao esta gravada como Identificador: o fato de um
   * endereco ter chegado nao diz qual forma a plataforma usa (um Envio traz a forma que o OPERADOR digitou). Quando a
   * que chegou JA e Identificador, a gravada e a evidencia.
   */
  deEvidencia: boolean;
}

/**
 * Qual das duas formas e a canonica, pela ordem da spec da #1376:
 *   0. as duas gravadas como Identificador: SEM PAR (criterio 5), antes de qualquer outra regra — par aqui faria a
 *      retroativa fundir dois Identificadores que o operador quis decidir a mao;
 *   1. a que ja e canonica de um par existente (os 132 pares com celular ainda sem Identificador: aprender o par na
 *      forma que chegou antes montaria cadeia de dois passos, que a resolucao nao segue); as duas canonicas: sem par;
 *   2. a gravada como Identificador;
 *   3. a que chegou.
 * `null` e achado, nao dado novo: nao ha par.
 */
function escolher(acervo: Acervo, chegou: string, outra: string): Escolha | null {
  const gravadaChegou = enderecoTemIdentificador(acervo, FONTE, chegou);
  const gravadaOutra = enderecoTemIdentificador(acervo, FONTE, outra);
  if (gravadaChegou && gravadaOutra) return null;

  const canonicaChegou = enderecoEhCanonico(acervo, FONTE, chegou);
  const canonicaOutra = enderecoEhCanonico(acervo, FONTE, outra);
  if (canonicaChegou && canonicaOutra) return null;
  if (canonicaChegou) return { canonico: chegou, alternativo: outra, deEvidencia: true };
  if (canonicaOutra) return { canonico: outra, alternativo: chegou, deEvidencia: true };

  if (gravadaOutra) return { canonico: outra, alternativo: chegou, deEvidencia: true };
  return { canonico: chegou, alternativo: outra, deEvidencia: gravadaChegou };
}

/**
 * Resolve o endereco de WhatsApp para a forma canonica, aprendendo o par do celular brasileiro (com e sem o 9) quando
 * ainda nao existe. E `resolverEndereco` do nucleo MAIS a correspondencia do celular, e nada alem disso: todo ponto
 * que grava endereco de WhatsApp passa por aqui (#1376).
 *
 * `op`: dentro de uma Operacao `por-efeito` (o estoque e a extracao de Citacao), quem chama PASSA `op`, sempre: o
 * par aprendido vira linha de efeito e o `desfazer` o remove. Sem `op` e sem Operacao aberta (recepcao), o
 * aprendizado abre um envelope irreversivel e sem efeito, e SO quando ha o que aprender, para nao dobrar a trilha de
 * um ouvinte que roda por meses. Sem `op` e COM uma Operacao aberta, a reentrancia junta o aprendizado a ela: nao abre
 * envelope e nao relata efeito (medido, e fixado por teste). Na recepcao isso e o certo (entra na Operacao do evento);
 * numa Operacao `por-efeito` seria um par que o `desfazer` nao remove.
 *
 * `soComEvidencia`: para o endereco que o OPERADOR escolheu (o destino de um Envio e o eco `fromMe` dele). Usa o par, o
 * canonico ou o Identificador que o Acervo ja tem, mas NAO inventa canonica quando nenhuma forma esta gravada: a forma
 * digitada por quem envia nao e evidencia da plataforma, e aprende-la tornaria permanente o `enviado` sem entrega da
 * #1364 (o par `real para digitada` mandaria todo Envio futuro a forma que ja falhou).
 *
 * Nunca recusa: o conflito de correspondencia e achado, e a recepcao grava a Mensagem assim mesmo. Quem impede o
 * conflito e a consulta da outra forma, abaixo; sem ela `aprenderCorrespondencia` lancaria.
 */
export function resolverEnderecoDeWhatsapp(
  acervo: Acervo,
  endereco: string,
  op?: Operacao,
  opcoes: { soComEvidencia?: boolean } = {},
): string {
  const { usado, par } = decidir(acervo, endereco, opcoes.soComEvidencia === true);
  if (par === null) return usado;

  if (op !== undefined) {
    aprenderCorrespondencia(acervo, par, op);
  } else {
    emOperacao(
      acervo,
      { natureza: 'aprender-endereco-ao-vivo', reversibilidade: 'irreversivel', registraEfeito: false },
      () => aprenderCorrespondencia(acervo, par),
    );
  }
  return usado;
}

/** O que o endereco resolve e o par a aprender (nulo quando nao ha). So le: quem escreve e `resolverEnderecoDeWhatsapp`. */
function decidir(
  acervo: Acervo,
  endereco: string,
  soComEvidencia: boolean,
): { usado: string; par: { fonte: typeof FONTE; alternativo: string; canonico: string } | null } {
  const resolvido = resolverEndereco(acervo, FONTE, endereco);
  if (resolvido !== endereco) return { usado: resolvido, par: null };

  const outra = outraFormaDoCelular(endereco);
  if (outra === null) return { usado: endereco, par: null };

  // A outra forma ja e alternativa de um par: ou o canonico e este endereco (nada a aprender) ou aponta para outro
  // lugar (achado). Nos dois casos o endereco fica como esta.
  if (resolverEndereco(acervo, FONTE, outra) !== outra) return { usado: endereco, par: null };

  const escolha = escolher(acervo, endereco, outra);
  if (escolha === null) return { usado: endereco, par: null };
  if (!escolha.deEvidencia && soComEvidencia) return { usado: endereco, par: null };

  return {
    usado: escolha.canonico,
    par: { fonte: FONTE, alternativo: escolha.alternativo, canonico: escolha.canonico },
  };
}

const ehTelefone = (endereco: string): boolean => endereco.endsWith('@s.whatsapp.net');

/**
 * O endereco para onde o ouvinte ENVIA um pedido de Envio ao `endereco`: so telefone se resolve (o grupo e o opaco saem
 * como foram pedidos, que e o que funciona em campo), e com `soComEvidencia`, porque o que o operador digitou nao e
 * evidencia da plataforma (#1364). Aprende o par quando o Acervo tem a evidencia.
 */
export function destinoDeEnvioDeWhatsapp(acervo: Acervo, endereco: string): string {
  if (!ehTelefone(endereco)) return endereco;
  return resolverEnderecoDeWhatsapp(acervo, endereco, undefined, { soComEvidencia: true });
}

export type SituacaoDoDestino = 'redirecionado' | 'conhecido' | 'desconhecido' | 'nao-se-aplica';

/**
 * Para onde um Envio ao `endereco` iria, SEM escrever nada (nem o par, nem Operacao): o aviso do pedido. E a mesma
 * decisao de `destinoDeEnvioDeWhatsapp`, que o ouvinte aplica de fato ao processar o Envio; o Acervo pode ganhar o par
 * entre o pedido e o processamento, e a decisao do ouvinte vale.
 *
 * - `redirecionado`: o Acervo guarda a outra forma do celular (ou o par), e o Envio vai a ela;
 * - `conhecido`: o Acervo conhece o endereco como esta (Identificador, canonico ou alternativo de um par), em qualquer
 *   das duas formas;
 * - `desconhecido`: telefone que o Acervo nao conhece em nenhuma forma; sai como foi pedido (#1364);
 * - `nao-se-aplica`: grupo e opaco, que nao tem duas formas nem aviso de numero.
 */
export function consultarDestinoDeWhatsapp(
  acervo: Acervo,
  endereco: string,
): { usado: string; situacao: SituacaoDoDestino } {
  if (!ehTelefone(endereco)) return { usado: endereco, situacao: 'nao-se-aplica' };
  const { usado } = decidir(acervo, endereco, true);
  if (usado !== endereco) return { usado, situacao: 'redirecionado' };
  const conhece = (e: string): boolean =>
    enderecoTemIdentificador(acervo, FONTE, e) ||
    enderecoEhCanonico(acervo, FONTE, e) ||
    resolverEndereco(acervo, FONTE, e) !== e;
  const outra = outraFormaDoCelular(endereco);
  return { usado, situacao: conhece(endereco) || (outra !== null && conhece(outra)) ? 'conhecido' : 'desconhecido' };
}
