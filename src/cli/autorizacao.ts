import type { Registro } from '../registro/registro.js';
import { contarChavesAtivas } from '../registro/chave-operador.js';

/**
 * Autoriza comando administrativo — criar Inquilino, configurar Destino,
 * emitir e revogar Chave.
 *
 * A regra é sobre o ESTADO do Registro, não sobre contagem de invocações:
 * contador é estado que alguém zera reinstalando, e "a primeira execução é
 * especial" quebra sob reinstalação, Registro apagado ou dois shells em paralelo.
 *
 * Recebe a identidade JA RESOLVIDA, e nao o valor da Chave.
 *
 * Verificar aqui dentro faria a chave ser conferida duas vezes por invocacao —
 * uma para resolver o Ator, outra para autorizar. Alem do custo da derivacao,
 * isso DUPLICARIA a linha em `tentativas_de_chave`, e o log de tentativa e
 * prova de acesso: contar duas onde houve uma o faz mentir.
 *
 * `valor` continua chegando para distinguir "nao apresentou" de "apresentou e
 * nao vale" — as duas recusas dizem coisas diferentes a quem opera.
 */
export function autorizarAdministracao(
  registro: Registro,
  valor: string | undefined,
  identidade: string | null,
): void {
  if (contarChavesAtivas(registro) === 0) {
    throw new Error(
      'Recusado: a instalacao nao tem nenhuma Chave de Operador. ' +
        'Rode `malote operador chave criar` antes de administrar qualquer coisa.',
    );
  }
  if (valor === undefined || valor.trim() === '') {
    throw new Error('Recusado: Chave de Operador ausente. Informe --chave.');
  }
  if (identidade === null) {
    throw new Error('Recusado: Chave de Operador invalida.');
  }
}

/**
 * Autoriza a criação de Chave de Operador.
 * Enquanto o Registro não tem nenhuma, a raiz de confiança é o acesso à
 * máquina — não há credencial anterior a apresentar. A partir da primeira,
 * criar outra é ato administrativo como qualquer outro.
 */
export function autorizarBootstrap(
  registro: Registro,
  valor: string | undefined,
  identidade: string | null,
): void {
  if (contarChavesAtivas(registro) === 0) {
    return;
  }
  if (valor === undefined || valor.trim() === '') {
    throw new Error(
      'Recusado: ja existe Chave de Operador nesta instalacao. Informe --chave para criar outra.',
    );
  }
  if (identidade === null) {
    throw new Error('Recusado: Chave de Operador invalida.');
  }
}
