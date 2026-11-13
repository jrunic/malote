import { rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  abrirAcervoSomenteLeitura,
  versaoDoAcervoEmDisco,
  VERSAO_SCHEMA_ACERVO,
  type Acervo,
} from '../nucleo/acervo.js';
import { abrirRegistroSomenteLeitura, listarInquilinos } from '../registro/registro.js';
import { lerDestinoDeMidia } from '../registro/destino-midia.js';
import { lerDestinoRemotoDeMidia, type DestinoRemotoDeMidia } from '../registro/destino-remoto.js';
import {
  abrirLocalizacao,
  abrirLocalizacaoSomenteLeitura,
  amostrarSemCopiaLocal,
  candidatasAPerderACopiaLocal,
  idsComDivergencia,
  lerLocalizacoes,
  lerPassadas,
  limparDivergencia,
  marcarCopiaLocalRemovida,
  recriarLocalizacao,
  registrarDivergencia,
  registrarConferencia,
  registrarDuplicatas,
  registrarFalhaDeEnvio,
  registrarLocalizacao,
  registrarPassada,
  removerLocalizacao,
  resumoDaLocalizacao,
  type Localizacao,
} from '../registro/localizacao.js';
import {
  listarAnexosDescartados,
  listarAnexosPresentes,
  resumoDePresentes,
  situacaoDosAnexos,
  type AnexoPresente,
} from '../nucleo/anexos-presentes.js';
import { caminhoRemoto } from '../nucleo/layout-remoto.js';
import {
  arquivoMaduro,
  corteDaJanela,
  decidirApagarCopiaLocal,
  reduzirRitmo,
  type Ritmo,
} from '../nucleo/regras-de-armazenamento.js';
import { ErroDoRemoto, type AlvoRemoto, type ItemRemoto, type Remoto } from './motor-de-armazenamento.js';

/**
 * O Servico de Armazenamento: sobe a midia para o Destino Remoto, verifica pelo
 * hash de conteudo e so entao deixa a copia local sair do disco. Aqui fica a
 * LOGICA; o processo longo e os comandos sao de `armazenamento.ts`.
 *
 * Regras que nao se negociam:
 * - So le o Acervo (somente leitura: abrir para escrita MIGRA) e so escreve na
 *   base da Localizacao. A Presenca do Anexo nunca muda por causa dele.
 * - A copia local so sai com a Localizacao verificada ha mais que a Janela, a
 *   trava do Destino Remoto liberada, o remoto REVERIFICADO imediatamente antes,
 *   e o audio que a transcricao ainda vai ler a salvo.
 * - O remoto que perde ou muda um arquivo vira `divergencia` visivel; o servico
 *   nunca apaga nada para "corrigir" duplicata nem divergencia.
 * - Sem dado pessoal em linha de log: so identificadores gerados pelo produto.
 */

export interface DependenciasDoServico {
  dados: string;
  estado: string;
  remoto: Remoto;
  agora: () => number;
  dormir: (ms: number) => Promise<void>;
  escrever: (linha: string) => void;
  /** Pedido de parada do processo: as passadas terminam entre dois arquivos. */
  parou?: () => boolean;
}

export interface ContextoDoInquilino {
  inquilinoId: string;
  destinoLocal: string;
  remoto: DestinoRemotoDeMidia;
}

const PREFIXO = '[armazenamento]';
const TAMANHO_DA_PAGINA = 1_000;
const TAMANHO_DO_LOTE_DE_APAGAR = 500;

export function inquilinosComDestinoRemoto(dep: DependenciasDoServico): string[] {
  const registro = abrirRegistroSomenteLeitura(dep.dados);
  try {
    return listarInquilinos(registro)
      .filter((i) => lerDestinoRemotoDeMidia(registro, i.id) !== undefined)
      .map((i) => i.id);
  } finally {
    registro.fechar();
  }
}

export function contextoDoInquilino(
  dep: DependenciasDoServico,
  inquilinoId: string,
  opcoes: { avisar?: boolean } = {},
): ContextoDoInquilino | undefined {
  const registro = abrirRegistroSomenteLeitura(dep.dados);
  try {
    const local = lerDestinoDeMidia(registro, inquilinoId);
    const remoto = lerDestinoRemotoDeMidia(registro, inquilinoId);
    if (local === undefined || remoto === undefined) {
      if (opcoes.avisar !== false) {
        dep.escrever(`${PREFIXO} Inquilino ${inquilinoId}: sem Destino de Midia e Destino Remoto declarados. Pulado.`);
      }
      return undefined;
    }
    return { inquilinoId, destinoLocal: local.endereco, remoto };
  } finally {
    registro.fechar();
  }
}

