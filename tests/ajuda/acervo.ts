import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './instalacao.js';
import { abrirRegistro, criarInquilino, type Registro } from '../../src/registro/registro.js';
import { abrirAcervo, type Acervo } from '../../src/nucleo/acervo.js';
import {
  registrarConversa,
  registrarMensagem,
  registrarAnexo as registrarAnexoNoAcervo,
} from '../../src/nucleo/escrita.js';
import { gravarArquivoDeAnexo } from '../../src/nucleo/arquivo-de-anexo.js';
import type { InquilinoId } from '../../src/nucleo/tipos.js';
import { CFG_WHATSAPP } from './configuracao.js';

export interface EntradaDeAnexoDeTeste {
  tipo: string;
  tamanho?: number;
  ocorridaEm: number;
  /**
   * Texto da Mensagem que carrega o Anexo. Entra por `registrarMensagem`, e
   * NUNCA por UPDATE depois: o índice de busca `mensagens_texto` é alimentado
   * por gatilho AFTER INSERT — não há gatilho de UPDATE. Texto posto por
   * UPDATE existe na tabela e é invisível para `buscarMensagens`.
   */
  conteudo?: string;
  /** Presença de nascimento. Default `nunca-obtido`, como toda importação. */
  presenca?: 'presente' | 'nunca-obtido' | 'descartado';
}

export interface InquilinoComArquivos {
  id: InquilinoId;
  acervo: Acervo;
  destino: string;
}

export interface Cenario {
  raiz: string;
  registro: Registro;
  limpar: () => void;
  novoInquilino: (titularNome: string) => { id: InquilinoId; acervo: Acervo };
  registrarAnexo: (acervo: Acervo, entrada: EntradaDeAnexoDeTeste) => string;
  inquilinoComArquivos: (opcoes?: { destino?: string }) => InquilinoComArquivos;
  raizDeDestinoCompartilhada: () => string;
}

/** Monta uma instalação temporária capaz de criar Inquilinos com Acervo aberto. */
export function cenario(): Cenario {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const abertos: Acervo[] = [];
  let contador = 0;

  function novoInquilino(titularNome: string) {
    const id = criarInquilino(registro, { titularNome });
    const acervo = abrirAcervo(join(raiz, 'acervos'), id);
    abertos.push(acervo);
    return { id, acervo };
  }

  /**
   * Uma Conversa e uma Mensagem por Anexo. É verboso de propósito: o relatório
   * e a projeção fazem JOIN com `mensagens` e `conversas`, e Anexo pendurado em
   * Mensagem inexistente passaria por toda consulta sem aparecer, deixando o
   * teste medir o vazio.
   */
  function registrarAnexo(acervo: Acervo, entrada: EntradaDeAnexoDeTeste): string {
    const seq = (contador += 1);
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: `conversa-${seq}`,
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    const mensagemId = registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno: `mensagem-${seq}`,
      ocorridaEm: entrada.ocorridaEm,
      agora: Date.now(),
      direcao: 'recebida',
      ...(entrada.conteudo !== undefined ? { conteudo: entrada.conteudo } : {}),
    });
    // `tipo` SEMPRE explícito: o material falso do plano 2 usava `tipo ?? 0`, e
    // 0 nasce texto — três Anexos "de imagem" viraram texto em silêncio, e o
    // recorte por tipo mediu outra coisa.
    return registrarAnexoNoAcervo(acervo, {
      mensagemId,
      tipo: entrada.tipo,
      presenca: entrada.presenca ?? 'nunca-obtido',
      ...(entrada.tamanho !== undefined ? { tamanho: entrada.tamanho } : {}),
    });
  }

  /**
   * Inquilino com arquivos DE VERDADE sob o Destino, gravados pela porta.
   *
   * Monta o estado por `gravarArquivoDeAnexo`, nunca por UPDATE na tabela:
   * teste que escreve a linha à mão passa verde com a implementação errada,
   * porque nunca exercita o caminho que grava — e é justamente a divergência
   * entre o que o Acervo diz e o que está em disco que este ciclo persegue.
   */
  function inquilinoComArquivos(opcoes: { destino?: string } = {}): InquilinoComArquivos {
    const { id, acervo } = novoInquilino('Leia Organa');
    const destino = opcoes.destino ?? join(raiz, `destino-${id}`);
    mkdirSync(destino, { recursive: true });

    const agora = Date.UTC(2026, 7, 28);
    const DIA = 86_400_000;
    for (const e of [
      { tipo: 'video', tamanho: 50_000_000, ocorridaEm: agora - 1200 * DIA, conteudo: 'holocron antigo' },
      { tipo: 'image', tamanho: 200_000, ocorridaEm: agora - 1200 * DIA, conteudo: 'sabre antigo' },
      { tipo: 'video', tamanho: 40_000_000, ocorridaEm: agora - 10 * DIA, conteudo: 'holocron recente' },
    ]) {
      const anexoId = registrarAnexo(acervo, e);
      // Bytes pequenos e conhecidos: o teste roda em qualquer máquina, e o
      // tamanho gravado passa a ser o do ARQUIVO, não o declarado acima.
      gravarArquivoDeAnexo(acervo, {
        anexoId,
        destino,
        bytes: Buffer.from(`conteudo-${anexoId}`),
      });
    }
    return { id, acervo, destino };
  }

  /** Uma raiz de Destino para dois Inquilinos — o cenário que o segmento de Inquilino protege. */
  function raizDeDestinoCompartilhada(): string {
    const compartilhada = join(raiz, 'destino-compartilhado');
    mkdirSync(compartilhada, { recursive: true });
    return compartilhada;
  }

  return {
    raiz,
    registro,
    novoInquilino,
    registrarAnexo,
    inquilinoComArquivos,
    raizDeDestinoCompartilhada,
    limpar() {
      for (const a of abertos) {
        try {
          a.fechar();
        } catch {
          // já fechado por um teste — limpar não pode falhar por isso
        }
      }
      registro.fechar();
      limpar();
    },
  };
}
