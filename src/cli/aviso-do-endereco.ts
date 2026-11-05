import { outraFormaDoCelular } from '../adaptadores/whatsapp/celular-br.js';

/**
 * O que um pedido de Envio diz sobre o ENDERECO que o operador pediu (#1376): o Acervo guarda o celular na outra forma
 * (com ou sem o 9) ou nao conhece o endereco em forma nenhuma. O ouvinte decide o destino de fato, ao processar; o aviso
 * e a previa, e vale para o modo local e para a rede.
 */
export interface SobreOEndereco {
  /** O endereco para onde o Envio iria no lugar do pedido, por inteiro (so no corpo `--json`). */
  enderecoUsado?: string;
  enderecoDesconhecido?: boolean;
}

/** O endereco sem o numero inteiro na saida: so os 4 ultimos digitos e o sufixo. */
export function mascararEndereco(endereco: string): string {
  const i = endereco.lastIndexOf('@');
  if (i < 0) return endereco;
  return `...${endereco.slice(Math.max(0, i - 4), i)}${endereco.slice(i)}`;
}

/** As linhas do texto. Os dois enderecos terminam nos mesmos 4 digitos, entao o texto diz a forma, nao o numero. */
export function linhasSobreOEndereco(pedido: string, sobre: SobreOEndereco): string[] {
  if (sobre.enderecoUsado !== undefined) {
    // So diz "com" ou "sem o 9" quando o usado e a outra forma do MESMO celular; um par entre numeros diferentes
    // (um telefone que e alternativo de outro) nao tem forma a dizer.
    if (outraFormaDoCelular(pedido) === sobre.enderecoUsado) {
      const forma = sobre.enderecoUsado.length > pedido.length ? 'com' : 'sem';
      return [
        `  O Acervo guarda este celular ${forma} o 9: o Envio sai para ${mascararEndereco(sobre.enderecoUsado)}, e nao para o endereco pedido.`,
      ];
    }
    return [
      `  O Acervo guarda este numero em outro endereco: o Envio sai para ${mascararEndereco(sobre.enderecoUsado)}, e nao para o endereco pedido.`,
    ];
  }
  if (sobre.enderecoDesconhecido === true) {
    // Fixo e numero de outro pais tem uma forma so: "as duas formas" seria falso.
    if (outraFormaDoCelular(pedido) === null) {
      return ['  O Acervo nao conhece este endereco: o Envio sai como foi pedido.'];
    }
    return [
      '  O Acervo nao conhece este endereco em nenhuma das duas formas: o Envio sai como foi pedido. ' +
        'Se for celular, confira a forma com "malote identificar" antes de contar com a entrega (#1364).',
    ];
  }
  return [];
}
