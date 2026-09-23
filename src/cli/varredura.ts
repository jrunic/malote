import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  listarConfiguracoes,
  type ConfiguracaoDeAdaptador,
} from '../registro/configuracao-adaptador.js';
import { listarPastasDeEntrada, type PastaDeEntrada } from '../registro/pasta-de-entrada.js';
import { listarInquilinos, type Registro } from '../registro/registro.js';
import { abrirAcervo, type Acervo } from '../nucleo/acervo.js';
import type { InquilinoId } from '../nucleo/tipos.js';
import { importarCatalogo } from '../adaptadores/contatos/importar.js';
import { marcarAusentes } from '../nucleo/ausencia.js';
import { lerVCard } from '../adaptadores/contatos/vcard.js';
import { importarMaterialDeInstagram } from '../adaptadores/instagram/importar.js';

/**
 * A varredura consulta a Pasta de Entrada de cada Configuracao vigiada,
 * processa o que esta la e MOVE para `processados/`.
 *
 * NAO busca material, NAO autentica, NAO apaga. Como o material chega ate a
 * pasta varia por quem instala e fica fora do produto; limpar `processados/`
 * tambem.
 *
 * MORA EM `src/cli/` E NAO EM `src/nucleo/`. Ela importa adaptador de mais de
 * uma Fonte, e nenhum modulo de `src/nucleo` ou `src/registro` importa
 * adaptador — medido em 12/09/2026, zero ocorrencias. Quem compoe adaptador
 * neste repositorio e a CLI, e o precedente exato e `ouvir.ts`.
 *
 * NAO ABRE OPERACAO PROPRIA. `emOperacao` e reentrante por banco: um envelope
 * aqui engoliria a Operacao `importar-material` que cada importador ja abre, e
 * o criterio 8 — N materiais, N Operacoes — passaria a ser cumprido por uma
 * natureza que nao descreve a ingestao. Quem distingue execucao automatica de
 * ato do Titular e o ATOR, declarado por `comAtor` no chamador.
 */

/**
 * As Fontes que a varredura sabe processar.
 *
 * FONTE UNICA DA VERDADE, e nao lista repetida: o roteamento aqui dentro e a
 * guarda de `entrada declarar` respondem a mesma pergunta, e duas listas
 * divergiriam no dia em que uma Fonte nova entrasse por um lado so.
 *
 * `whatsapp` esta FORA de proposito: ela chega pelo ouvinte e por `importar`,
 * nunca por pasta vigiada.
 */
export const FONTES_VARRIVEIS: readonly string[] = ['contatos', 'instagram'];

export interface ResultadoDaConfiguracao {
  fonte: string;
  apelido: string;
  /** Materiais que entraram e foram movidos. */
  processados: number;
  /** Materiais que o produto recusou. Ficam na Pasta de Entrada. */
  recusados: number;
  /** A Configuracao inteira nao pode ser varrida — pasta ausente, por exemplo. */
  falhas: number;
  /**
   * Itens que a LEITURA rendeu: cartoes em `contatos`, Mensagens em
   * `instagram`.
   *
   * E o que distingue "processou" de "devolveu ja registrado". A contagem no
   * Acervo nao muda na segunda passada, por idempotencia, entao so a leitura
   * prova que o material foi percorrido.
   */
  itensLidos: number;
  /**
   * Cartoes marcados como ausentes nesta passada. Sempre zero em material
   * `parcial` — ali ausencia nao significa nada.
   */
  ausentesMarcados: number;
  motivos: string[];
}

export interface ResultadoDaVarredura {
  configuracoes: ResultadoDaConfiguracao[];
}

