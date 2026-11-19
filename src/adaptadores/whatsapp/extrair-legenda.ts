import type { Acervo } from '../../nucleo/acervo.js';
import {
  escreverTextoDeMensagem,
  indiceDeBuscaEstaIntegro,
  listarCandidatasDeTextoPeloAnexo,
  listarCandidatasDeTextoPeloBruto,
} from '../../nucleo/texto-da-mensagem.js';
import { emOperacao } from '../../nucleo/trilha.js';
import { legendaETipoDoBrutoAoVivo, legendaDoRegistroDeMidia } from './legenda.js';

const FONTE = 'whatsapp' as const;
const PAGINA = 1000;
const LOTE_PADRAO = 500;
/** O Conteudo Bruto do evento ao vivo comeca assim; o da linha do backup, com `{"Z`. Separa as duas formas sem ler o JSON. */
const COMECO_AO_VIVO = '{"key"';
const COMECO_DO_BACKUP = '{"Z';

export interface OpcoesDoEstoqueDeLegenda {
  comEfeito: boolean;
  /** No maximo este numero de Mensagens. Inteiro maior que zero. */
  limite?: number;
  /** Mensagens por transacao (padrao 500). Uma transacao por lote, para nao segurar o escritor do ouvinte. */
  tamanhoDoLote?: number;
  /** Chamado ao fim de cada lote, com quantas Mensagens ele tinha: o progresso de uma varredura longa. */
  aoTerminarLote?: (mensagens: number) => void;
}

/** O indice de busca por texto nao esta de acordo com as Mensagens: o comando nao escreve (escrever por cima o corromperia). */
export class IndiceDeBuscaDefasadoError extends Error {
  constructor() {
    super('o indice de busca por texto nao esta de acordo com as Mensagens: nada foi escrito');
    this.name = 'IndiceDeBuscaDefasadoError';
  }
}

/**
 * Um lote falhou (o escritor do ouvinte nao liberou, por exemplo) com a Operacao ja aberta: os lotes anteriores ficaram
 * gravados. Repetir o comando completa o que falta, mas numa SEGUNDA Operacao: a volta inteira pede o `desfazer` das duas.
 */
export class EstoqueDeLegendaInterrompidoError extends Error {
  constructor(
    readonly operacaoId: string,
    readonly gravadas: number,
    readonly causa: unknown,
  ) {
    super(`o estoque da legenda parou com ${gravadas} Mensagem(ns) ja gravada(s) na Operacao ${operacaoId}: ${String(causa)}`);
    this.name = 'EstoqueDeLegendaInterrompidoError';
  }
}

export interface RelatorioDoEstoqueDeLegenda {
  /** Legendas a gravar (ensaio) ou tentadas (efeito), por origem e tipo. So contagens: texto de legenda nunca vai a relatorio. */
  aoVivo: { imagem: number; video: number; documento: number };
  backup: { imagem: number; video: number };
  aGravar: number;
  /** Legendas de fato gravadas. Zero no ensaio. */
  gravadas: number;
  /** Das tentadas, as que a Mensagem ja tinha texto no lote (o ouvinte ou outro caminho escreveu no intervalo). */
  jaComTexto: number;
  /** Mensagens com Conteudo Bruto ilegivel que o filtro de trecho deixou passar. */
  ilegiveis: number;
  operacaoId: string | null;
  gravou: boolean;
  /** O indice de busca estava integro antes e depois (so no efeito; o ensaio nao o verifica). */
  indiceIntegro: boolean | null;
}

interface Item {
  mensagemId: string;
  texto: string;
}

/**
 * Grava, como texto da Mensagem, a legenda das Mensagens de midia ja gravadas (#1530). Ao vivo, o Conteudo Bruto da
 * Mensagem (o tipo da midia no evento, nao o Anexo: ha Mensagem de midia gravada sem Anexo); backup do iPhone, o titulo do
 * registro de midia do Anexo, so de imagem e de video. So onde o texto e nulo ou vazio, e nunca a legenda de uma mensagem
 * citada. Ensaio por padrao: conta e nao escreve.
 *
 * Com efeito: verifica o indice de busca ANTES (e recusa se ja estiver defasado), le o Acervo em paginas fora de transacao
 * e guarda so o id e a legenda (nunca o bruto), abre UMA Operacao `por-efeito` com uma transacao por lote e um efeito por
 * Mensagem, e verifica o indice DEPOIS. Falha no meio de um lote deixa a Operacao aberta com os lotes anteriores gravados.
 */