export function abrirAcervoParaLer(dep: DependenciasDoServico, inquilinoId: string): Acervo | undefined {
  const pasta = join(dep.dados, 'acervos');
  const versao = versaoDoAcervoEmDisco(pasta, inquilinoId);
  if (versao !== VERSAO_SCHEMA_ACERVO) {
    dep.escrever(
      `${PREFIXO} Inquilino ${inquilinoId}: Acervo na forma ${String(versao)}, esperava ${VERSAO_SCHEMA_ACERVO}. ` +
        'Pulado — rode "malote acervo migrar" antes.',
    );
    return undefined;
  }
  return abrirAcervoSomenteLeitura(pasta, inquilinoId);
}

const iso = (ms: number): string => new Date(ms).toISOString();

export function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message.slice(0, 200) : String(erro).slice(0, 200);
}

export function alvoRemoto(ctx: ContextoDoInquilino, relativo: string, remoto = ctx.remoto.remoto): AlvoRemoto {
  return { remoto, pasta: ctx.remoto.pastaBase, relativo };
}

class ErroDeVerificacao extends Error {}

/** `null` quando o remoto tem o arquivo certo: o hash dele e o da Impressao de Anexo, e o tamanho confere. */
function problemaDaVerificacao(item: ItemRemoto | null, esperado: { tamanho: number; impressao: string }): string | null {
  if (item === null) return 'o remoto nao tem o arquivo depois do envio';
  if (item.sha256 === null) return 'o remoto nao entregou o hash do arquivo';
  if (item.sha256 !== esperado.impressao) return 'o hash do remoto difere da Impressao de Anexo';
  if (item.tamanho !== esperado.tamanho) return 'o tamanho do remoto difere do Anexo';
  return null;
}

/** Espaca as chamadas ao remoto: no maximo `chamadasPorSegundo`, contadas pela largada de cada uma. */
function criarLimitador(chamadasPorSegundo: number, dep: DependenciasDoServico): () => Promise<void> {
  const intervalo = 1000 / chamadasPorSegundo;
  let proxima = 0;
  return async () => {
    const agora = dep.agora();
    const espera = Math.max(0, proxima - agora);
    proxima = Math.max(agora, proxima) + intervalo;
    if (espera > 0) await dep.dormir(espera);
  };
}

/**
 * Executa os itens com no maximo `limite()` em voo. Respeita o pedido de parada: nao LANCA item novo depois dele, e
 * espera os que ja estao em voo terminarem (a promessa de "parar depois do arquivo em andamento"). Se um item lancar,
 * para de lancar, ESPERA os outros e so entao propaga o primeiro erro: promessa em voo sem observador derrubaria o
 * processo por rejeicao nao tratada.
 */
async function executarComConcorrencia<T>(
  itens: readonly T[],
  limite: () => number,
  trabalho: (item: T) => Promise<void>,
  parou?: () => boolean,
): Promise<void> {
  let indice = 0;
  let falhou = false;
  let primeiroErro: unknown;
  const emVoo = new Set<Promise<void>>();
  const podeLancar = (): boolean => indice < itens.length && !falhou && parou?.() !== true;
  while (podeLancar() || emVoo.size > 0) {
    while (podeLancar() && emVoo.size < Math.max(1, limite())) {
      const p: Promise<void> = trabalho(itens[indice++] as T)
        .catch((erro: unknown) => {
          if (!falhou) {
            falhou = true;
            primeiroErro = erro;
          }
        })
        .finally(() => {
          emVoo.delete(p);
        });
      emVoo.add(p);
    }
    if (emVoo.size > 0) await Promise.race(emVoo);
  }
  if (falhou) throw primeiroErro;
}

// ---------------------------------------------------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------------------------------------------------

export type GrupoDeTipos = 'video' | 'resto' | 'todos';

export interface OpcoesDaPassadaDeEnvio {
  grupo?: GrupoDeTipos;
  /** No maximo este numero de arquivos NESTA passada (a passada limitada nao grava o estado de pendentes). */
  limite?: number;
  /** Conta o que subiria, sem falar com o remoto e sem criar a base da Localizacao. */
  ensaio?: boolean;
}

export interface ResumoDaPassadaDeEnvio {
  grupo: GrupoDeTipos;
  examinados: number;
  jaEnviados: number;
  enviados: number;
  adiados: number;
  /** Falha do envio em si (erro do remoto, hash que nao confere). O limite de cota NAO entra aqui. */
  falhos: number;
  /** Vezes que o remoto pediu para ir mais devagar: o ritmo cai e o Anexo sobe na passada seguinte, sem contar como falha. */
  limitesDeCota: number;
  bytesEnviados: number;
  ensaio: boolean;
  interrompida: boolean;
}

