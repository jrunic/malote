import type { InquilinoId } from '../nucleo/tipos.js';
import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

/**
 * O Destino Remoto de Midia de um Inquilino: para onde o Servico de
 * Armazenamento sobe os arquivos, e como. E ACRESCIMO ao Destino de Midia
 * (local), nao substituto: o Destino local continua sendo onde o arquivo
 * chega e onde fica pela Janela de Copia Local. Por isso e uma tabela a parte
 * e a natureza do Destino de Midia continua `local`.
 *
 * O produto nao conhece credencial: `remoto` e so o NOME do remoto que o
 * rclone do host ja resolve (variaveis de ambiente ou arquivo de configuracao
 * do rclone, a criterio de quem instala).
 */
export interface DestinoRemotoDeMidia {
  /** Nome do remoto do rclone. Letras, digitos e sublinhado: e o que variavel de ambiente aceita. */
  remoto: string;
  /** Pasta-base no remoto, relativa; vazia = raiz do remoto. */
  pastaBase: string;
  /**
   * Dias que a copia local fica depois de verificada no remoto. 0 e permitido DE PROPOSITO (ensaio): com a trava
   * liberada, apaga na mesma passada que verifica, e a reverificacao imediatamente antes e a unica barreira.
   */
  janelaDias: number;
  /** A trava: enquanto falso, o servico copia e verifica mas nunca apaga a copia local. */
  apagarLocal: boolean;
  /** Fuso do rotulo do Indice de Midia (zona IANA). */
  fuso: string;
  transferencias: number;
  chamadasPorSegundo: number;
}

export const PADROES_DO_DESTINO_REMOTO = {
  pastaBase: 'malote',
  janelaDias: 7,
  apagarLocal: false,
  fuso: 'America/Cuiaba',
  transferencias: 4,
  chamadasPorSegundo: 8,
} as const;

const NOME_DO_REMOTO = /^[A-Za-z][A-Za-z0-9_]*$/;
const SEGMENTO_DA_PASTA = /^[A-Za-z0-9._-]+$/;

function inteiroEntre(valor: number, minimo: number, maximo: number, nome: string): void {
  if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`${nome} precisa ser um inteiro de ${minimo} a ${maximo}.`);
  }
}

/** Falha alto, com a mensagem pronta para o Operador: nada invalido chega a gravar. */
export function validarDestinoRemoto(d: DestinoRemotoDeMidia): void {
  if (!NOME_DO_REMOTO.test(d.remoto)) {
    throw new Error(
      'O nome do remoto precisa comecar por letra e ter so letras, digitos e sublinhado (hifen nao vale em variavel de ambiente).',
    );
  }
  if (d.pastaBase.length > 200) throw new Error('A pasta-base passa de 200 caracteres.');
  if (d.pastaBase !== '') {
    for (const segmento of d.pastaBase.split('/')) {
      if (segmento === '.' || segmento === '..' || !SEGMENTO_DA_PASTA.test(segmento)) {
        throw new Error('A pasta-base precisa ser relativa, sem "." nem "..", com segmentos de letras, digitos, ponto, hifen e sublinhado.');
      }
    }
  }
  inteiroEntre(d.janelaDias, 0, 365, 'A Janela de Copia Local (--janela-dias)');
  inteiroEntre(d.transferencias, 1, 32, 'As transferencias');
  inteiroEntre(d.chamadasPorSegundo, 1, 50, 'As chamadas por segundo');
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: d.fuso });
  } catch {
    throw new Error(`Fuso desconhecido: ${d.fuso}. Use uma zona IANA, como America/Cuiaba.`);
  }
}

/** Le um inteiro de flag; `undefined` quando a flag nao veio. */
export function inteiroDaOpcao(valor: string | undefined, nome: string): number | undefined {
  if (valor === undefined) return undefined;
  if (!/^-?\d+$/.test(valor)) throw new Error(`${nome} precisa ser um inteiro.`);
  return Number(valor);
}

