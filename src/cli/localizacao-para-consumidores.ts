import {
  LocalizacaoDeOutraFormaError,
  abrirLocalizacaoSomenteLeitura,
  anexoIdsComLocalizacao,
  copiasLocaisRemovidas,
  resumoDaLocalizacao,
} from '../registro/localizacao.js';
import type { Acervo } from '../nucleo/acervo.js';
import { situacaoDosAnexos } from '../nucleo/anexos-presentes.js';

/** O que os comandos de leitura local (relatorio, espaco, conferencia, recriar) precisam saber da Localizacao. */
export type LocalizacaoParaConsumidor =
  | { ilegivel: false; enviados: number; bytesSoNoRemoto: number; anexoIds: ReadonlySet<string> }
  /** A base esta em outra forma: o Servico a reconstroi (`armazenamento reconstruir`); ate la, nada se afirma sobre o remoto. */
  | { ilegivel: true };

/**
 * `undefined` quando o Inquilino nunca teve Localizacao (nao ha base). Somente leitura: nunca cria nem migra.
 * Com `acervo`, `bytesSoNoRemoto` soma so os Anexos que ainda sao `presente` nele; sem, soma toda copia local removida.
 */
export function lerLocalizacaoParaConsumidor(
  estado: string,
  inquilinoId: string,
  acervo?: Acervo,
): LocalizacaoParaConsumidor | undefined {
  let base;
  try {
    base = abrirLocalizacaoSomenteLeitura(estado, inquilinoId);
  } catch (causa) {
    if (causa instanceof LocalizacaoDeOutraFormaError) return { ilegivel: true };
    throw causa;
  }
  if (base === undefined) return undefined;
  try {
    const removidas = copiasLocaisRemovidas(base);
    const presentes = acervo === undefined ? undefined : situacaoDosAnexos(acervo, removidas.map((r) => r.anexoId));
    const soNoRemoto = removidas.reduce(
      (soma, r) => (presentes === undefined || presentes.get(r.anexoId)?.presenca === 'presente' ? soma + r.tamanho : soma),
      0,
    );
    return {
      ilegivel: false,
      enviados: resumoDaLocalizacao(base).enviados,
      bytesSoNoRemoto: soNoRemoto,
      anexoIds: anexoIdsComLocalizacao(base),
    };
  } finally {
    base.fechar();
  }
}
