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
  const resolvido = resolverEndereco(acervo, FONTE, endereco);
  if (resolvido !== endereco) return resolvido;

  const outra = outraFormaDoCelular(endereco);
  if (outra === null) return endereco;

  // A outra forma ja e alternativa de um par: ou o canonico e este endereco (nada a aprender) ou aponta para outro
  // lugar (achado). Nos dois casos o endereco fica como esta.
  if (resolverEndereco(acervo, FONTE, outra) !== outra) return endereco;

  const escolha = escolher(acervo, endereco, outra);
  if (escolha === null) return endereco;
  if (!escolha.deEvidencia && opcoes.soComEvidencia === true) return endereco;

  const par = { fonte: FONTE, alternativo: escolha.alternativo, canonico: escolha.canonico };
  if (op !== undefined) {
    aprenderCorrespondencia(acervo, par, op);
  } else {
    emOperacao(
      acervo,
      { natureza: 'aprender-endereco-ao-vivo', reversibilidade: 'irreversivel', registraEfeito: false },
      () => aprenderCorrespondencia(acervo, par),
    );
  }
  return escolha.canonico;
}
