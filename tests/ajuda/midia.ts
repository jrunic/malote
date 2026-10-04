import type { Acervo } from '../../src/nucleo/acervo.js';
import { registrarAnexo, registrarMensagem } from '../../src/nucleo/escrita.js';
import { minuto, subirCenaDeIdentidade, type CenaDeIdentidade, type Sementes } from './identidade.js';

export interface SementesDeMidia {
  imagemDeBruno: string;
  documentoDeBruno: string;
  videoDeDani: string;
  imagemSoltaDeBruno: string;
  audioDeAna: string;
  /** Anexo da Conversa direta de Bruno: nunca aparece na listagem do grupo. */
  imagemNaDireta: string;
  /** O instante (minuto 30) em que tres Anexos de duas Mensagens coincidem. */
  instanteTriplo: number;
}

let contador = 0;

function mensagemComAnexos(
  acervo: Acervo,
  conversaId: string,
  autorId: string,
  quando: number,
  anexos: Array<{ tipo: string; presenca: 'presente' | 'nunca-obtido' | 'descartado'; nomeOriginal?: string }>,
): string[] {
  contador += 1;
  const mensagemId = registrarMensagem(acervo, {
    conversaId,
    fonte: 'whatsapp',
    idExterno: `midia-${contador}`,
    autorId,
    conteudo: `com anexo ${contador}`,
    ocorridaEm: quando,
    agora: Date.now(),
    direcao: 'recebida',
  });
  return anexos.map((a) =>
    registrarAnexo(acervo, {
      mensagemId,
      tipo: a.tipo,
      presenca: a.presenca,
      tamanho: 1000,
      ...(a.nomeOriginal !== undefined ? { nomeOriginal: a.nomeOriginal } : {}),
    }),
  );
}

/**
 * Anexos sobre a cena de identidade do ciclo 30. No grupo, tres Anexos de duas Mensagens no MESMO
 * instante (minuto 30) — o caso que separa o cursor composto de ordenar por Mensagem — e depois um
 * por minuto. Os quatro tipos guardados e as tres presencas aparecem.
 */
export function semearMidia(acervo: Acervo, s: Sementes): SementesDeMidia {
  const [imagemDeBruno, documentoDeBruno] = mensagemComAnexos(acervo, s.grupo, s.bruno, minuto(30), [
    { tipo: 'image', presenca: 'presente' },
    { tipo: 'document', presenca: 'nunca-obtido', nomeOriginal: 'contrato.pdf' },
  ]) as [string, string];
  const [videoDeDani] = mensagemComAnexos(acervo, s.grupo, s.dani, minuto(30), [
    { tipo: 'video', presenca: 'descartado' },
  ]) as [string];
  const [imagemSoltaDeBruno] = mensagemComAnexos(acervo, s.grupo, s.bruno, minuto(31), [
    { tipo: 'image', presenca: 'nunca-obtido' },
  ]) as [string];
  const [audioDeAna] = mensagemComAnexos(acervo, s.grupo, s.ana, minuto(32), [
    { tipo: 'audio', presenca: 'presente' },
  ]) as [string];
  const [imagemNaDireta] = mensagemComAnexos(acervo, s.diretaDeBruno, s.bruno, minuto(5), [
    { tipo: 'image', presenca: 'presente' },
  ]) as [string];
  return {
    imagemDeBruno,
    documentoDeBruno,
    videoDeDani,
    imagemSoltaDeBruno,
    audioDeAna,
    imagemNaDireta,
    instanteTriplo: minuto(30),
  };
}

/** Servidor real sobre a identidade e a midia semeadas. */
export function subirCenaDeMidia(): Promise<CenaDeIdentidade & { extra: SementesDeMidia }> {
  return subirCenaDeIdentidade({ semearMais: semearMidia });
}
