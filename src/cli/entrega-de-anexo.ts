import { createHash } from 'node:crypto';
import { lerAnexoPorId } from '../nucleo/consulta.js';
import { abrirLocalizacaoSomenteLeitura, lerLocalizacoes } from '../registro/localizacao.js';
import { type ResultadoDaBusca } from '../nucleo/midia-remota.js';
import { ErroDoRemoto } from './motor-de-armazenamento.js';
import { abrirAcervoParaLer, alvoRemoto, contextoDoInquilino, descreverErro, type DependenciasDoServico } from './servico-de-armazenamento.js';

export interface OpcoesDaEntrega {
  tamanhoMaximo: number;
  prazoMs: number;
  sinal?: AbortSignal | undefined;
}

/**
 * Entrega os bytes de um Anexo que mora no remoto. Quem chama a entrega e o canal local do Servico, e o pedido e por
 * Inquilino e Anexo, NUNCA por caminho: o caminho remoto sai da Localizacao que o proprio Servico verificou.
 *
 * Nada sai sem conferir: a Localizacao tem de ser do Destino Remoto de agora, o Anexo tem de ser o que ela verificou
 * (mesma Impressao e mesmo tamanho do Acervo), e os bytes que o remoto devolve tem de ter o tamanho e o SHA-256 dela.
 * Tudo que nao confere e `inacessivel`, nunca "nao existe" e nunca bytes duvidosos.
 */
export async function entregarAnexo(
  dep: DependenciasDoServico,
  inquilinoId: string,
  anexoId: string,
  opcoes: OpcoesDaEntrega,
): Promise<ResultadoDaBusca> {
  const ctx = contextoDoInquilino(dep, inquilinoId, { avisar: false });
  if (ctx === undefined) return { tipo: 'sem-localizacao' };

  let acervo;
  try {
    acervo = abrirAcervoParaLer(dep, inquilinoId);
  } catch (erro) {
    return { tipo: 'inacessivel', motivo: `Acervo indisponivel: ${descreverErro(erro)}` };
  }
  if (acervo === undefined) return { tipo: 'inacessivel', motivo: 'Acervo em forma diferente da corrente' };
  let anexo;
  try {
    anexo = lerAnexoPorId(acervo, anexoId);
  } finally {
    acervo.fechar();
  }
  if (anexo === undefined || anexo.presenca !== 'presente' || anexo.caminho === null || anexo.impressao === null) {
    return { tipo: 'sem-localizacao' };
  }

  let base;
  try {
    base = abrirLocalizacaoSomenteLeitura(dep.estado, inquilinoId);
  } catch (erro) {
    return { tipo: 'inacessivel', motivo: `base da Localizacao indisponivel: ${descreverErro(erro)}` };
  }
  if (base === undefined) return { tipo: 'sem-localizacao' };
  let loc;
  try {
    loc = lerLocalizacoes(base, [anexoId]).get(anexoId);
  } finally {
    base.fechar();
  }
  if (loc === undefined) return { tipo: 'sem-localizacao' };

  if (loc.remoto !== ctx.remoto.remoto) return { tipo: 'inacessivel', motivo: 'a Localizacao e de outro remoto' };
  if (loc.hash !== anexo.impressao || (anexo.tamanho !== null && loc.tamanho !== anexo.tamanho)) {
    return { tipo: 'inacessivel', motivo: 'o Anexo mudou depois do envio' };
  }
  if (loc.tamanho > opcoes.tamanhoMaximo) {
    return { tipo: 'grande-demais', tamanho: loc.tamanho, maximo: opcoes.tamanhoMaximo };
  }

  let bytes: Buffer | null;
  try {
    bytes = await dep.remoto.lerArquivo(alvoRemoto(ctx, loc.caminhoRemoto), {
      tamanhoMaximo: opcoes.tamanhoMaximo,
      prazoMs: opcoes.prazoMs,
      sinal: opcoes.sinal,
    });
  } catch (erro) {
    const motivo = erro instanceof ErroDoRemoto ? erro.message : descreverErro(erro);
    return { tipo: 'inacessivel', motivo };
  }
  if (bytes === null) return { tipo: 'inacessivel', motivo: 'o remoto nao tem o arquivo' };
  if (bytes.length !== loc.tamanho || createHash('sha256').update(bytes).digest('hex') !== loc.hash) {
    return { tipo: 'inacessivel', motivo: 'o conteudo que o remoto devolveu nao confere com a Impressao de Anexo' };
  }
  return { tipo: 'bytes', bytes };
}