export function extrairLegendas(acervo: Acervo, opcoes: OpcoesDoEstoqueDeLegenda): RelatorioDoEstoqueDeLegenda {
  if (opcoes.limite !== undefined && (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0)) {
    throw new RangeError('o limite precisa ser um inteiro maior que zero');
  }
  const lote = opcoes.tamanhoDoLote ?? LOTE_PADRAO;
  if (!Number.isInteger(lote) || lote <= 0) throw new RangeError('o tamanho do lote precisa ser um inteiro maior que zero');

  if (opcoes.comEfeito && !indiceDeBuscaEstaIntegro(acervo)) throw new IndiceDeBuscaDefasadoError();

  const relatorio: RelatorioDoEstoqueDeLegenda = {
    aoVivo: { imagem: 0, video: 0, documento: 0 },
    backup: { imagem: 0, video: 0 },
    aGravar: 0,
    gravadas: 0,
    jaComTexto: 0,
    ilegiveis: 0,
    operacaoId: null,
    gravou: false,
    indiceIntegro: null,
  };
  const plano: Item[] = [];
  const cheio = (): boolean => opcoes.limite !== undefined && plano.length >= opcoes.limite;

  let cursor = 0;
  for (; !cheio(); ) {
    const pagina = listarCandidatasDeTextoPeloBruto(acervo, {
      fonte: FONTE,
      contem: '"caption"',
      comecaCom: COMECO_AO_VIVO,
      depoisDe: cursor,
      limite: PAGINA,
    });
    if (pagina.length === 0) break;
    cursor = pagina[pagina.length - 1]!.rowid;
    for (const c of pagina) {
      if (cheio()) break;
      const achada = legendaETipoDoBrutoAoVivo(c.bruto);
      if (achada === undefined) {
        // O trecho passou e a legenda nao: ilegivel, ou so da citada. Ilegivel e o que vale contar.
        try {
          JSON.parse(c.bruto);
        } catch {
          relatorio.ilegiveis += 1;
        }
        continue;
      }
      relatorio.aoVivo[achada.tipo] += 1;
      plano.push({ mensagemId: c.mensagemId, texto: achada.texto });
    }
  }

  cursor = 0;
  for (; !cheio(); ) {
    const pagina = listarCandidatasDeTextoPeloAnexo(acervo, {
      fonte: FONTE,
      contem: '"ZTITLE"',
      comecaCom: COMECO_DO_BACKUP,
      tipos: ['image', 'video'],
      depoisDe: cursor,
      limite: PAGINA,
    });
    if (pagina.length === 0) break;
    cursor = pagina[pagina.length - 1]!.rowid;
    for (const c of pagina) {
      if (cheio()) break;
      const texto = legendaDoRegistroDeMidia(c.brutoDoAnexo, c.tipoDoAnexo);
      if (texto === undefined) continue;
      relatorio.backup[c.tipoDoAnexo === 'image' ? 'imagem' : 'video'] += 1;
      plano.push({ mensagemId: c.mensagemId, texto });
    }
  }

  relatorio.aGravar = plano.length;
  if (!opcoes.comEfeito || plano.length === 0) return relatorio;

  const operacaoId = emOperacao(
    acervo,
    { natureza: 'extrair-legenda-da-midia', reversibilidade: 'por-efeito', emTransacao: false },
    (op) => {
      try {
        for (let i = 0; i < plano.length; i += lote) {
          const dosLote = plano.slice(i, i + lote);
          // `immediate`: a leitura que decide e a escrita ficam sob o mesmo lock, e o ouvinte nao escreve no meio.
          acervo.db
            .transaction(() => {
              for (const item of dosLote) {
                const escrito = escreverTextoDeMensagem(acervo, item.mensagemId, item.texto);
                if (escrito === null) {
                  relatorio.jaComTexto += 1;
                  continue;
                }
                op.valor({ tabela: 'mensagens', chave: item.mensagemId, campo: 'conteudo', antes: escrito.antes, depois: item.texto });
                relatorio.gravadas += 1;
              }
            })
            .immediate();
          opcoes.aoTerminarLote?.(dosLote.length);
        }
      } catch (causa) {
        throw new EstoqueDeLegendaInterrompidoError(op.id, relatorio.gravadas, causa);
      }
      return op.id;
    },
  );
  relatorio.operacaoId = relatorio.gravadas > 0 ? operacaoId : null;
  relatorio.gravou = relatorio.gravadas > 0;
  relatorio.indiceIntegro = indiceDeBuscaEstaIntegro(acervo);
  return relatorio;
}