function noGrupo(grupo: GrupoDeTipos, tipo: string): boolean {
  if (grupo === 'todos') return true;
  return grupo === 'video' ? tipo === 'video' : tipo !== 'video';
}

export async function passadaDeEnvio(
  dep: DependenciasDoServico,
  inquilinoId: string,
  opcoes: OpcoesDaPassadaDeEnvio = {},
): Promise<ResumoDaPassadaDeEnvio> {
  const grupo = opcoes.grupo ?? 'todos';
  const ensaio = opcoes.ensaio === true;
  const resumo: ResumoDaPassadaDeEnvio = {
    grupo,
    examinados: 0,
    jaEnviados: 0,
    enviados: 0,
    adiados: 0,
    falhos: 0,
    limitesDeCota: 0,
    bytesEnviados: 0,
    ensaio,
    interrompida: false,
  };
  const ctx = contextoDoInquilino(dep, inquilinoId);
  if (ctx === undefined) return resumo;
  const acervo = abrirAcervoParaLer(dep, inquilinoId);
  if (acervo === undefined) return resumo;
  const base = ensaio ? abrirLocalizacaoSomenteLeitura(dep.estado, inquilinoId) : abrirLocalizacao(dep.estado, inquilinoId);

  const pendentes = { quantos: 0, bytes: 0, maisAntigoMs: null as number | null };
  const contarPendente = (tamanho: number, modificadoEmMs: number | null): void => {
    pendentes.quantos += 1;
    pendentes.bytes += tamanho;
    if (modificadoEmMs !== null && (pendentes.maisAntigoMs === null || modificadoEmMs < pendentes.maisAntigoMs)) {
      pendentes.maisAntigoMs = modificadoEmMs;
    }
  };
  const modificadoEm = new Map<string, number>();
  let ritmo: Ritmo = { transferencias: ctx.remoto.transferencias, esperaMs: 0 };
  const limitar = criarLimitador(ctx.remoto.chamadasPorSegundo, dep);
  let aceitosNaPassada = 0;

  interface Tarefa {
    a: AnexoPresente;
    relativo: string;
  }

  async function enviarUm({ a, relativo }: Tarefa): Promise<void> {
    const alvo = alvoRemoto(ctx as ContextoDoInquilino, relativo);
    try {
      await limitar();
      await dep.remoto.copiarArquivo({ raiz: (ctx as ContextoDoInquilino).destinoLocal, relativo: a.caminho }, alvo, a.tamanho);
      await limitar();
      const item = await dep.remoto.statArquivo(alvo);
      const problema = problemaDaVerificacao(item, a);
      if (problema !== null || item === null || item.sha256 === null) throw new ErroDeVerificacao(problema ?? 'item invalido');
      registrarLocalizacao(base as Localizacao, {
        anexoId: a.id,
        remoto: alvo.remoto,
        caminhoRemoto: alvo.relativo,
        idNoRemoto: item.id,
        tamanho: item.tamanho,
        hash: item.sha256,
        verificadaEm: iso(dep.agora()),
      });
      resumo.enviados += 1;
      resumo.bytesEnviados += a.tamanho;
    } catch (erro) {
      contarPendente(a.tamanho, modificadoEm.get(a.id) ?? null);
      if (erro instanceof ErroDoRemoto && erro.limiteDeCota) {
        // O remoto pediu para ir mais devagar: NAO e falha do envio (o criterio 13 diz "sem falhar o envio").
        resumo.limitesDeCota += 1;
        ritmo = reduzirRitmo(ritmo);
        dep.escrever(
          `${PREFIXO} Inquilino ${inquilinoId}: o remoto pediu para ir mais devagar; ` +
            `${ritmo.transferencias} transferencia(s) e espera de ${ritmo.esperaMs} ms. O Anexo sobe na passada seguinte.`,
        );
        await dep.dormir(ritmo.esperaMs);
        return;
      }
      resumo.falhos += 1;
      const motivo = descreverErro(erro);
      registrarFalhaDeEnvio(base as Localizacao, a.id, motivo, iso(dep.agora()));
      dep.escrever(`${PREFIXO} Anexo ${a.id} (Inquilino ${inquilinoId}): envio falhou — ${motivo}`);
    }
  }

  try {
    let depois = '';
    for (;;) {
      if (dep.parou?.() === true) {
        resumo.interrompida = true;
        break;
      }
      const pagina = listarAnexosPresentes(acervo, { depoisDoId: depois, limite: TAMANHO_DA_PAGINA });
      if (pagina.length === 0) break;
      depois = (pagina[pagina.length - 1] as AnexoPresente).id;
      const doGrupo = pagina.filter((a) => noGrupo(grupo, a.tipo));
      resumo.examinados += doGrupo.length;
      const ids = doGrupo.map((a) => a.id);
      const existentes = base === undefined ? new Map() : lerLocalizacoes(base, ids);
      const divergentes = base === undefined ? new Set<string>() : idsComDivergencia(base, ids);

      const tarefas: Tarefa[] = [];
      for (const a of doGrupo) {
        const l = existentes.get(a.id);
        // Ja enviado e conferido: nao sobe de novo. EXCETO o que a conferencia achou errado no remoto e ainda tem copia
        // local: esse volta para a fila (o remoto se cura; a divergencia sai quando a Localizacao e registrada de novo).
        const precisaReenviar = l !== undefined && divergentes.has(a.id) && l.copiaLocalRemovidaEm === null;
        if (l !== undefined && l.hash === a.impressao && !precisaReenviar) {
          resumo.jaEnviados += 1;
          continue;
        }
        let relativo: string;
        try {
          relativo = caminhoRemoto(a.caminho);
        } catch (erro) {
          resumo.adiados += 1;
          contarPendente(a.tamanho, null);
          dep.escrever(`${PREFIXO} Anexo ${a.id} (Inquilino ${inquilinoId}): caminho local fora da forma, nao enviado — ${descreverErro(erro)}`);
          continue;
        }
        let st;
        try {
          st = statSync(join(ctx.destinoLocal, a.caminho));
        } catch {
          resumo.adiados += 1;
          contarPendente(a.tamanho, null);
          dep.escrever(`${PREFIXO} Anexo ${a.id} (Inquilino ${inquilinoId}): arquivo local ausente, nao enviado.`);
          continue;
        }
        modificadoEm.set(a.id, st.mtimeMs);
        if (st.size !== a.tamanho || !arquivoMaduro(dep.agora(), st.mtimeMs)) {
          resumo.adiados += 1;
          contarPendente(a.tamanho, st.mtimeMs);
          continue;
        }
        if (ensaio || (opcoes.limite !== undefined && aceitosNaPassada >= opcoes.limite)) {
          contarPendente(a.tamanho, st.mtimeMs);
          continue;
        }
        aceitosNaPassada += 1;
        tarefas.push({ a, relativo });
      }
      await executarComConcorrencia(tarefas, () => ritmo.transferencias, enviarUm, dep.parou);
      if (dep.parou?.() === true) {
        resumo.interrompida = true;
        break;
      }
    }

    if (!ensaio && !resumo.interrompida && opcoes.limite === undefined && base !== undefined) {
      registrarPassada(base, {
        grupo,
        concluidaEm: iso(dep.agora()),
        pendentes: pendentes.quantos,
        bytesPendentes: pendentes.bytes,
        maisAntigoMs: pendentes.maisAntigoMs,
      });
    }
    return resumo;
  } finally {
    acervo.fechar();
    base?.fechar();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Apagar a copia local
// ---------------------------------------------------------------------------------------------------------------------

export interface ResumoDaPassadaDeApagar {
  /** A trava do Destino Remoto estava fechada: nada foi examinado. */
  trava: boolean;
  apagadas: number;
  adiadas: number;
  /** Casos em que o remoto nao tem o arquivo certo: a copia local FICA. */
  divergencias: number;
  /** A copia local ja nao estava la (retencao, ou apagada por fora): so se registrou. */
  jaAusentes: number;
}

function dentroDoDestino(destino: string, absoluto: string): boolean {
  return absoluto.startsWith(resolve(destino) + sep);
}

export async function passadaDeApagarCopiaLocal(
  dep: DependenciasDoServico,
  inquilinoId: string,
): Promise<ResumoDaPassadaDeApagar> {
  const resumo: ResumoDaPassadaDeApagar = { trava: false, apagadas: 0, adiadas: 0, divergencias: 0, jaAusentes: 0 };
  const ctx = contextoDoInquilino(dep, inquilinoId);
  if (ctx === undefined) return resumo;
  if (!ctx.remoto.apagarLocal) {
    resumo.trava = true;
    return resumo;
  }
  const acervo = abrirAcervoParaLer(dep, inquilinoId);
  if (acervo === undefined) return resumo;
  const base = abrirLocalizacao(dep.estado, inquilinoId);
  const limitar = criarLimitador(ctx.remoto.chamadasPorSegundo, dep);
  let ritmo: Ritmo = { transferencias: 1, esperaMs: 0 };
  try {
    let depois = '';
    let parar = false;
    while (!parar) {
      if (dep.parou?.() === true) break;
      const inicio = contextoDoInquilino(dep, inquilinoId);
      if (inicio === undefined || !inicio.remoto.apagarLocal) {
        resumo.trava = true;
        break;
      }
      const corte = corteDaJanela(dep.agora(), inicio.remoto.janelaDias);
      const candidatas = candidatasAPerderACopiaLocal(base, corte, TAMANHO_DO_LOTE_DE_APAGAR, depois);
      if (candidatas.length === 0) break;
      depois = (candidatas[candidatas.length - 1] as { anexoId: string }).anexoId;
      const situacoes = situacaoDosAnexos(acervo, candidatas.map((c) => c.anexoId));

      for (const c of candidatas) {
        if (dep.parou?.() === true) {
          parar = true;
          break;
        }
        // A trava e o Destino sao RELIDOS A CADA ARQUIVO: a primeira passada depois de liberar a trava percorre o estoque
        // inteiro (horas), e fechar a trava no meio tem de valer no arquivo seguinte ("nenhum byte sai sem o aval do Titular").
        // Cada reverificacao no remoto custa ~0,3 s, entao abrir o Registro de novo e desprezivel.
        const vigente = contextoDoInquilino(dep, inquilinoId);
        if (vigente === undefined || !vigente.remoto.apagarLocal) {
          resumo.trava = true;
          parar = true;
          break;
        }
        if (c.remoto !== vigente.remoto.remoto) {
          // Verificada em OUTRO remoto: a Localizacao nao diz nada sobre o Destino de agora.
          resumo.adiadas += 1;
          continue;
        }
        const s = situacoes.get(c.anexoId);
        if (s === undefined || s.presenca !== 'presente' || s.caminho === null) {
          // A retencao (ou outra via) ja tirou o arquivo local: so se registra, para a candidata sair da lista.
          marcarCopiaLocalRemovida(base, c.anexoId, iso(dep.agora()));
          resumo.jaAusentes += 1;
          continue;
        }
        const decisao = decidirApagarCopiaLocal({
          apagarLocalLiberado: true,
          janelaDias: vigente.remoto.janelaDias,
          agora: dep.agora(),
          verificadaEm: c.verificadaEm,
          transcricaoPorFazer: s.transcricaoPorFazer,
        });
        if (!decisao.apagar) {
          resumo.adiadas += 1;
          continue;
        }

        // A Localizacao verificou UM conteudo. Se a Impressao de Anexo do Acervo mudou depois (arquivo regravado), a copia
        // local de agora NAO e a que esta no remoto: apagar seria perder o arquivo novo. Mantem e acusa.
        if (s.impressao !== c.hash) {
          registrarDivergencia(base, c.anexoId, 'a Impressao de Anexo mudou depois do envio', iso(dep.agora()));
          resumo.divergencias += 1;
          dep.escrever(`${PREFIXO} Anexo ${c.anexoId} (Inquilino ${inquilinoId}): copia local MANTIDA — a Impressao de Anexo mudou depois do envio.`);
          continue;
        }

        // REVERIFICA no remoto imediatamente antes: a Localizacao e cache, e apagar sem o remoto inteiro e perda definitiva.
        let item: ItemRemoto | null;
        try {
          await limitar();
          item = await dep.remoto.statArquivo(alvoRemoto(vigente, c.caminhoRemoto, c.remoto));
        } catch (erro) {
          resumo.adiadas += 1;
          dep.escrever(`${PREFIXO} Anexo ${c.anexoId} (Inquilino ${inquilinoId}): nao deu para reverificar — ${descreverErro(erro)}`);
          if (erro instanceof ErroDoRemoto && erro.limiteDeCota) {
            ritmo = reduzirRitmo(ritmo);
            await dep.dormir(ritmo.esperaMs);
          }
          continue;
        }
        const problema = problemaDaVerificacao(item, { tamanho: c.tamanho, impressao: c.hash });
        if (problema !== null) {
          registrarDivergencia(base, c.anexoId, problema, iso(dep.agora()));
          resumo.divergencias += 1;
          dep.escrever(`${PREFIXO} Anexo ${c.anexoId} (Inquilino ${inquilinoId}): copia local MANTIDA — ${problema}.`);
          continue;
        }

        const absoluto = resolve(vigente.destinoLocal, s.caminho);
        if (!dentroDoDestino(vigente.destinoLocal, absoluto)) {
          resumo.adiadas += 1;
          dep.escrever(`${PREFIXO} Anexo ${c.anexoId} (Inquilino ${inquilinoId}): caminho fora do Destino de Midia, nao apagado.`);
          continue;
        }
        try {
          if (statSync(absoluto).size !== c.tamanho) {
            registrarDivergencia(base, c.anexoId, 'o arquivo local difere do que foi verificado', iso(dep.agora()));
            resumo.divergencias += 1;
            continue;
          }
          rmSync(absoluto);
          resumo.apagadas += 1;
        } catch (erro) {
          if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
            resumo.jaAusentes += 1;
          } else {
            resumo.adiadas += 1;
            dep.escrever(`${PREFIXO} Anexo ${c.anexoId} (Inquilino ${inquilinoId}): nao deu para apagar — ${descreverErro(erro)}`);
            continue;
          }
        }
        marcarCopiaLocalRemovida(base, c.anexoId, iso(dep.agora()));
      }
    }
    return resumo;
  } finally {
    acervo.fechar();
    base.fechar();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Anexos descartados pela retencao
// ---------------------------------------------------------------------------------------------------------------------

export interface ResumoDaPassadaDeDescartados {
  removidos: number;
  falhos: number;
}

/** O Anexo que a Politica de Retencao descartou perde tambem a copia remota (vai para a lixeira do remoto, se ele a tem). */
export async function passadaDeDescartados(
  dep: DependenciasDoServico,
  inquilinoId: string,
): Promise<ResumoDaPassadaDeDescartados> {
  const resumo: ResumoDaPassadaDeDescartados = { removidos: 0, falhos: 0 };
  const ctx = contextoDoInquilino(dep, inquilinoId);
  if (ctx === undefined) return resumo;
  const acervo = abrirAcervoParaLer(dep, inquilinoId);
  if (acervo === undefined) return resumo;
  const base = abrirLocalizacao(dep.estado, inquilinoId);
  const limitar = criarLimitador(ctx.remoto.chamadasPorSegundo, dep);
  try {
    let depois = '';
    for (;;) {
      if (dep.parou?.() === true) break;
      const pagina = listarAnexosDescartados(acervo, { depoisDoId: depois, limite: TAMANHO_DO_LOTE_DE_APAGAR });
      if (pagina.length === 0) break;
      depois = (pagina[pagina.length - 1] as { id: string }).id;
      const localizacoes = lerLocalizacoes(base, pagina.map((a) => a.id));
      for (const [anexoId, l] of localizacoes) {
        try {
          await limitar();
          await dep.remoto.apagarArquivo(alvoRemoto(ctx, l.caminhoRemoto, l.remoto));
        } catch (erro) {
          if (!(erro instanceof ErroDoRemoto && erro.status === 404)) {
            resumo.falhos += 1;
            dep.escrever(`${PREFIXO} Anexo ${anexoId} (Inquilino ${inquilinoId}): nao deu para apagar no remoto — ${descreverErro(erro)}`);
            continue;
          }
        }
        removerLocalizacao(base, anexoId);
        resumo.removidos += 1;
      }
    }
    return resumo;
  } finally {
    acervo.fechar();
    base.fechar();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Conferencia periodica
// ---------------------------------------------------------------------------------------------------------------------

export interface ResumoDaConferencia {
  conferidos: number;
  divergentes: number;
}

/** Confere por amostra que os arquivos que so existem no remoto continuam la, inteiros. */
export async function conferirPorAmostra(
  dep: DependenciasDoServico,
  inquilinoId: string,
  quantidade: number,
): Promise<ResumoDaConferencia> {
  const resumo: ResumoDaConferencia = { conferidos: 0, divergentes: 0 };
  const ctx = contextoDoInquilino(dep, inquilinoId);
  if (ctx === undefined) return resumo;
  const base = abrirLocalizacao(dep.estado, inquilinoId);
  const limitar = criarLimitador(ctx.remoto.chamadasPorSegundo, dep);
  try {
    for (const l of amostrarSemCopiaLocal(base, quantidade)) {
      if (dep.parou?.() === true) break;
      let item: ItemRemoto | null;
      try {
        await limitar();
        item = await dep.remoto.statArquivo(alvoRemoto(ctx, l.caminhoRemoto, l.remoto));
      } catch (erro) {
        dep.escrever(`${PREFIXO} Anexo ${l.anexoId} (Inquilino ${inquilinoId}): nao deu para conferir — ${descreverErro(erro)}`);
        continue;
      }
      resumo.conferidos += 1;
      const problema = problemaDaVerificacao(item, { tamanho: l.tamanho, impressao: l.hash });
      if (problema === null) {
        limparDivergencia(base, l.anexoId);
      } else {
        registrarDivergencia(base, l.anexoId, problema, iso(dep.agora()));
        resumo.divergentes += 1;
        dep.escrever(`${PREFIXO} Anexo ${l.anexoId} (Inquilino ${inquilinoId}): DIVERGENCIA no remoto — ${problema}.`);
      }
    }
    registrarConferencia(base, iso(dep.agora()));
    return resumo;
  } finally {
    base.fechar();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reconstrucao da base
// ---------------------------------------------------------------------------------------------------------------------

export interface ResumoDaReconstrucao {
  /** Preenchido quando a reconstrucao foi RECUSADA (a base nao foi tocada): a razao, para o Operador. */
  recusada: string | null;
  restauradas: number;
  duplicatas: number;
  /** O arquivo remoto existe mas o hash ou o tamanho nao bate com o Acervo: nao vira Localizacao. */
  divergentes: number;
  /** Arquivos do remoto que nenhum Anexo presente reclama. */
  semAnexo: number;
}

/**
 * Apaga a base da Localizacao e a refaz pela listagem do remoto, conferida contra o Acervo. O arquivo remoto e o
 * Acervo nao sao tocados. A copia local ausente vira "removida agora": a data real se perdeu com a base.
 */
export async function reconstruirLocalizacao(
  dep: DependenciasDoServico,
  inquilinoId: string,
  opcoes: { confirmar?: boolean } = {},
): Promise<ResumoDaReconstrucao> {
  const resumo: ResumoDaReconstrucao = { recusada: null, restauradas: 0, duplicatas: 0, divergentes: 0, semAnexo: 0 };
  const ctx = contextoDoInquilino(dep, inquilinoId);
  if (ctx === undefined) return resumo;
  const acervo = abrirAcervoParaLer(dep, inquilinoId);
  if (acervo === undefined) return resumo;

  const itens = await dep.remoto.listarArquivos(alvoRemoto(ctx, inquilinoId));
  const porCaminho = new Map<string, ItemRemoto[]>();
  for (const i of itens) porCaminho.set(i.caminho, [...(porCaminho.get(i.caminho) ?? []), i]);

  // Listagem VAZIA com a base cheia e quase sempre pasta-base trocada, remoto errado ou credencial sem acesso: recriar
  // apagaria milhares de Localizacoes (e o que ja saiu do disco passaria a "arquivo local ausente"). So com confirmacao.
  const existente = abrirLocalizacaoSomenteLeitura(dep.estado, inquilinoId);
  const linhasAtuais = existente === undefined ? 0 : resumoDaLocalizacao(existente).enviados;
  existente?.fechar();
  if (itens.length === 0 && linhasAtuais > 0 && opcoes.confirmar !== true) {
    acervo.fechar();
    resumo.recusada =
      `a listagem do remoto veio VAZIA e a base tem ${linhasAtuais} Localizacao(oes): confira o remoto, a pasta-base ` +
      'e a credencial; se for isso mesmo, repita com --confirmo.';
    return resumo;
  }
  const base = recriarLocalizacao(dep.estado, inquilinoId);
  const reclamados = new Set<string>();
  try {
    let depois = '';
    for (;;) {
      const pagina = listarAnexosPresentes(acervo, { depoisDoId: depois, limite: TAMANHO_DA_PAGINA });
      if (pagina.length === 0) break;
      depois = (pagina[pagina.length - 1] as AnexoPresente).id;
      for (const a of pagina) {
        let relativo: string;
        try {
          relativo = caminhoRemoto(a.caminho);
        } catch {
          resumo.divergentes += 1;
          continue;
        }
        const candidatos = porCaminho.get(relativo);
        if (candidatos === undefined) continue;
        reclamados.add(relativo);
        const certos = candidatos.filter((c) => problemaDaVerificacao(c, a) === null);
        const certo = certos[0];
        if (certo === undefined || certo.sha256 === null) {
          resumo.divergentes += 1;
          continue;
        }
        registrarLocalizacao(base, {
          anexoId: a.id,
          remoto: ctx.remoto.remoto,
          caminhoRemoto: relativo,
          idNoRemoto: certo.id,
          tamanho: certo.tamanho,
          hash: certo.sha256,
          verificadaEm: iso(dep.agora()),
        });
        resumo.restauradas += 1;
        if (candidatos.length > 1) {
          registrarDuplicatas(base, a.id, candidatos.length - 1);
          resumo.duplicatas += candidatos.length - 1;
        }
        let localExiste = true;
        try {
          statSync(join(ctx.destinoLocal, a.caminho));
        } catch {
          localExiste = false;
        }
        if (!localExiste) marcarCopiaLocalRemovida(base, a.id, iso(dep.agora()));
      }
    }
    resumo.semAnexo = [...porCaminho.keys()].filter((c) => !reclamados.has(c)).length;
    return resumo;
  } finally {
    acervo.fechar();
    base.fechar();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------------------------------------------------

export interface EstadoDoArmazenamento {
  inquilino: string;
  remoto: string;
  pastaBase: string;
  janelaDias: number;
  apagarLocal: boolean;
  presentes: number;
  enviados: number;
  /**
   * Presentes menos enviados: a conta do Acervo, uma APROXIMACAO (conta como enviada a Localizacao de Anexo que a retencao
   * ja descartou e a de arquivo regravado a reenviar). O detalhe por passada esta em `passadas`.
   */
  pendentes: number;
  falhos: number;
  duplicatas: number;
  divergencias: number;
  bytesEnviados: number;
  copiasLocaisRemovidas: number;
  /** Idade, em segundos, do arquivo local pendente mais antigo visto na ultima passada de cada grupo; null se nenhum. */
  idadeDoPendenteMaisAntigoSegundos: number | null;
  ultimaVerificacaoEm: string | null;
  /** A verificacao mais antiga de Anexo que ainda tem copia local: a frota compara com os 3 dias da Escolha 5 (trava fechada). */
  verificacaoMaisAntigaComCopiaLocalEm: string | null;
  /** Quando a divergencia mais antiga foi detectada (a idade do criterio 17). */
  divergenciaMaisAntigaEm: string | null;
  /** O instante da ultima conferencia por amostra: sem ele a frota nao sabe se a conferencia roda. */
  ultimaConferenciaEm: string | null;
  passadas: Array<{ grupo: string; concluidaEm: string; pendentes: number; bytesPendentes: number }>;
}

/** Le tudo em modo somente leitura: nunca cria a base, nunca abre o Acervo para escrita. `undefined` sem Destino Remoto. */
export function estadoDoArmazenamento(dep: DependenciasDoServico, inquilinoId: string): EstadoDoArmazenamento | undefined {
  const ctx = contextoDoInquilino(dep, inquilinoId);
  if (ctx === undefined) return undefined;
  const acervo = abrirAcervoParaLer(dep, inquilinoId);
  if (acervo === undefined) return undefined;
  const base = abrirLocalizacaoSomenteLeitura(dep.estado, inquilinoId);
  try {
    const presentes = resumoDePresentes(acervo);
    const resumo =
      base === undefined
        ? {
            enviados: 0,
            bytesEnviados: 0,
            copiasLocaisRemovidas: 0,
            duplicatas: 0,
            falhos: 0,
            divergencias: 0,
            ultimaVerificacaoEm: null,
            verificacaoMaisAntigaComCopiaLocalEm: null,
            divergenciaMaisAntigaEm: null,
            ultimaConferenciaEm: null,
          }
        : resumoDaLocalizacao(base);
    const passadas = base === undefined ? [] : lerPassadas(base);
    const maisAntigo = passadas.reduce<number | null>(
      (acc, p) => (p.maisAntigoMs === null ? acc : acc === null ? p.maisAntigoMs : Math.min(acc, p.maisAntigoMs)),
      null,
    );
    return {
      inquilino: inquilinoId,
      remoto: ctx.remoto.remoto,
      pastaBase: ctx.remoto.pastaBase,
      janelaDias: ctx.remoto.janelaDias,
      apagarLocal: ctx.remoto.apagarLocal,
      presentes: presentes.anexos,
      enviados: resumo.enviados,
      pendentes: Math.max(0, presentes.anexos - resumo.enviados),
      falhos: resumo.falhos,
      duplicatas: resumo.duplicatas,
      divergencias: resumo.divergencias,
      bytesEnviados: resumo.bytesEnviados,
      copiasLocaisRemovidas: resumo.copiasLocaisRemovidas,
      idadeDoPendenteMaisAntigoSegundos: maisAntigo === null ? null : Math.max(0, Math.round((dep.agora() - maisAntigo) / 1000)),
      ultimaVerificacaoEm: resumo.ultimaVerificacaoEm,
      verificacaoMaisAntigaComCopiaLocalEm: resumo.verificacaoMaisAntigaComCopiaLocalEm,
      divergenciaMaisAntigaEm: resumo.divergenciaMaisAntigaEm,
      ultimaConferenciaEm: resumo.ultimaConferenciaEm,
      passadas: passadas.map((p) => ({
        grupo: p.grupo,
        concluidaEm: p.concluidaEm,
        pendentes: p.pendentes,
        bytesPendentes: p.bytesPendentes,
      })),
    };
  } finally {
    acervo.fechar();
    base?.fechar();
  }
}
