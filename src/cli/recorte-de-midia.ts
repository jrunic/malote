import { expandirData, type FiltroDeAnexosNuncaObtidos } from '../nucleo/consulta.js';
import type { RelatorioDeReprocessamento } from '../adaptadores/whatsapp/reprocessar-midia.js';
import { tipoGuardado } from './anexos-texto.js';
import { opcao, temBandeira } from './bandeiras.js';

/** Os tipos de Anexo que existem no Acervo; `imagem` e `documento` sao apelidos de `malote enviar` (#1248). */
const TIPOS = new Set(['image', 'video', 'audio', 'document', 'sticker', 'other']);

export interface RecorteDeMidia {
  filtro: Omit<FiltroDeAnexosNuncaObtidos, 'fonte'>;
  limite?: number;
  ensaio: boolean;
  tudo: boolean;
  /** Algum filtro ou limite foi dado: o volume esta delimitado e dispensa `--tudo`. */
  temRecorte: boolean;
}

/**
 * Le o recorte de `midia reprocessar` (#1248) das flags. PURO: devolve o erro dito ao operador, e quem chama sai com 2
 * antes de abrir Acervo, Destino ou rede. `--desde` e `--ate` seguem a regra do `anexos` e do `mensagens`: `AAAA-MM-DD`
 * em UTC, inclusivos, sobre o instante da Mensagem.
 */
export function lerRecorteDeMidia(argumentos: string[]): RecorteDeMidia | { erro: string } {
  const filtro: RecorteDeMidia['filtro'] = {};
  const desde = opcao(argumentos, 'desde');
  const ate = opcao(argumentos, 'ate');
  try {
    if (desde !== undefined) filtro.desde = expandirData(desde, 'inicio');
  } catch {
    return { erro: `--desde pede uma data AAAA-MM-DD ou um instante; recebi "${desde}".` };
  }
  try {
    if (ate !== undefined) filtro.ate = expandirData(ate, 'fim');
  } catch {
    return { erro: `--ate pede uma data AAAA-MM-DD ou um instante; recebi "${ate}".` };
  }
  if (filtro.desde !== undefined && filtro.ate !== undefined && filtro.desde > filtro.ate) {
    return { erro: '--desde esta depois de --ate: nenhum Anexo cabe nesse intervalo.' };
  }
  const tipo = opcao(argumentos, 'tipo');
  if (tipo !== undefined) {
    const guardado = tipoGuardado(tipo);
    if (!TIPOS.has(guardado)) {
      return { erro: `--tipo aceita ${[...TIPOS].join(', ')}, imagem ou documento; recebi "${tipo}".` };
    }
    filtro.tipo = guardado;
  }
  const mensagem = opcao(argumentos, 'mensagem');
  if (mensagem !== undefined) filtro.mensagemId = mensagem;

  const limiteTexto = opcao(argumentos, 'limite');
  let limite: number | undefined;
  if (limiteTexto !== undefined) {
    if (!/^[1-9]\d*$/.test(limiteTexto)) return { erro: `--limite pede um inteiro maior que zero; recebi "${limiteTexto}".` };
    limite = Number(limiteTexto);
  }
  return {
    filtro,
    ...(limite === undefined ? {} : { limite }),
    ensaio: temBandeira(argumentos, 'ensaio'),
    tudo: temBandeira(argumentos, 'tudo'),
    temRecorte: Object.keys(filtro).length > 0 || limite !== undefined,
  };
}

const lista = (m: Record<string, number>): string =>
  Object.keys(m).sort().map((k) => `${k} ${m[k]}`).join(', ');

/** As linhas do ensaio: so contagens e rotulos de tipo e de dia, nunca id, caminho ou texto de conversa. */
export function linhasDoEnsaioDeMidia(r: RelatorioDeReprocessamento): string[] {
  const e = r.ensaio;
  if (e === undefined) return [];
  return [
    'Ensaio: nada foi baixado e nada foi escrito.',
    `candidatos: ${e.candidatos}`,
    `elegiveis: ${r.elegiveis} (tentaria ${e.tentaria})`,
    `nao elegiveis: ${r.naoElegiveis} (nao vieram de recepcao ao vivo)`,
    `por tipo: ${lista(e.porTipo) || '-'}`,
    `por dia (UTC): ${lista(e.porDia) || '-'}`,
  ];
}
