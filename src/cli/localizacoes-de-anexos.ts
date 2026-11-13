import { MAXIMO_DE_ANEXOS_POR_CONSULTA_DE_LOCALIZACOES, type LocalizacaoParaOIndice } from '../nucleo/midia-remota.js';
import { abrirLocalizacaoSomenteLeitura, lerLocalizacoes } from '../registro/localizacao.js';
import { contextoDoInquilino, descreverErro, type DependenciasDoServico } from './servico-de-armazenamento.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export type ResultadoDaConsultaDeLocalizacoes =
  | { tipo: 'localizacoes'; porAnexo: Record<string, LocalizacaoParaOIndice> }
  | { tipo: 'invalida'; motivo: string }
  | { tipo: 'inacessivel'; motivo: string };

/**
 * As Localizacoes dos Anexos pedidos, para o Indice de Midia. So o Servico abre a base da Localizacao; o pedido e por
 * Inquilino e por lista de Anexos (no maximo uma pagina do Indice). So devolve a Localizacao do remoto de AGORA: a de
 * outro remoto nao serve de link. Inquilino sem Destino Remoto, ou sem base, devolve vazio.
 */
export function consultarLocalizacoes(
  dep: DependenciasDoServico,
  inquilinoId: string,
  anexoIds: readonly string[],
): ResultadoDaConsultaDeLocalizacoes {
  if (anexoIds.length > MAXIMO_DE_ANEXOS_POR_CONSULTA_DE_LOCALIZACOES) {
    return { tipo: 'invalida', motivo: `no maximo ${MAXIMO_DE_ANEXOS_POR_CONSULTA_DE_LOCALIZACOES} Anexos por consulta` };
  }
  if (!anexoIds.every((id) => ID.test(id))) return { tipo: 'invalida', motivo: 'identificador de Anexo invalido' };
  const ctx = contextoDoInquilino(dep, inquilinoId, { avisar: false });
  if (ctx === undefined) return { tipo: 'localizacoes', porAnexo: {} };
  let base;
  try {
    base = abrirLocalizacaoSomenteLeitura(dep.estado, inquilinoId);
  } catch (erro) {
    return { tipo: 'inacessivel', motivo: `base da Localizacao indisponivel: ${descreverErro(erro)}` };
  }
  if (base === undefined) return { tipo: 'localizacoes', porAnexo: {} };
  try {
    const porAnexo: Record<string, LocalizacaoParaOIndice> = {};
    for (const [id, l] of lerLocalizacoes(base, anexoIds)) {
      if (l.remoto !== ctx.remoto.remoto) continue;
      porAnexo[id] = { idNoRemoto: l.idNoRemoto, copiaLocalRemovida: l.copiaLocalRemovidaEm !== null };
    }
    return { tipo: 'localizacoes', porAnexo };
  } finally {
    base.fechar();
  }
}