export function varrer(
  registro: Registro,
  opcoes: {
    dados: string;
    inquilinoId: InquilinoId;
    apenasConfiguracao?: string;
    /**
     * O instante da passada. Injetado, e nao `Date.now()` por dentro: e ele que
     * a marcacao usa para decidir o que nao veio, e teste que nao o controla
     * mede uma corrida de relogio em vez de comportamento.
     */
    agora?: number;
  },
): ResultadoDaVarredura {
  const existe = listarInquilinos(registro).some((i) => i.id === opcoes.inquilinoId);
  if (!existe) throw new Error(`Inquilino desconhecido: ${opcoes.inquilinoId}`);

  const configuracoes = listarConfiguracoes(registro, opcoes.inquilinoId);
  const porId = new Map(configuracoes.map((c) => [c.id, c] as const));
  const todasAsEntradas = listarPastasDeEntrada(registro, opcoes.inquilinoId);
  const entradas = todasAsEntradas.filter((e) => {
    const cfg = porId.get(e.configuracaoId);
    if (cfg === undefined) return false;
    return opcoes.apenasConfiguracao === undefined || cfg.apelido === opcoes.apenasConfiguracao;
  });

  // Mesmo contexto de `acervoDoInquilino`: os passos 13 -> 14 e 19 -> 20 do
  // Acervo EXIGEM Registro ao lado, e `abrirAcervo` sem contexto recusa.
  // Quem abre sem o Registro ao lado — o ouvinte — recebe a instrucao de
  // rodar `acervo migrar`. `nomeDoTitularNaFonte` vem de TODAS as entradas
  // do Inquilino, nunca so das filtradas por `apenasConfiguracao` — a
  // migracao precisa do comparador de toda Configuracao, nao so da que esta
  // sendo varrida agora.
  const contexto = {
    configuracoes: configuracoes.map((c) => ({ id: c.id, fonte: c.fonte })),
    nomeDoTitularNaFonte: new Map(
      todasAsEntradas
        .map((e) => (e.nomeDoTitularNaFonte != null ? ([e.configuracaoId, e.nomeDoTitularNaFonte] as const) : undefined))
        .filter((par): par is readonly [string, string] => par !== undefined),
    ),
  };
  const acervo = abrirAcervo(join(opcoes.dados, 'acervos'), opcoes.inquilinoId, contexto);
  try {
    return {
      configuracoes: entradas.map((e) =>
        processarUma(
          acervo,
          e,
          porId.get(e.configuracaoId) as ConfiguracaoDeAdaptador,
          opcoes.agora ?? Date.now(),
        ),
      ),
    };
  } finally {
    acervo.fechar();
  }
}