interface LinhaDoDestinoRemoto {
  remoto: string;
  pasta_base: string;
  janela_dias: number;
  apagar_local: number;
  fuso: string;
  transferencias: number;
  chamadas_por_segundo: number;
}

export function lerDestinoRemotoDeMidia(
  registro: Registro,
  inquilinoId: InquilinoId,
): DestinoRemotoDeMidia | undefined {
  const l = registro
    .preparar(
      `SELECT remoto, pasta_base, janela_dias, apagar_local, fuso, transferencias, chamadas_por_segundo
         FROM destinos_remotos_de_midia WHERE inquilino_id = ?`,
    )
    .get(inquilinoId) as LinhaDoDestinoRemoto | undefined;
  if (l === undefined) return undefined;
  return {
    remoto: l.remoto,
    pastaBase: l.pasta_base,
    janelaDias: l.janela_dias,
    apagarLocal: l.apagar_local === 1,
    fuso: l.fuso,
    transferencias: l.transferencias,
    chamadasPorSegundo: l.chamadas_por_segundo,
  };
}

/**
 * Declara (ou substitui) o Destino Remoto. Operacao IRREVERSIVEL na trilha:
 * declarar de novo substitui, e liberar a trava de apagar e uma decisao do
 * Operador que a trilha registra com o antes e o depois, nao algo que o
 * `desfazer` reverta por tras. Nao toca em arquivo nem fala com o remoto.
 */
export function configurarDestinoRemotoDeMidia(
  registro: Registro,
  inquilinoId: InquilinoId,
  destino: DestinoRemotoDeMidia,
): void {
  const existe = registro.preparar('SELECT 1 AS ok FROM inquilinos WHERE id = ?').get(inquilinoId) as
    | { ok: number }
    | undefined;
  if (existe === undefined) throw new Error(`Inquilino desconhecido: ${inquilinoId}`);
  validarDestinoRemoto(destino);

  const antes = lerDestinoRemotoDeMidia(registro, inquilinoId);

  emOperacao(
    registro,
    { natureza: 'configurar-destino-remoto', reversibilidade: 'irreversivel', inquilinoId },
    (op) => {
      registro
        .preparar(
          `INSERT INTO destinos_remotos_de_midia
             (inquilino_id, remoto, pasta_base, janela_dias, apagar_local, fuso, transferencias,
              chamadas_por_segundo, configurado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (inquilino_id) DO UPDATE SET
             remoto = excluded.remoto,
             pasta_base = excluded.pasta_base,
             janela_dias = excluded.janela_dias,
             apagar_local = excluded.apagar_local,
             fuso = excluded.fuso,
             transferencias = excluded.transferencias,
             chamadas_por_segundo = excluded.chamadas_por_segundo,
             configurado_em = excluded.configurado_em`,
        )
        .run(
          inquilinoId,
          destino.remoto,
          destino.pastaBase,
          destino.janelaDias,
          destino.apagarLocal ? 1 : 0,
          destino.fuso,
          destino.transferencias,
          destino.chamadasPorSegundo,
          new Date().toISOString(),
        );

      const campos: Array<[string, string | null, string]> = [
        ['remoto', antes?.remoto ?? null, destino.remoto],
        ['pasta_base', antes?.pastaBase ?? null, destino.pastaBase],
        ['janela_dias', antes === undefined ? null : String(antes.janelaDias), String(destino.janelaDias)],
        ['apagar_local', antes === undefined ? null : String(antes.apagarLocal), String(destino.apagarLocal)],
        ['fuso', antes?.fuso ?? null, destino.fuso],
        ['transferencias', antes === undefined ? null : String(antes.transferencias), String(destino.transferencias)],
        [
          'chamadas_por_segundo',
          antes === undefined ? null : String(antes.chamadasPorSegundo),
          String(destino.chamadasPorSegundo),
        ],
      ];
      for (const [campo, de, para] of campos) {
        if (de === para) continue;
        op.valor({ tabela: 'destinos_remotos_de_midia', chave: inquilinoId, campo, antes: de, depois: para });
      }
    },
  );
}