function processarUma(
  acervo: Acervo,
  entrada: PastaDeEntrada,
  cfg: ConfiguracaoDeAdaptador,
  instanteDaPassada: number,
): ResultadoDaConfiguracao {
  const r: ResultadoDaConfiguracao = {
    fonte: cfg.fonte,
    apelido: cfg.apelido,
    processados: 0,
    recusados: 0,
    falhas: 0,
    itensLidos: 0,
    ausentesMarcados: 0,
    motivos: [],
  };

  // Pasta ausente e CONDICAO DE EXECUCAO, nao erro de configuracao — e nao
  // pode impedir as demais Configuracoes de entrarem. FALHA, e nao recusa: as
  // duas contagens respondem perguntas diferentes, e quem agenda a varredura
  // precisa distinguir "o material esta errado" de "o caminho sumiu".
  if (!existsSync(entrada.pasta)) {
    r.falhas += 1;
    r.motivos.push(`pasta nao encontrada: ${entrada.pasta}`);
    return r;
  }

  // UM INSTANTE POR PASSADA, compartilhado por todos os materiais desta
  // Configuracao — ele CHEGA como parametro, e nao nasce aqui. E o que permite
  // a marcacao derivar "o que nao veio" do `ultimo_avistamento`, sem uma lista
  // de milhares atravessando a fronteira entre adaptador e varredura.

  for (const candidato of candidatosEm(entrada.pasta)) {
    try {
      r.itensLidos += importarPelaFonte(acervo, entrada, cfg, candidato, instanteDaPassada);
      // MOVE SO DEPOIS DO REGISTRO DE CONCLUSAO. Mover na tentativa faria
      // material recusado sumir em processados/ parecendo processado — e a
      // importacao leria um caminho que ja nao existe.
      moverParaProcessados(entrada.pasta, candidato);
      r.processados += 1;
    } catch (e) {
      r.recusados += 1;
      r.motivos.push(`${basename(candidato)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // AO FINAL, e uma vez so. Marcar depois do primeiro de dois materiais
  // marcaria como ausente tudo o que so o segundo traz.
  //
  // So em material COMPLETO: em parcial, o que nao veio apenas nao mudou. E so
  // se algo entrou — passada sem material nao e declaracao de que tudo sumiu.
  if (entrada.natureza === 'completo' && r.processados > 0) {
    try {
      const marcacao = marcarAusentes(acervo, {
        configuracaoId: cfg.id,
        instanteDaPassada: new Date(instanteDaPassada).toISOString(),
      });
      r.ausentesMarcados = marcacao.marcados;
    } catch (e) {
      // A guarda proporcional abortou. NAO e recusa de material — o material
      // entrou —, e nao e falha de pasta. E aviso, e o motivo diz o numero.
      r.motivos.push(e instanceof Error ? e.message : String(e));
    }
  }
  return r;
}

/**
 * O que ha para processar na pasta, sem descer em `processados/`.
 *
 * Dotfile fica de fora. Nao e assepsia: a Pasta de Entrada e alimentada por
 * transporte que varia por quem instala — pasta sincronizada, montagem de rede,
 * download — e `.DS_Store`, `.syncthing.tmp` e afins aparecem ali sozinhos.
 * Sem o filtro, cada um vira RECUSA PERPETUA: nunca sai da pasta, e o motivo
 * dele e impresso a cada varredura agendada, treinando quem le a ignorar a
 * saida.
 */
function candidatosEm(pasta: string): string[] {
  return readdirSync(pasta)
    .filter((n) => n !== 'processados' && !n.startsWith('.'))
    .sort()
    .map((n) => join(pasta, n));
}

/**
 * Move para `processados/` SEM SOBRESCREVER.
 *
 * O caso nao e borda: o export periodico chega sempre com o mesmo nome, e
 * sobrescrever destruiria o material do periodo anterior — o produto nao apaga
 * nada, e mover por cima e apagar com outro nome.
 *
 * Quem desambigua e o que CHEGA DEPOIS: o primeiro mantem o nome original, e
 * quem le a pasta reconhece o arquivo que esperava.
 */
function moverParaProcessados(pasta: string, caminho: string): string {
  const destinoDir = join(pasta, 'processados');
  mkdirSync(destinoDir, { recursive: true });
  const nome = basename(caminho);
  let destino = join(destinoDir, nome);
  if (existsSync(destino)) {
    // Contador, e nao carimbo de tempo: duas passadas no mesmo segundo
    // colidiriam de novo, e o defeito so apareceria sob a varredura agendada —
    // longe de quem pudesse liga-lo a causa.
    let n = 2;
    while (existsSync(join(destinoDir, `${nome}.${n}`))) n += 1;
    destino = join(destinoDir, `${nome}.${n}`);
  }
  renameSync(caminho, destino);
  return destino;
}

/**
 * Ha material reconhecivel aqui?
 *
 * A pergunta e da varredura, e nao do adaptador, por um fato medido: nenhum dos
 * dois importadores recusa conteudo ausente. `lerMaterial` devolve
 * `{conversas: [], conversasSemArquivo: []}` SEM LANCAR, e `impressaoDoMaterial`
 * de uma arvore sem `your_instagram_activity/messages` devolve
 * `impressaoDeEntradas([])` — uma CONSTANTE.
 *
 * Deixar passar custa duas coisas, e nenhuma delas e "um material vazio
 * importado". A primeira: o que nao e material MUDA de lugar — vai para
 * `processados/` e passa a se ler como processado. A segunda, e pior:
 * `registrarMaterialConcluido` grava um Material de impressao CONSTANTE e
 * contagens zero, que `material listar` mostra e que o watchdog de atraso le
 * como "chegou material" — linha falsa que sobrevive a limpeza da pasta.
 *
 * Pela VARREDURA esse registro falso nao chega a envenenar a leitura seguinte,
 * porque ela invoca com `reprocessar: true` e `materialJaEntrou` nunca e
 * consultado. Pelo `malote importar` SEM `--reprocessar`, sim: a impressao
 * constante faria a proxima pasta vazia ler como ja processada.
 *
 * O reconhecimento e MINIMO de proposito: a forma que distingue "ha material
 * aqui" de "nao ha". Validar o conteudo e trabalho do adaptador.
 */
function reconhecerMaterial(fonte: string, caminho: string): void {
  if (fonte === 'contatos') {
    if (!statSync(caminho).isFile()) {
      throw new Error('catalogo precisa ser arquivo, e este caminho e um diretorio');
    }
    if (lerVCard(readFileSync(caminho, 'utf8')).length === 0) {
      throw new Error('nenhum cartao de contato reconhecido neste arquivo');
    }
    return;
  }
  if (fonte === 'instagram') {
    if (!statSync(caminho).isDirectory()) {
      throw new Error('material de Instagram precisa ser um diretorio');
    }
    const mensagens = join(caminho, 'your_instagram_activity', 'messages');
    if (!existsSync(mensagens) || readdirSync(mensagens).length === 0) {
      throw new Error(
        'nenhuma conversa reconhecida: falta a arvore your_instagram_activity/messages',
      );
    }
    return;
  }
  throw new Error(`Fonte sem varredura: ${fonte}`);
}

/**
 * Roteia para o adaptador da Fonte e devolve quantos itens a leitura rendeu.
 *
 * O nome do Titular vem da CONFIGURACAO, nunca da invocacao: quem varre
 * sozinho nao tem como sabe-lo, e `importarMaterialDeInstagram` recusa a
 * Conversa direta em que o Titular declarado nao aparece.
 *
 * `reprocessar: true` NAO e atalho de teste, e nao e opcional.
 *
 * A POSICAO DO ARQUIVO e o unico mecanismo de "e novo": o que esta na Pasta de
 * Entrada e, por definicao, o que falta. Sem isto, arquivo devolvido a pasta
 * tem a mesma Impressao ja em `materiais` e o importador devolve `jaRegistrado`
 * sem percorrer nada — e os criterios de reavistamento e de marcacao passariam
 * contando zero sobre nada.
 *
 * Medido em 11/09/2026 no vCard real: trocar um digito de telefone preserva o
 * tamanho em bytes, entao a Impressao nao muda. E por isso que mover dissolve a
 * pergunta em vez de responde-la melhor.
 *
 * Reprocessar nao colide com o registro de conclusao: `registrarMaterialConcluido`
 * grava com `ON CONFLICT (configuracao_id, impressao) DO UPDATE` e rele o id da
 * linha que ficou. Atualiza a existente; nao lanca e nao acumula.
 */
function importarPelaFonte(
  acervo: Acervo,
  entrada: PastaDeEntrada,
  cfg: ConfiguracaoDeAdaptador,
  caminho: string,
  agora: number,
): number {
  reconhecerMaterial(cfg.fonte, caminho);
  if (cfg.fonte === 'contatos') {
    const r = importarCatalogo(acervo, caminho, {
      agora,
      configuracaoId: cfg.id,
      reprocessar: true,
    });
    return r.cartoesLidos;
  }
  if (cfg.fonte === 'instagram') {
    if (entrada.nomeDoTitularNaFonte === null) {
      throw new Error(
        `a Configuracao ${cfg.fonte}/${cfg.apelido} nao declarou o nome do titular na fonte; ` +
          'use --titular-na-fonte em "malote entrada declarar"',
      );
    }
    const r = importarMaterialDeInstagram(acervo, caminho, {
      agora,
      titular: entrada.nomeDoTitularNaFonte,
      configuracao: { id: cfg.id, fonte: 'instagram' },
      reprocessar: true,
    });
    return r.mensagensLidas;
  }
  throw new Error(`Fonte sem varredura: ${cfg.fonte}`);
}
