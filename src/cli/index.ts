#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { raizDeDados, raizDeEstado } from './caminhos.js';
import { pedirGet, pedirGetBinario } from './cliente.js';
import { decodificarCursor } from '../nucleo/cursor.js';
import { expandirData, procurarPessoas } from '../nucleo/consulta.js';
import { ehPontoDeEntrada } from './entrada.js';
import { join } from 'node:path';
import type { Fonte } from '../nucleo/tipos.js';
import {
  abrirRegistro,
  criarInquilino,
  listarInquilinos,
  abrirRegistroSomenteLeitura,
  type Registro,
} from '../registro/registro.js';
import { abrirAcervo } from '../nucleo/acervo.js';
import { recriarAcervo } from '../nucleo/recriar.js';
import { versaoDoAcervoEmDisco } from '../nucleo/acervo.js';
import { passosAplicados } from '../nucleo/migracao.js';
import {
  listarConversas,
  buscarMensagens,
  lerMensagens,
  listarSemEndereco,
  conversaExiste,
} from '../nucleo/consulta.js';
import { conversasMarcadas } from '../nucleo/marca-do-titular.js';
import { importarMaterial } from '../adaptadores/whatsapp/importar.js';
import { importarMaterialDeInstagram } from '../adaptadores/instagram/importar.js';
import {
  criarChaveDeOperador,
  listarChavesDeOperador,
  revogarChaveDeOperador,
} from '../registro/chave-operador.js';
import {
  configurarDestinoDeMidia,
  destinoAcessivel,
  lerDestinoDeMidia,
} from '../registro/destino-midia.js';
import { trazerArquivos } from '../adaptadores/whatsapp/trazer.js';
import { conferirDisco, relatarAcervo } from '../nucleo/relatorio-de-acervo.js';
import { aplicarRetencao, projetarRetencao } from '../nucleo/retencao.js';
import {
  conferirMesclagem,
  conferirTransicoes,
  conferirTransicoesRepetidas,
  conferirTransicoesEmDuasFormas,
  conferirConversasEmFormaAlternativa,
} from '../nucleo/integridade.js';
import { alcanceDaConversa, quemEstavaEm } from '../nucleo/presenca.js';
import {
  definirPoliticaDeRetencao,
  descreverPolitica,
  lerPoliticaDeRetencao,
} from '../registro/politica-de-retencao.js';
import {
  abrirAcervoSomenteLeitura,
  AcervoDeOutraVersaoError,
  type Acervo,
} from '../nucleo/acervo.js';
import { existsSync } from 'node:fs';
import {
  definirContaDaConfiguracao,
  listarConfiguracoes,
  resolverConfiguracao,
  resolverFiltroDeConfiguracao,
} from '../registro/configuracao-adaptador.js';
import { CONTA_PADRAO } from '../adaptadores/whatsapp/material.js';
import { importarCatalogo } from '../adaptadores/contatos/importar.js';
import { FONTES_VARRIVEIS, varrer } from './varredura.js';
import { definirCatalogoPreferido } from '../registro/precedencia-de-nome.js';
import {
  declararPastaDeEntrada,
  listarPastasDeEntrada,
  type NaturezaDoMaterial,
} from '../registro/pasta-de-entrada.js';
import { listarIdentificadores } from '../nucleo/inventario.js';
import { propor, PRODUTORES } from '../adaptadores/contatos/propostas.js';
import type { ProdutorDeProposta } from '../adaptadores/contatos/propostas.js';
import { aplicarLote } from '../adaptadores/contatos/lote.js';
import { listarMateriais, ultimoMaterial } from '../nucleo/sincronizacao.js';
import { definirIntervaloEsperado, lerIntervaloEsperado } from '../registro/intervalo-esperado.js';
import {
  definirPrecedenciaDeNome,
  lerPrecedenciasDeNome,
} from '../registro/precedencia-de-nome.js';
import {
  criarPessoa,
  desvincularIdentificador,
  desvinculosDaPessoa,
  IdentificadorDeOutraPessoaError,
  lerPessoa,
  listarPessoas,
  desfazerMesclagem,
  mesclarPessoas,
  registrarNome,
  removerNomesInvalidos,
  vincularIdentificador,
} from '../nucleo/identidade.js';
import { resolverRetroativamente } from '../nucleo/resolucao-retroativa.js';
import { autorizarAdministracao, autorizarBootstrap } from './autorizacao.js';
import { atorDeOperador, atorDeServico, comAtor, LOCAL } from '../nucleo/ator.js';
import { verificarChaveDeOperador } from '../registro/chave-operador.js';
import {
  emitirChaveDeAcesso,
  listarChavesDeAcesso,
  revogarChaveDeAcesso,
} from '../registro/chave-de-acesso.js';
import { emOperacao, lerOperacao, listarOperacoes } from '../nucleo/trilha.js';
import { conferirSeDesfazivel, desfazerOperacao } from '../nucleo/desfazer.js';
import { caminhosDaConta, ouvir } from './ouvir.js';
import { enderecoRecusado, servir } from './servir.js';
import { lerUltimoEvento } from './ultimo-evento.js';
import {
  contarDerrame,
  contarEventosDerramados,
  descartarDerrame,
  lerDerrame,
} from './derrame.js';
import { lerUltimoRetrato } from './retrato.js';
import { lerPulos } from './pulos.js';
import { configuracaoPorApelido } from '../registro/configuracao-adaptador.js';
import { lerPastaDeEntrada } from '../registro/pasta-de-entrada.js';
import { receberEvento } from '../adaptadores/whatsapp/ao-vivo.js';
import { lerCorrespondencia } from './vigilancia.js';

/**
 * Se ha alguem escutando esta conta — pelo unit OU solto.
 *
 * AS DUAS PERGUNTAS, e nao so a primeira: a fase 1 do repareamento sobe
 * `malote ouvir` em primeiro plano com o unit `inactive`, e foi estado real duas
 * vezes em 07 e 09/09/2026. Perguntar so ao supervisor responderia "ninguem"
 * com um escritor vivo no arquivo.
 *
 * O filtro por `comm` nao e zelo: `pgrep -f` casa QUALQUER processo cuja linha
 * de comando contenha a string, inclusive o shell que pergunta — aconteceu tres
 * vezes em 08 e 09/09/2026, e uma delas dentro de um script que ia matar o PID
 * encontrado.
 *
 * AUSENCIA DE FERRAMENTA NAO E ESTADO BENIGNO. Sem `systemctl` ou sem `/proc`,
 * isto devolve `true`: nao da para AFIRMAR que ninguem escreve, e recusar com a
 * instrucao de parar o servico a mao custa um comando; aprovar por engano custa
 * lote perdido. O caminho de teste e a injecao, entao o default pode ser honesto
 * sem atrapalhar a suite.
 */
function ouvinteEscrevendoNoSistema(conta: string): boolean {
  const unidade = `malote-ouvinte@${conta}.service`;
  try {
    const estado = execFileSync('systemctl', ['is-active', unidade], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (estado === 'active' || estado === 'activating') return true;
  } catch (erro) {
    // `is-active` sai != 0 quando o servico NAO esta ativo — isso e resposta,
    // nao falha. Falta do proprio `systemctl` e outra coisa, e ai nao sabemos.
    const status = (erro as { status?: unknown }).status;
    if (typeof status !== 'number') return true;
  }
  // E o processo solto, que o unit nao conhece.
  let pids: string[];
  try {
    pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n));
  } catch {
    return true;
  }
  for (const pid of pids) {
    try {
      if (readFileSync(`/proc/${pid}/comm`, 'utf8').trim() !== 'node') continue;
      const linha = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (linha.includes('cli/index.ts ouvir') && linha.includes(conta)) return true;
    } catch {
      // Processo que morreu entre listar e ler. Nao e resposta sobre a conta.
      continue;
    }
  }
  return false;
}

export interface Ambiente {
  /**
   * Raiz de DADO (XDG_DATA_HOME/malote): registro.db, acervos/, midia/,
   * entrada/. E o que perder doi e nao se reconstrói.
   */
  dados: string;
  /**
   * Raiz de ESTADO (XDG_STATE_HOME/malote): ouvinte/<conta>/. Estado que se
   * refaz, mais a credencial do vinculo, que se move com a pasta.
   */
  estado: string;
  /**
   * Modo REDE, quando presente: a consulta vai por HTTP para este servidor
   * com esta Chave de Acesso (a chave e a identidade — Inquilino dela, nunca
   * do chamador). Ausentes = modo local, que nada aqui muda.
   */
  servidor?: string;
  chave?: string;
  escrever: (texto: string) => void;
  /**
   * Se ha alguem escutando esta conta. Injetavel porque perguntar ao sistema e
   * fronteira, e teste nao sobe servico.
   */
  ouvinteEscrevendo?: (conta: string) => boolean;
}

/** Lê `--nome valor` de uma lista de argumentos. */
function opcao(argumentos: string[], nome: string): string | undefined {
  const i = argumentos.indexOf(`--${nome}`);
  if (i === -1) return undefined;
  return argumentos[i + 1];
}

/** Todas as ocorrencias de uma bandeira repetida, na ordem em que aparecem. */
function todasAsOpcoes(argumentos: string[], nome: string): string[] {
  const achados: string[] = [];
  for (let i = 0; i < argumentos.length; i += 1) {
    if (argumentos[i] === `--${nome}`) {
      const valor = argumentos[i + 1];
      if (valor !== undefined) achados.push(valor);
    }
  }
  return achados;
}

function temBandeira(argumentos: string[], nome: string): boolean {
  return argumentos.includes(`--${nome}`);
}

const AJUDA = `malote — arquivo local das suas conversas

  malote --versao    versao publicada (nao exige instalacao)
  malote --ajuda     esta tela

Administracao (exige --chave a partir da primeira Chave criada):
  malote operador chave criar   [--chave <valor>]
  malote operador chave listar   --chave <valor>
  malote operador chave revogar  --chave <valor> --id <id>
  malote inquilino criar         --chave <valor> --titular <nome>
  malote inquilino listar        --chave <valor> [--json]
  malote inquilino destino       --chave <valor> --inquilino <id> --endereco <caminho>
  malote acesso chave emitir     --chave <valor> --inquilino <id>
  malote acesso chave listar     --chave <valor> --inquilino <id>
  malote acesso chave revogar    --chave <valor> --id <id>

Titular (nao exige chave enquanto nao houver rede):
  malote importar   --inquilino <id> --fonte whatsapp  --material <caminho> --configuracao <apelido> [--conta pessoal|business] [--reprocessar]
  malote importar   --inquilino <id> --fonte instagram --material <caminho> --titular <nome> --configuracao <apelido>
  malote importar   --inquilino <id> --fonte contatos  --material <arquivo.vcf> [--configuracao <apelido>] [--reprocessar]
  malote configuracao listar    --inquilino <id>
  malote configuracao criar     --inquilino <id> --fonte <nome> --configuracao <apelido> [--conta <nome>]
  malote entrada declarar       --inquilino <id> --fonte <nome> --configuracao <apelido> --pasta <caminho> --natureza completo|parcial [--titular-na-fonte <nome>]
  malote entrada listar         --inquilino <id>
  malote midia trazer           --inquilino <id> --material <caminho> [--conta pessoal|business]
  malote acervo relatar         --inquilino <id>
  malote retencao definir       --inquilino <id> [--mais-velho-que-dias <n>] [--maior-que-mb <n>] [--tipos video,audio]
  malote retencao ver           --inquilino <id>
  malote retencao aplicar       --inquilino <id> [--com-efeito --confirmo]
  malote operador espaco         --chave <valor>
  malote material listar        --inquilino <id>
  malote material intervalo     --inquilino <id> [--configuracao <apelido>] --dias <n>
  malote material varrer        --inquilino <id> [--configuracao <apelido>]
  malote material atraso        --inquilino <id>
  malote ouvir      --inquilino <id> --conta <nome> [--numero <so digitos>]
  malote ouvinte estado --conta <nome> [--json]
  malote ouvinte reprocessar    --inquilino <id> --conta <nome> --configuracao <apelido>
  malote servir     --porta <n> [--endereco <ip>] [--exposto]
  malote conversas  --inquilino <id> [--pessoa <id>] [--configuracao <apelido>] [--fixada true] [--json]
  malote mensagens  --inquilino <id> [--conversa <id>] [--desde D] [--ate D] [--fonte <nome>] [--direcao enviada|recebida] [--limite <n>] [--json]
                                        (sem --conversa: atravessa todas as Conversas e Fontes,
                                         ordenado por recencia por default — ultimas mensagens)
  malote midia <id> --saida <arquivo>   (bytes do Anexo — SO em modo rede;
                                          local, leia 'caminho' de 'mensagens --json')
  malote buscar     --inquilino <id> --texto <termo> [--pessoa <id>] [--json]
  malote conversas sem-endereco --inquilino <id> [--limite <n>]
  malote conversa presenca      --inquilino <id> --conversa <id> --em <AAAA-MM-DD> [--json]
  malote acervo migrar  --inquilino <id>              (sobe a forma do Acervo, e diz o que fez)
  malote acervo recriar --inquilino <id> --confirmo   (apaga o Acervo E os arquivos deste Inquilino)
  malote pessoa listar      --inquilino <id> [--incluir-absorvidas]
  malote pessoa propostas   --inquilino <id> [--produtor telefone|email|nome|multiplos-enderecos] [--limite <n>] [--json]
  malote pessoa propostas aplicar --inquilino <id> [--produtor <nome>] [--com-efeito --confirmo] [--json]
  malote pessoa ver         --inquilino <id> --pessoa <id>
  malote pessoa vincular    --inquilino <id> --identificador <id> (--pessoa <id> | --nome <nome>)
  malote pessoa desvincular --inquilino <id> --identificador <id>
  malote pessoa mesclar             --inquilino <id> --pessoa <id> --pessoa <id> [--mestre <id>]
  malote pessoa desfazer-mesclagem  --inquilino <id> --pessoa <id>
  malote pessoa conferir            --inquilino <id>
  malote pessoa remover-nomes-invalidos --inquilino <id> [--com-efeito --confirmo]
                                    (remove Atribuição que repete o próprio endereço ou
                                     duplica outra por marca invisível; ensaio por padrão)
  malote identidade resolver-enderecos --inquilino <id> [--com-efeito --confirmo] [--json]
  malote operacao listar   --inquilino <id> [--chave <valor>]
  malote operacao ver      <id> --inquilino <id> [--chave <valor>]
  malote operacao desfazer <id> --inquilino <id> [--com-efeito --confirmo]
  malote pessoa precedencia --inquilino <id> [--origem <nome> --peso <n>] [--catalogo-preferido <apelido>]

A primeira Chave de Operador dispensa credencial: a raiz de confianca e o
acesso a maquina. A partir dela, todo comando administrativo exige --chave.`;

/**
 * Como o Ator aparece para quem le.
 *
 * Ausencia NAO vira campo em branco: em saida para humano, branco se le como
 * erro de formatacao, e a diferenca entre "nao havia campo" e "ninguem
 * declarou" e justamente o que o criterio 18 pede que seja visivel.
 */
function quemOrdenou(ator: string | null): string {
  return ator ?? '(anterior ao registro de Ator)';
}

/** Abre o Acervo de um Inquilino que precisa existir no Registro. */
function acervoDoInquilino(registro: Registro, raiz: string, inquilinoId: string) {
  const existe = listarInquilinos(registro).some((i) => i.id === inquilinoId);
  if (!existe) throw new Error(`Inquilino desconhecido: ${inquilinoId}`);
  // O contexto de migracao sai DAQUI porque este e o unico ponto do produto que
  // tem o Registro aberto ao lado do Acervo. Os passos que precisam de
  // Configuracao — 13 -> 14 e 19 -> 20 — so rodam por este caminho; quem abre
  // o Acervo sem o Registro, como o ouvinte, recebe recusa com a instrucao de
  // rodar `acervo migrar`.
  const contexto = contextoDeMigracaoDoInquilino(registro, inquilinoId);
  return abrirAcervo(join(raiz, 'acervos'), inquilinoId, contexto);
}

/**
 * Monta o contexto de migracao a partir do Registro — usado tanto por
 * `acervoDoInquilino` quanto pela varredura, os dois pontos do produto que
 * abrem Registro e Acervo juntos.
 *
 * `nomeDoTitularNaFonte`: o passo 19 -> 20 (Direcao do Instagram) precisa
 * disto. Configuracao sem Pasta de Entrada declarada, ou sem o Nome do
 * Titular na Fonte nela, simplesmente nao entra no mapa — o passo trata
 * ausencia como comparador desconhecido, nunca como erro.
 */
function contextoDeMigracaoDoInquilino(registro: Registro, inquilinoId: string) {
  const configuracoesDoInquilino = listarConfiguracoes(registro, inquilinoId);
  return {
    configuracoes: configuracoesDoInquilino.map((c) => ({
      id: c.id,
      fonte: c.fonte,
    })),
    nomeDoTitularNaFonte: new Map(
      configuracoesDoInquilino
        .map((c) => {
          const entrada = lerPastaDeEntrada(registro, c.id);
          return entrada?.nomeDoTitularNaFonte != null
            ? ([c.id, entrada.nomeDoTitularNaFonte] as const)
            : undefined;
        })
        .filter((par): par is readonly [string, string] => par !== undefined),
    ),
  };
}

/**
 * Comandos que o modo REDE atende. FAIL-CLOSED: leitura declarada, todo o
 * resto e local — comando novo de leitura que deva ir por rede ENTRA AQUI,
 * e o teste cli-modo-rede cobre a recusa do resto.
 */
const COMANDOS_DE_REDE = new Set([
  'conversas',
  'mensagens',
  'buscar',
  'pessoas',
  'participantes',
  'relatorio',
  'configuracao',
  'midia',
]);

/**
 * Modo REDE: executa um comando de consulta por HTTP. A resposta sai no MESMO
 * formato do modo local quando ha saida em texto; o --json devolve o corpo da
 * API. O codigo de saida e o contrato do cliente (3/4/5/6/7).
 */
export async function executarConsultaRede(
  argumentos: string[],
  rede: { servidor: string; chave: string; escrever: (t: string) => void },
): Promise<number> {
  const grupo = argumentos[0];
  const q = new URLSearchParams();
  for (const nome of ['busca', 'fonte', 'coletiva', 'pessoa', 'limite', 'conversa',
    'autor', 'desde', 'ate', 'antes', 'em', 'texto', 'configuracao', 'favorito', 'fixada']) {
    const valor = opcao(argumentos, nome);
    if (valor !== undefined) q.set(nome, valor);
  }
  let caminho: string;
  if (grupo === 'conversas') caminho = '/conversas';
  else if (grupo === 'buscar') caminho = '/buscar';
  else if (grupo === 'pessoas') caminho = '/pessoas';
  else if (grupo === 'participantes') {
    const conversa = opcao(argumentos, 'conversa');
    if (conversa === undefined) {
      rede.escrever('Informe --conversa <id>.');
      return 2;
    }
    caminho = `/conversas/${conversa}/participantes`;
  }
  else if (grupo === 'relatorio') caminho = '/relatorio';
  else if (grupo === 'configuracao') {
    const sub = argumentos[1];
    if (sub !== 'listar') {
      rede.escrever(`"configuracao ${sub ?? ''}" ainda nao consulta por rede.`);
      return 2;
    }
    caminho = '/configuracoes';
  }
  else if (grupo === 'mensagens') {
    const conversa = opcao(argumentos, 'conversa');
    if (conversa === undefined) {
      rede.escrever('Informe --conversa <id>.');
      return 2;
    }
    caminho = `/conversas/${conversa}/mensagens`;
  }
  else if (grupo === 'midia') {
    const anexoId = argumentos[1];
    if (anexoId === undefined) {
      rede.escrever('Informe o id do Anexo: malote midia <id> --saida <arquivo>.');
      return 2;
    }
    const saida = opcao(argumentos, 'saida');
    if (saida === undefined) {
      rede.escrever('Informe --saida <arquivo>.');
      return 2;
    }
    try {
      const r = await pedirGetBinario(rede.servidor, rede.chave, `/midia/${anexoId}`);
      writeFileSync(saida, r.bytes);
      rede.escrever(`Gravado: ${saida} (${r.bytes.length} bytes, ${r.contentType ?? 'sem content-type'}).`);
      return 0;
    } catch (e) {
      rede.escrever((e as Error).message);
      return (e as { codigoDeSaida?: number }).codigoDeSaida ?? 1;
    }
  } else {
    rede.escrever(`"${grupo}" ainda nao consulta por rede.`);
    return 2;
  }
  const qs = q.toString();
  try {
    const r = await pedirGet(rede.servidor, rede.chave, `${caminho}${qs ? `?${qs}` : ''}`);
    rede.escrever(JSON.stringify(JSON.parse(r.corpo), null, 2));
    return 0;
  } catch (e) {
    rede.escrever((e as Error).message);
    return (e as { codigoDeSaida?: number }).codigoDeSaida ?? 1;
  }
}

/**
 * Executa a CLI. Recebe o ambiente por parâmetro em vez de ler `process`,
 * para que o teste rode o caminho real sem tocar no processo nem no HOME.
 */
export function executar(argumentos: string[], ambiente: Ambiente): number {
  const { escrever } = ambiente;
  const chave = opcao(argumentos, 'chave');

  if (argumentos.length === 0 || temBandeira(argumentos, 'ajuda')) {
    escrever(AJUDA);
    return 0;
  }

  // ANTES de abrir o Registro, e isso e a decisao, nao um detalhe de ordem:
  // quem instala de fora roda `malote --versao` antes de existir instalacao
  // alguma. Despachado depois da abertura, ele criaria `registro.db` numa raiz
  // vazia, migraria a base e gravaria Operacao — tudo para responder um numero
  // que nao depende de nada disso.
  if (temBandeira(argumentos, 'versao')) {
    escrever(versaoDoProduto());
    return 0;
  }

  // Despacho PRECOCE do modo rede — antes de abrir Registro, Acervo ou criar
  // pasta nenhuma: invocacao errada nao produz efeito local (criterio 9 do
  // ciclo 21). FAIL-CLOSED: a rede so atende comandos de LEITURA declarados;
  // todo o resto com --servidor/MALOTE_SERVIDOR recusa como operacao local.
  const servidorRede = opcao(argumentos, 'servidor') ?? ambiente.servidor;
  if (servidorRede !== undefined) {
    // O caminho legitimo da rede e interceptado no bloco de entrada
    // (executarConsultaRede). Se chegou AQUI com servidor declarado, ou e
    // comando que a rede nao atende (escrita/operacao), ou a invocacao veio
    // direta — nos dois casos, e local.
    escrever(`"${argumentos[0] ?? ''}" e uma operacao LOCAL — o modo rede so consulta.`);
    return 2;
  }

  // Abrir o Registro pode MIGRAR, e migrar grava Operacao — entao a abertura
  // acontece dentro de um escopo de Ator, e nao antes dele.
  //
  // O Ator aqui e `local`, e nao o da chave, por um fato: neste instante
  // nenhuma credencial foi verificada, porque verificar exige a base que ainda
  // esta sendo aberta. `local` diz exatamente isso — ninguem apresentou
  // credencial ate aqui —, e e mais honesto que atribuir a migracao a uma
  // chave que so vai ser conferida na linha seguinte.
  //
  // Sem isto, a Operacao da MIGRACAO — uma das mais dignas de auditoria —
  // seria a unica a sair `indeterminado`. Medido em 03/09/2026, contra copia
  // da base real.
  const registro = comAtor(LOCAL, () => abrirRegistro(ambiente.dados));
  // A chave e conferida UMA vez por invocacao, aqui, e o resultado desce para
  // quem autoriza. Verificar de novo la dentro dobraria a derivacao e — pior —
  // duplicaria a linha em `tentativas_de_chave`, que e prova de acesso.
  const identidade = chave === undefined ? null : verificarChaveDeOperador(registro, chave);
  // O Ator vale para a invocacao inteira: a CLI e uma sessao so, sincrona do
  // comeco ao fim. `local` quando ninguem apresentou credencial — fato que o
  // sistema conhece, e nao rotulo que alguem escolheu.
  return comAtor(identidade === null ? LOCAL : atorDeOperador(identidade), () =>
    executarComAtor(argumentos, ambiente, registro, chave, identidade),
  );
}

function executarComAtor(
  argumentos: string[],
  ambiente: Ambiente,
  registro: Registro,
  chave: string | undefined,
  identidade: string | null,
): number {
  const { escrever } = ambiente;
  try {
    const [grupo, sub, acao] = argumentos;

    if (grupo === 'acesso' && sub === 'chave') {
      // Ato ADMINISTRATIVO: o modelo diz que Chave de Acesso e emitida por
      // Chave de Operador, nunca por outra Chave de Acesso. A autorizacao vem
      // antes de qualquer leitura — inclusive antes de dizer se o Inquilino
      // existe, que ja seria informacao.
      autorizarAdministracao(registro, chave, identidade);

      if (acao === 'emitir') {
        const inquilino = opcao(argumentos, 'inquilino');
        if (inquilino === undefined) {
          escrever('Uso: malote acesso chave emitir --chave <valor> --inquilino <id>');
          return 2;
        }
        const criada = emitirChaveDeAcesso(registro, inquilino);
        escrever('Chave de Acesso emitida.');
        escrever(`  id:    ${criada.id}`);
        escrever(`  valor: ${criada.valor}`);
        escrever('Guarde agora: este valor nao e recuperavel depois.');
        return 0;
      }

      if (acao === 'listar') {
        const inquilino = opcao(argumentos, 'inquilino');
        if (inquilino === undefined) {
          escrever('Uso: malote acesso chave listar --chave <valor> --inquilino <id>');
          return 2;
        }
        for (const c of listarChavesDeAcesso(registro, inquilino)) {
          const estado = c.revogadaEm === null ? 'ativa' : `revogada em ${c.revogadaEm}`;
          escrever(`${c.id}  emitida em ${c.criadaEm}  ${estado}`);
        }
        return 0;
      }

      if (acao === 'revogar') {
        const id = opcao(argumentos, 'id');
        if (id === undefined) {
          escrever('Uso: malote acesso chave revogar --chave <valor> --id <id>');
          return 2;
        }
        revogarChaveDeAcesso(registro, id);
        escrever(`Chave de Acesso ${id} revogada.`);
        return 0;
      }

      escrever('Uso: malote acesso chave emitir|listar|revogar');
      return 2;
    }

    if (grupo === 'servir') {
      // Como o ouvinte: processo longo, e esta porta e SINCRONA. A recusa de
      // endereco fica aqui tambem, para que o teste possa medi-la sem subir
      // servidor nenhum — e para que errar o endereco falhe cedo, e nao depois
      // de o socket ja estar aberto.
      const recusa = enderecoRecusado(
        opcao(argumentos, 'endereco') ?? '127.0.0.1',
        temBandeira(argumentos, 'exposto'),
      );
      if (recusa !== null) {
        escrever(recusa);
        return 2;
      }
      escrever('O servidor nao roda por esta porta. Invoque `malote servir` no terminal.');
      return 2;
    }

    if (grupo === 'ouvir') {
      // O ouvinte e um processo longo, e esta porta e SINCRONA — 528 testes
      // chamam `executar()` e esperam um numero de volta. O despacho dele
      // acontece no bloco de entrada, e este ramo existe para que quem chegar
      // por aqui receba uma frase, e nao "comando desconhecido".
      escrever('O ouvinte nao roda por esta porta. Invoque `malote ouvir` no terminal.');
      return 2;
    }

    if (grupo === 'ouvinte' && sub === 'estado') {
      const conta = opcao(argumentos, 'conta');
      if (conta === undefined) {
        escrever('Uso: malote ouvinte estado --conta <nome>');
        return 2;
      }
      // Ler o efeito NAO abre o Acervo: abrir para escrita MIGRA a base, e um
      // verificador que roda de minuto em minuto nao pode ter esse poder.
      // Contar o derrame le OUTRO arquivo, e preserva essa propriedade.
      const caminhosDoEstado = caminhosDaConta(ambiente.estado, conta);
      const instante = lerUltimoEvento(caminhosDoEstado.ultimoEvento);
      if (instante === null) {
        escrever(`Conta ${conta}: sem evento registrado.`);
        return 1;
      }
      // A CONTAGEM ENTRA SO NO --json, E ISSO NAO E ESTILO.
      //
      // O watchdog da frota (`jd-health-check`) passa a saida INTEIRA para
      // `date -u -d "$saida"`. Uma linha a mais e a conversao falha nos dois
      // ramos, o instante vira 0, e a idade calculada conta desde 1970 —
      // alarme de silencio em toda execucao, em todas as contas. Medido em
      // 09/09/2026, lendo o consumidor real antes de mexer na saida.
      //
      // `derramados` conta EVENTOS e `lotes` conta a unidade da drenagem: um
      // lote de cinco e UM lote e CINCO eventos, e quem pergunta "o que esta
      // parado?" quer o segundo numero.
      if (temBandeira(argumentos, 'json')) {
        escrever(
          JSON.stringify({
            conta,
            ultimoEvento: new Date(instante).toISOString(),
            derramados: contarEventosDerramados(caminhosDoEstado.derrame),
            lotes: contarDerrame(caminhosDoEstado.derrame),
            // A serie de vigilancia da fonte de correspondencia (#775), em
            // baldes diarios. SO aqui, nunca na saida default: o watchdog da
            // frota converte a saida INTEIRA com `date -u -d`, e uma linha a
            // mais faria o instante virar 0 e alarmar silencio em toda conta,
            // em toda execucao. Medido em 09/09/2026.
            //
            // Contagem crua e sem juizo: quem compara com a linha de base e
            // decide se a fonte secou e a frota. O produto conta.
            correspondencia: lerCorrespondencia(caminhosDoEstado.correspondencia),
            // O ultimo Retrato de Estado recebido, ou `null`. E `null` NAO e
            // zero: sem este campo, "nenhuma Conversa marcada" e "o retrato
            // nao veio" viram a mesma resposta, e so na segunda e que nao se
            // pode concluir nada. A fixacao so chega por Retrato, e ele chegou
            // uma vez em nove dias — reiniciar o processo nao o provoca.
            ultimoRetrato: lerUltimoRetrato(caminhosDoEstado.retrato),
            pulos: lerPulos(caminhosDoEstado.pulos),
          }),
        );
        return 0;
      }
      escrever(new Date(instante).toISOString());
      return 0;
    }

    if (grupo === 'ouvinte' && sub === 'reprocessar') {
      const conta = opcao(argumentos, 'conta');
      const inquilino = opcao(argumentos, 'inquilino');
      const apelido = opcao(argumentos, 'configuracao');
      if (conta === undefined || inquilino === undefined || apelido === undefined) {
        escrever(
          'Uso: malote ouvinte reprocessar --inquilino <id> --conta <nome> --configuracao <apelido>',
        );
        return 2;
      }
      const cfgDoDerrame = configuracaoPorApelido(registro, inquilino, 'whatsapp', apelido);
      if (cfgDoDerrame === undefined) {
        throw new Error(
          `Configuracao "${apelido}" nao existe no Inquilino ${inquilino}. ` +
            'Reprocessar NAO cria: o evento derramado pertence a conta que o recebeu.',
        );
      }
      // UM DONO POR VEZ. Ver `ouvinteEscrevendoNoSistema`.
      if ((ambiente.ouvinteEscrevendo ?? ouvinteEscrevendoNoSistema)(conta)) {
        escrever(
          `Ha um ouvinte escrevendo na conta ${conta}, e ele tambem grava no derrame. ` +
            'Pare o servico antes de reprocessar: dois escritores no mesmo arquivo perdem lote ' +
            '— o que for derramado entre a leitura e o descarte some sem ter sido gravado.',
        );
        return 2;
      }
      const caminhoDoDerrame = caminhosDaConta(ambiente.estado, conta).derrame;
      const lotes = lerDerrame(caminhoDoDerrame);
      if (lotes.length === 0) {
        escrever(`Conta ${conta}: nada derramado. Nada a fazer.`);
        return 0;
      }
      const acervoDoDerrame = acervoDoInquilino(registro, ambiente.dados, inquilino);
      let gravados = 0;
      let lotesFeitos = 0;
      try {
        // Um lote de cada vez, e PARA no primeiro que nao passar. Seguir em
        // frente deixaria buraco no meio do arquivo, e o arquivo e a ordem em
        // que os eventos chegaram.
        for (const lote of lotes) {
          const r = receberEvento(acervoDoDerrame, lote as never, {
            agora: Date.now(),
            configuracao: { id: cfgDoDerrame.id, fonte: 'whatsapp' },
          });
          gravados += r.gravados;
          lotesFeitos += 1;
        }
      } finally {
        acervoDoDerrame.fechar();
      }
      // So descarta com TUDO reprocessado. Descartar parcial perderia
      // exatamente o que o derrame existe para nao perder.
      if (lotesFeitos === lotes.length) {
        descartarDerrame(caminhoDoDerrame);
        escrever(`Conta ${conta}: ${lotesFeitos} lote(s) reprocessado(s), ${gravados} gravada(s).`);
        escrever('Derrame esvaziado.');
        return 0;
      }
      escrever(
        `Conta ${conta}: ${lotesFeitos} de ${lotes.length} lote(s) reprocessado(s). ` +
          'O derrame FICA — rode de novo depois de resolver a causa.',
      );
      return 1;
    }

    if (grupo === 'operador' && sub === 'chave' && acao === 'criar') {
      autorizarBootstrap(registro, chave, identidade);
      const criada = criarChaveDeOperador(registro);
      escrever('Chave de Operador criada.');
      escrever(`  id:    ${criada.id}`);
      escrever(`  valor: ${criada.valor}`);
      escrever('Guarde agora: este valor nao e recuperavel depois.');
      return 0;
    }

    if (grupo === 'operador' && sub === 'chave' && acao === 'listar') {
      autorizarAdministracao(registro, chave, identidade);
      for (const c of listarChavesDeOperador(registro)) {
        const estado = c.revogadaEm === null ? 'ativa' : `revogada em ${c.revogadaEm}`;
        escrever(`${c.id}  criada em ${c.criadaEm}  ${estado}`);
      }
      return 0;
    }

    if (grupo === 'operador' && sub === 'chave' && acao === 'revogar') {
      autorizarAdministracao(registro, chave, identidade);
      const id = opcao(argumentos, 'id');
      if (id === undefined) throw new Error('Informe --id da Chave a revogar.');
      revogarChaveDeOperador(registro, id);
      escrever(`Chave ${id} revogada.`);
      return 0;
    }

    if (grupo === 'inquilino' && sub === 'criar') {
      autorizarAdministracao(registro, chave, identidade);
      const titular = opcao(argumentos, 'titular');
      if (titular === undefined) throw new Error('Informe --titular.');
      const id = criarInquilino(registro, { titularNome: titular });
      escrever('Inquilino criado.');
      escrever(`  id: ${id}`);
      return 0;
    }

    if (grupo === 'inquilino' && sub === 'listar') {
      autorizarAdministracao(registro, chave, identidade);
      const todos = listarInquilinos(registro);
      if (temBandeira(argumentos, 'json')) {
        escrever(JSON.stringify(todos, null, 2));
      } else {
        for (const i of todos) escrever(`${i.id}  ${i.titularNome}  criado em ${i.criadoEm}`);
      }
      return 0;
    }

    if (grupo === 'inquilino' && sub === 'destino') {
      autorizarAdministracao(registro, chave, identidade);
      const inquilino = opcao(argumentos, 'inquilino');
      const endereco = opcao(argumentos, 'endereco');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');
      if (endereco === undefined) throw new Error('Informe --endereco.');
      configurarDestinoDeMidia(registro, inquilino, { natureza: 'local', endereco });
      escrever(`Destino de Midia do Inquilino ${inquilino} apontado para ${endereco}.`);
      return 0;
    }

    if (grupo === 'material' && sub === 'listar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        for (const cfg of listarConfiguracoes(registro, inquilino)) {
          const materiais = listarMateriais(acervo, cfg.id);
          escrever(`${cfg.fonte}/${cfg.apelido}  ${materiais.length} material(is)`);
          for (const m of materiais) {
            escrever(
              `  ${m.impressao.slice(0, 12)}  ${m.registradoEm}  ` +
                `${m.conversasCriadas} conversas, ${m.mensagensCriadas} mensagens`,
            );
          }
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'material' && sub === 'varrer') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) {
        escrever('Uso: malote material varrer --inquilino <id> [--configuracao <apelido>]');
        return 2;
      }
      const apelido = opcao(argumentos, 'configuracao');
      // O ATOR e o que distingue execucao automatica de ato do Titular, e o
      // escopo e aninhado de proposito: a CLI ja declarou `local` ou
      // `operador:<id>` na invocacao, e o de dentro vence. Mesmo precedente de
      // `ouvir.ts`, que declara `servico:ouvinte-whatsapp` em tres sitios.
      //
      // NAO vem de flag. Flag e rotulo autodeclarado pelo chamador, e o
      // vocabulario do Ator e fechado POR MECANISMO: quem roda `malote
      // importar` a mao nao consegue se passar por servico.
      const r = comAtor(atorDeServico('varredura'), () =>
        varrer(registro, {
          dados: ambiente.dados,
          inquilinoId: inquilino,
          ...(apelido !== undefined ? { apenasConfiguracao: apelido } : {}),
        }),
      );

      let houveFalha = false;
      for (const c of r.configuracoes) {
        escrever(
          `${c.fonte}/${c.apelido}  ${c.processados} processado(s), ` +
            `${c.recusados} recusado(s), ${c.falhas} falha(s)`,
        );
        for (const m of c.motivos) escrever(`    ${m}`);
        if (c.falhas > 0) houveFalha = true;
      }
      if (r.configuracoes.length === 0) escrever('Nenhuma Configuracao vigiada.');
      // Recusa NAO sai 1: material errado na pasta e estado normal, e o
      // arquivo fica la para quem o pos olhar. Falha e o caminho que sumiu.
      return houveFalha ? 1 : 0;
    }

    if (grupo === 'material' && sub === 'intervalo') {
      const inquilino = opcao(argumentos, 'inquilino');
      const dias = opcao(argumentos, 'dias');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      if (dias === undefined) throw new Error('Informe --dias <n>.');
      const cfg = resolverConfiguracao(
        registro,
        inquilino,
        opcao(argumentos, 'fonte') ?? 'whatsapp',
        opcao(argumentos, 'configuracao'),
      );
      definirIntervaloEsperado(registro, cfg.id, Number(dias));
      escrever(`Intervalo de ${dias} dia(s) declarado para ${cfg.fonte}/${cfg.apelido}.`);
      return 0;
    }

    // O unico comando deste ciclo que existe para o caso em que NADA acontece.
    // Le o Estado de Sincronizacao e o relogio; nao abre material nenhum. E o
    // que o faz funcionar justamente quando material novo deixou de chegar —
    // alarme cujo produtor roda dentro do que ele vigia nao detecta a propria
    // ausencia. O contrato e o CODIGO DE SAIDA, para pendurar em agendador.
    if (grupo === 'material' && sub === 'atraso') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        let algumAtrasado = false;
        for (const cfg of listarConfiguracoes(registro, inquilino)) {
          const intervalo = lerIntervaloEsperado(registro, cfg.id);
          if (intervalo === null) {
            escrever(`${cfg.fonte}/${cfg.apelido}  sem intervalo declarado`);
            continue;
          }
          // Sem Material, a contagem corre desde a DECLARACAO: instalacao
          // configurada e ingestao que nunca rodou e o caso que mais importa,
          // e ficaria em silencio se ausencia fosse lida como nada a cobrar.
          const ultimo = ultimoMaterial(acervo, cfg.id);
          const referencia = ultimo?.registradoEm ?? intervalo.declaradoEm;
          const dias = Math.floor((Date.now() - Date.parse(referencia)) / 86_400_000);
          const desde = ultimo === null ? 'nenhum Material desde a declaracao' : 'ultimo Material';
          if (dias > intervalo.dias) {
            algumAtrasado = true;
            escrever(
              `${cfg.fonte}/${cfg.apelido}  ATRASADA: ${desde} ha ${dias} dia(s), ` +
                `esperado a cada ${intervalo.dias}`,
            );
          } else {
            escrever(`${cfg.fonte}/${cfg.apelido}  em dia (${desde} ha ${dias} dia(s))`);
          }
        }
        return algumAtrasado ? 1 : 0;
      } finally {
        acervo.fechar();
      }
    }

    if (grupo === 'acervo' && sub === 'relatar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const destino = lerDestinoDeMidia(registro, inquilino);

      // Inquilino criado e nunca importado nao tem arquivo de Acervo, e o
      // `readonly` do SQLite estoura com erro cru do driver. Reportar zero e a
      // resposta certa, e e a mesma que `operador espaco` da.
      if (!existsSync(join(ambiente.dados, 'acervos', `${inquilino}.db`))) {
        escrever('Acervo vazio: nenhum material foi importado para este Inquilino.');
        return 0;
      }

      // So leitura, e por CONSTRUCAO: o SQLite recusa gravar neste handle.
      const acervo = abrirAcervoSomenteLeitura(join(ambiente.dados, 'acervos'), inquilino);
      try {
        const r = relatarAcervo(acervo, { agora: Date.now() });
        escrever(
          `Anexos: ${r.total.anexos}  (${r.total.anexosPresentes} presentes, ` +
            `${r.total.anexosNuncaObtidos} nunca obtidos, ${r.total.anexosDescartados} descartados)`,
        );
        escrever(
          `Bytes: ${r.total.bytesPresentes} presentes de ${r.total.bytesDeclarados} declarados`,
        );
        if (r.total.anexosSemTamanhoDeclarado > 0) {
          escrever(
            `  ${r.total.anexosSemTamanhoDeclarado} Anexos sem tamanho declarado pelo material`,
          );
        }
        for (const [rotulo, mapa] of [
          ['Fonte', r.porFonte],
          ['Tipo', r.porTipo],
          ['Conversa', r.porNaturezaDeConversa],
          ['Idade', r.porFaixaDeIdade],
        ] as const) {
          escrever(`Por ${rotulo}:`);
          for (const [chave, v] of Object.entries(mapa)) {
            // Os DOIS numeros: com nada trazido, `bytesPresentes` e zero em
            // todo recorte, e o que informa decisao e o declarado.
            escrever(
              `  ${chave}: ${v.anexos} anexos, ${v.bytesDeclarados} declarados, ` +
                `${v.bytesPresentes} em disco`,
            );
          }
        }

        if (destino === undefined) {
          escrever('Destino de Midia nao configurado: nao ha disco a conferir.');
        } else {
          const d = conferirDisco(acervo, destino.endereco);
          if (!d.conferiu) {
            escrever('Destino inacessivel: NAO foi possivel conferir o disco.');
          } else {
            escrever(
              `Divergencia: ${d.presentesSemArquivo.length} presentes sem arquivo, ` +
                `${d.arquivosSemAnexo.length} arquivos sem Anexo, ` +
                `${d.tamanhoDivergente.length} com tamanho diferente`,
            );
          }
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'operador' && sub === 'espaco') {
      autorizarAdministracao(registro, chave, identidade);
      for (const i of listarInquilinos(registro)) {
        // Inquilino criado e nunca importado nao tem arquivo de Acervo, e o
        // `readonly` do SQLite LANCA SQLITE_CANTOPEN. Reportar zero e a
        // resposta certa: existe e nao ocupa nada, o que nao e erro.
        if (!existsSync(join(ambiente.dados, 'acervos', `${i.id}.db`))) {
          escrever(`${i.id}  0 anexos  0 bytes em disco  0 declarados`);
          continue;
        }
        // Acervo de versao divergente LANCA na abertura. Sem este catch, um
        // Inquilino desatualizado derruba o consolidado INTEIRO — e esta e a
        // ferramenta de quem administra varios. Degrada por linha.
        let acervo;
        try {
          acervo = abrirAcervoSomenteLeitura(join(ambiente.dados, 'acervos'), i.id);
        } catch (causa) {
          if (causa instanceof AcervoDeOutraVersaoError) {
            escrever(
              `${i.id}  Acervo de outra versao — rode "malote acervo migrar" antes de relatar`,
            );
            continue;
          }
          throw causa;
        }
        try {
          const r = relatarAcervo(acervo, { agora: Date.now() });
          // Contagens e bytes. Nunca titulo de Conversa, nunca texto.
          escrever(
            `${i.id}  ${r.total.anexos} anexos  ${r.total.bytesPresentes} bytes em disco  ` +
              `${r.total.bytesDeclarados} declarados`,
          );
        } finally {
          acervo.fechar();
        }
      }
      return 0;
    }

    if (grupo === 'midia' && sub === 'trazer') {
      const inquilino = opcao(argumentos, 'inquilino');
      const material = opcao(argumentos, 'material');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      if (material === undefined) throw new Error('Informe --material <caminho>.');

      // `lerDestinoDeMidia` devolve `undefined`, nao `null`. O ciclo 1 proibiu
      // raiz fixa no codigo: nao existe padrao a inventar, e gravar em lugar
      // arbitrario seria pior que recusar.
      const destino = lerDestinoDeMidia(registro, inquilino);
      if (destino === undefined) {
        throw new Error(
          'Destino de Midia nao configurado para este Inquilino. Rode: ' +
            'malote inquilino destino --chave <valor> --inquilino <id> --endereco <caminho>',
        );
      }

      const conta = opcao(argumentos, 'conta');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const r = trazerArquivos(acervo, material, {
          destino: destino.endereco,
          ...(conta !== undefined ? { conta } : {}),
        });
        escrever('Midia trazida.');
        escrever(`  ${r.copiados} arquivos copiados (${r.bytesCopiados} bytes)`);
        escrever(`  ${r.ausentesDoMaterial} declarados pelo material e ausentes dele`);
        if (r.falhas > 0) escrever(`  ${r.falhas} falharam`);
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'configuracao' && sub === 'listar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const existe = listarInquilinos(registro).some((i) => i.id === inquilino);
      if (!existe) throw new Error(`Inquilino desconhecido: ${inquilino}`);
      for (const c of listarConfiguracoes(registro, inquilino)) {
        escrever(`${c.fonte}/${c.apelido}  conta: ${c.conta ?? '(nao declarada)'}`);
      }
      return 0;
    }

    if (grupo === 'configuracao' && sub === 'criar') {
      const inquilino = opcao(argumentos, 'inquilino');
      const fonte = opcao(argumentos, 'fonte');
      const apelido = opcao(argumentos, 'configuracao');
      if (inquilino === undefined || fonte === undefined || apelido === undefined) {
        escrever(
          'Uso: malote configuracao criar --inquilino <id> --fonte <nome> ' +
            '--configuracao <apelido> [--conta <nome>]',
        );
        return 2;
      }
      const cfg = resolverConfiguracao(registro, inquilino, fonte, apelido);
      const conta = opcao(argumentos, 'conta');
      if (conta !== undefined) definirContaDaConfiguracao(registro, cfg.id, conta);
      escrever(`${fonte}/${apelido}  conta: ${conta ?? cfg.conta ?? '(nao declarada)'}`);
      return 0;
    }

    if (grupo === 'entrada' && sub === 'declarar') {
      const inquilino = opcao(argumentos, 'inquilino');
      const fonte = opcao(argumentos, 'fonte');
      const apelido = opcao(argumentos, 'configuracao');
      const pasta = opcao(argumentos, 'pasta');
      const natureza = opcao(argumentos, 'natureza');
      const titularNaFonte = opcao(argumentos, 'titular-na-fonte');
      if (
        inquilino === undefined || fonte === undefined || apelido === undefined ||
        pasta === undefined || natureza === undefined
      ) {
        escrever(
          'Uso: malote entrada declarar --inquilino <id> --fonte <nome> ' +
            '--configuracao <apelido> --pasta <caminho> --natureza completo|parcial ' +
            '[--titular-na-fonte <nome>]',
        );
        return 2;
      }
      // A natureza e conferida AQUI, e nao so na porta, por causa do codigo de
      // saida: valor errado na linha de comando e erro de USO, e o envelope de
      // erro desta funcao devolve 1, que significa falha de execucao. A porta
      // continua validando para quem a chama por codigo.
      if (natureza !== 'completo' && natureza !== 'parcial') {
        escrever(`--natureza precisa ser completo ou parcial; veio: ${natureza}`);
        return 2;
      }
      // A Fonte tambem. `resolverConfiguracao` CRIA quando nao acha, entao
      // aceitar aqui deixaria uma Configuracao cuja varredura recusa TODO
      // arquivo para sempre — e, com a pasta vazia, sem recusa nenhuma a
      // imprimir: `material varrer` sairia 0 e nada acusaria. Recusa perpetua
      // impressa a cada execucao agendada treina quem le a ignorar a saida.
      if (!FONTES_VARRIVEIS.includes(fonte)) {
        escrever(
          `--fonte ${fonte} nao e varrivel. A varredura processa: ` +
            `${FONTES_VARRIVEIS.join(', ')}. whatsapp chega pelo ouvinte e por ` +
            '"malote importar", nunca por pasta vigiada.',
        );
        return 2;
      }
      // `resolverConfiguracao` CRIA quando nao acha, e aqui isso e o desejado:
      // declarar a pasta de uma conta nova e o primeiro ato dela. O apelido
      // continua EXPLICITO, pela mesma razao do `importar` — adivinhar cria
      // Configuracao paralela em silencio.
      const cfg = resolverConfiguracao(registro, inquilino, fonte, apelido);
      declararPastaDeEntrada(registro, cfg.id, {
        pasta,
        natureza: natureza as NaturezaDoMaterial,
        ...(titularNaFonte !== undefined ? { nomeDoTitularNaFonte: titularNaFonte } : {}),
      });
      escrever(`${fonte}/${apelido}  ${pasta}  (${natureza})`);
      return 0;
    }

    if (grupo === 'entrada' && sub === 'listar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) {
        escrever('Uso: malote entrada listar --inquilino <id>');
        return 2;
      }
      const existe = listarInquilinos(registro).some((i) => i.id === inquilino);
      if (!existe) throw new Error(`Inquilino desconhecido: ${inquilino}`);
      const porId = new Map(
        listarConfiguracoes(registro, inquilino).map((c) => [c.id, c] as const),
      );
      for (const e of listarPastasDeEntrada(registro, inquilino)) {
        const cfg = porId.get(e.configuracaoId);
        if (cfg === undefined) continue;
        const titular =
          e.nomeDoTitularNaFonte === null ? '' : `  titular: ${e.nomeDoTitularNaFonte}`;
        escrever(`${cfg.fonte}/${cfg.apelido}  ${e.pasta}  (${e.natureza})${titular}`);
      }
      return 0;
    }

    if (grupo === 'importar') {
      const inquilino = opcao(argumentos, 'inquilino');
      const fonte = opcao(argumentos, 'fonte');
      const material = opcao(argumentos, 'material');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');
      if (material === undefined) throw new Error('Informe --material.');
      const titular = opcao(argumentos, 'titular');
      if (fonte !== 'whatsapp' && fonte !== 'instagram' && fonte !== 'contatos') {
        throw new Error('Fontes suportadas: whatsapp, instagram, contatos.');
      }
      if (fonte === 'instagram' && titular === undefined) {
        throw new Error('Informe --titular: o nome de exibicao do Titular nesta Fonte.');
      }

      // O apelido e EXPLICITO desde 08/09/2026, e nao ha mais default.
      //
      // `resolverConfiguracao` CRIA quando nao acha. Enquanto o default era
      // `padrao` e a Configuracao de producao tambem se chamava assim,
      // adivinhar acertava por coincidencia. Com o apelido de producao
      // renomeado para `pessoal`, um `importar` sem a flag criaria uma
      // Configuracao `padrao` PARALELA, em silencio, e as Conversas diretas
      // dela nasceriam num fio a parte.
      const apelidoDaConfiguracao = opcao(argumentos, 'configuracao');
      if (apelidoDaConfiguracao === undefined) {
        throw new Error(
          'Informe --configuracao <apelido>. Nao ha apelido padrao: adivinhar cria ' +
            'Configuracao nova em silencio, e as Conversas diretas dela nascem num fio a parte.',
        );
      }

      const cfg = resolverConfiguracao(
        registro,
        inquilino,
        fonte,
        apelidoDaConfiguracao,
      );
      const conta = opcao(argumentos, 'conta');
      if (conta !== undefined) definirContaDaConfiguracao(registro, cfg.id, conta);

      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);

      // O catalogo tem ramo proprio: nao tem conta nem titular, e o relatorio
      // dele nao e o compartilhado — ele nao produz Conversa nem Mensagem.
      if (fonte === 'contatos') {
        try {
          const r = importarCatalogo(acervo, material, {
            agora: Date.now(),
            configuracaoId: cfg.id,
            reprocessar: temBandeira(argumentos, 'reprocessar'),
          });
          if (r.jaRegistrado) {
            const anterior = ultimoMaterial(acervo, cfg.id);
            escrever(`Material ja entrou em ${anterior?.registradoEm ?? '(data desconhecida)'}.`);
            escrever('Nada a fazer. Use --reprocessar para percorrer assim mesmo.');
            return 0;
          }
          escrever('Importacao de catalogo concluida.');
          escrever(`  ${r.cartoesLidos} cartoes lidos`);
          escrever(
            `  ${r.identificadoresCriados} identificadores novos, ${r.identificadoresJaExistentes} ja existentes`,
          );
          escrever(`  ${r.nomesCriados} nomes novos, ${r.nomesJaExistentes} ja existentes`);
          if (r.cartoesSemTelefone > 0) {
            escrever(
              `  ${r.cartoesSemTelefone} cartoes sem telefone (${r.cartoesSemContatoAlgum} sem contato algum)`,
            );
          }
        } finally {
          acervo.fechar();
        }
        return 0;
      }

      try {
        const r =
          fonte === 'whatsapp'
            ? importarMaterial(acervo, material, {
                agora: Date.now(),
                conta: conta ?? cfg.conta ?? CONTA_PADRAO,
                configuracao: { id: cfg.id, fonte: 'whatsapp' },
                reprocessar: temBandeira(argumentos, 'reprocessar'),
              })
            : importarMaterialDeInstagram(acervo, material, {
                agora: Date.now(),
                titular: titular ?? '',
                configuracao: { id: cfg.id, fonte: 'instagram' },
                reprocessar: temBandeira(argumentos, 'reprocessar'),
              });

        // Rodada sem efeito e rodada sem material sao coisas diferentes, e o
        // comando precisa dizer qual foi.
        if (r.jaRegistrado) {
          const anterior = ultimoMaterial(acervo, cfg.id);
          escrever(`Material ja entrou em ${anterior?.registradoEm ?? '(data desconhecida)'}.`);
          escrever('Nada a fazer. Use --reprocessar para percorrer assim mesmo.');
          return 0;
        }
        escrever('Importacao concluida.');
        escrever(
          `  ${r.conversasCriadas} conversas novas, ${r.conversasJaExistentes} ja existentes`,
        );
        escrever(
          `  ${r.mensagensCriadas} mensagens novas, ${r.mensagensJaExistentes} ja existentes`,
        );
        escrever(`  ${r.anexosCriados} anexos novos, ${r.anexosJaExistentes} ja existentes`);
        if (r.transicoesCriadas > 0) {
          escrever(`  ${r.transicoesCriadas} transicoes de participacao novas`);
        }
        if (r.participantesAtivos > 0 || r.participantesInativos > 0) {
          escrever(
            `  ${r.participantesAtivos} ativos, ${r.participantesInativos} inativos ` +
              '(conforme a Fonte declara, em Conversa coletiva)',
          );
        }
        const desconhecidos = Object.entries(r.eventosDesconhecidos);
        if (desconhecidos.length > 0) {
          const total = desconhecidos.reduce((soma, [, quantas]) => soma + quantas, 0);
          escrever(`  ${total} eventos de grupo NAO classificados, por codigo da Fonte:`);
          // Ordenado por volume, e NUNCA truncado: omitir codigo raro
          // esconderia justamente o evento novo que a Fonte passou a emitir.
          for (const [codigo, quantas] of desconhecidos.sort((a, b) => b[1] - a[1])) {
            escrever(`    ${quantas}  codigo ${codigo}`);
          }
          escrever('  Codigo nao classificado nunca vira Transicao — ele fica contado aqui.');
        }
        for (const [caixa, quantas] of Object.entries(r.conversasPorCaixa)) {
          escrever(`  ${quantas} conversas na caixa ${caixa}`);
        }
        if (r.conversasSemArquivo > 0) escrever(`  ${r.conversasSemArquivo} conversas sem arquivo`);
        if (r.colisoesDesempatadas > 0) {
          escrever(`  ${r.colisoesDesempatadas} colisoes desempatadas`);
        }
        if (r.mensagensRejeitadas > 0) {
          escrever(`  ${r.mensagensRejeitadas} rejeitada(s):`);
          for (const [motivo, quantas] of Object.entries(r.rejeicoesPorMotivo)) {
            escrever(`    ${quantas}  ${motivo}`);
          }
        }
        // Numero que fica no relatorio e nao chega a tela e o mesmo silencio,
        // uma camada acima. Rotulo PROPRIO — "descartada na leitura" — porque
        // quem opera precisa distinguir material contraditorio de decisao da
        // importacao.
        // MARCA DO TITULAR: o que o dono da conta destacou no material.
        if (r.favoritos > 0) {
          escrever(`  ${r.favoritos} Mensagem(ns) favoritada(s) pelo Titular`);
        }
        // RECUSA CONTADA, e visivel. O contador existia desde o ciclo 18 e nao
        // era impresso — e recusa que ninguem ve e recusa silenciosa, que e
        // exatamente o defeito que o ciclo 17 fechou em outro lugar.
        if (r.nomesQueRepetemOEndereco > 0) {
          escrever(
            `  ${r.nomesQueRepetemOEndereco} nome(s) recusado(s) por repetirem o proprio endereco`,
          );
        }
        if (r.linhasRepetidasNoMaterial > 0) {
          escrever(
            `  ${r.linhasRepetidasNoMaterial} linha(s) repetida(s) NO MATERIAL — contam como ja existentes, e nao estavam no acervo`,
          );
        }
        const descartes = Object.entries(r.descartesDoLeitor);
        if (descartes.length > 0) {
          const total = descartes.reduce((a, [, q]) => a + q, 0);
          escrever(`  ${total} descartada(s) na leitura — o material se contradiz:`);
          for (const [motivo, quantas] of descartes) escrever(`    ${quantas}  ${motivo}`);
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'conversa' && sub === 'presenca') {
      const inquilino = opcao(argumentos, 'inquilino');
      const conversa = opcao(argumentos, 'conversa');
      const em = opcao(argumentos, 'em');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');
      if (conversa === undefined) throw new Error('Informe --conversa <id>.');
      if (em === undefined) throw new Error('Informe --em <AAAA-MM-DD>.');
      // Data sem hora e um DIA, nao um instante. `Date.parse` a resolve como
      // meia-noite UTC, e comparar meia-noite com o instante do primeiro
      // evento faz uma data DENTRO do alcance ser reportada como fora —
      // medido em 30/08/2026 contra material real, numa Conversa cujo alcance
      // comeca e termina no mesmo dia. O dia inteiro se representa pelo seu
      // FIM: "quem estava, ao final deste dia".
      const soData = /^\d{4}-\d{2}-\d{2}$/.test(em);
      const base = Date.parse(em);
      if (Number.isNaN(base)) throw new Error(`Data invalida em --em: ${em}`);
      const fimDoDia = base + 86_399_999;

      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        if (!conversaExiste(acervo, conversa)) {
          escrever(`Conversa desconhecida: ${conversa}`);
          return 2;
        }

        // O fim do dia e CAPADO ao fim do Alcance. Sem isso, perguntar pelo
        // ULTIMO dia do Alcance responde "fora dele" — o ultimo evento daquele
        // dia e de manha, e 23h59 vem depois. O caso e o comum, nao a borda:
        // e a data que o proprio comando imprime como fim do Alcance.
        const janela = alcanceDaConversa(acervo, conversa);
        let quando = soData ? fimDoDia : base;
        if (soData && janela !== null && quando > janela.ate && base <= janela.ate) {
          quando = janela.ate;
        }

        const r = quemEstavaEm(acervo, { conversaId: conversa, em: quando });
        if (temBandeira(argumentos, 'json')) {
          escrever(JSON.stringify(r, null, 2));
          return 0;
        }

        if (r.alcance === null) {
          escrever(`Conversa ${conversa} nao tem alcance: a Fonte nao declarou evento algum.`);
          escrever('Sem alcance, o quadro de hoje NAO responde por uma data passada.');
        } else {
          const de = new Date(r.alcance.de).toISOString().slice(0, 10);
          const ate = new Date(r.alcance.ate).toISOString().slice(0, 10);
          escrever(`Conversa ${conversa} — em ${em}${soData ? ' (ao final do dia)' : ''}`);
          escrever(
            `alcance: ${de} a ${ate}${r.dentroDoAlcance ? '' : '  (a data esta FORA dele)'}`,
          );
        }
        escrever('');
        escrever(`  presente ............. ${r.presentes.length}`);
        escrever(`  saiu antes ........... ${r.sairamAntes.length}`);
        escrever(`  ainda nao entrou ..... ${r.aindaNaoEntraram.length}`);
        escrever(`  sem informacao ....... ${r.semInformacao.length}`);
        escrever('');
        escrever(`  ${r.ressalva.soDentroDoAlcance}`);
        escrever(`  ${r.ressalva.semInformacaoNaoEAusencia}`);
        return 0;
      } finally {
        acervo.fechar();
      }
    }

    if (grupo === 'conversas' && sub === 'sem-endereco') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const limite = opcao(argumentos, 'limite');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const precedencia = lerPrecedenciasDeNome(registro, inquilino);
        const filtro = limite === undefined ? {} : { limite: Number(limite) };
        for (const l of listarSemEndereco(acervo, precedencia, filtro)) {
          escrever(
            `${l.mensagens}\t${l.conversas}\t${l.nome ?? '(sem nome)'}\t${l.fonte}\t` +
              `${l.valor}\t${l.identificadorId}`,
          );
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoas') {
      const texto = opcao(argumentos, 'texto');
      if (texto === undefined) throw new Error('Informe --texto.');
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const achadas = procurarPessoas(acervo, { texto });
        escrever(JSON.stringify({ pessoas: achadas }, null, 2));
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'participantes') {
      const conversa = opcao(argumentos, 'conversa');
      if (conversa === undefined) throw new Error('Informe --conversa <id>.');
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');
      const emParam = opcao(argumentos, 'em');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        // Sem --em: agora. Com --em: fim do dia capado ao Alcance, a regra
        // medida que o CONTEXTO registra.
        const em = emParam === undefined ? Date.now() : expandirData(emParam, 'fim');
        escrever(JSON.stringify(quemEstavaEm(acervo, { conversaId: conversa, em }), null, 2));
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'mensagens') {
      const conversa = opcao(argumentos, 'conversa');
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const desde = opcao(argumentos, 'desde');
        const ate = opcao(argumentos, 'ate');
        const autor = opcao(argumentos, 'autor');
        const fonte = opcao(argumentos, 'fonte');
        const direcaoOpcao = opcao(argumentos, 'direcao');
        if (direcaoOpcao !== undefined && direcaoOpcao !== 'enviada' && direcaoOpcao !== 'recebida') {
          escrever('--direcao aceita "enviada" ou "recebida".');
          return 2;
        }
        const limite = opcao(argumentos, 'limite');
        const antes = opcao(argumentos, 'antes');
        const ordemOpcao = opcao(argumentos, 'ordem');
        // Default diverge por PROPOSITO: com --conversa, cronologica (o
        // comportamento de sempre, sem regressao); sem --conversa, recentes
        // primeiro — e para isso que a consulta sem Conversa existe.
        const ordemDefault = conversa === undefined ? 'recentes' : 'cronologica';
        const ordem = ordemOpcao === 'cronologica' || ordemOpcao === 'recentes' ? ordemOpcao : ordemDefault;
        const mensagens = lerMensagens(acervo, {
          ...(conversa !== undefined ? { conversaId: conversa } : {}),
          ...(desde === undefined ? {} : { de: expandirData(desde, 'inicio') }),
          ...(ate === undefined ? {} : { ate: expandirData(ate, 'fim') }),
          ...(autor === undefined ? {} : { pessoaId: autor }),
          ...(fonte === undefined ? {} : { fonte: fonte as Fonte }),
          ...(direcaoOpcao === undefined ? {} : { direcao: direcaoOpcao }),
          ...(limite === undefined ? {} : { limite: Number(limite) }),
          ordem,
          ...(antes === undefined
            ? {}
            : {
                cursor:
                  decodificarCursor(antes) ??
                  (() => {
                    throw new Error('Cursor invalido — devolva o token proximo tal como recebeu.');
                  })(),
              }),
        });
        if (temBandeira(argumentos, 'json')) {
          escrever(JSON.stringify(mensagens, null, 2));
        } else {
          for (const m of mensagens) {
            escrever(`${new Date(m.ocorridaEm).toISOString()}  ${m.conteudo ?? '(sem texto)'}`);
          }
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'conversas') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        // Espalhamento condicional, e nao `{ pessoaId: opcao(...) }`: com
        // exactOptionalPropertyTypes, propriedade opcional nao aceita
        // `undefined` explicito, e o tipo de `opcao` e `string | undefined`.
        const pessoa = opcao(argumentos, 'pessoa');
        const busca = opcao(argumentos, 'busca');
        const fonte = opcao(argumentos, 'fonte');
        const coletiva = opcao(argumentos, 'coletiva');
        const limite = opcao(argumentos, 'limite');
        const configuracaoApelido = opcao(argumentos, 'configuracao');
        const fixada = opcao(argumentos, 'fixada');

        if (fixada === 'true' && configuracaoApelido === undefined) {
          escrever('--fixada exige --configuracao (a Marca e por Configuracao).');
          return 2;
        }

        let configuracaoId: string | undefined;
        if (configuracaoApelido !== undefined) {
          const resolucao = resolverFiltroDeConfiguracao(registro, inquilino, configuracaoApelido, fonte);
          if (!resolucao.ok) {
            // Valor errado na linha de comando e erro de uso — codigo 2, nao
            // o 1 generico do catch externo (precedente de 12/09, ator.test.ts).
            escrever(resolucao.erro);
            return 2;
          }
          configuracaoId = resolucao.configuracao.id;
        }

        // Mesma composicao da rota de rede: com fixada ativo, configuracao
        // escopa a MARCA, e o filtro acontece depois, em JS.
        const marcadas = fixada === 'true'
          ? new Set(conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: configuracaoId! }))
          : undefined;

        const apelidoPorId = new Map(
          listarConfiguracoes(registro, inquilino).map((c) => [c.id, c.apelido]),
        );

        let conversas = listarConversas(acervo, {
          ...(pessoa === undefined ? {} : { pessoaId: pessoa }),
          ...(busca === undefined ? {} : { busca }),
          ...(fonte === undefined ? {} : { fonte: fonte as Fonte }),
          ...(coletiva === undefined ? {} : { coletiva: coletiva === 'true' }),
          ...(marcadas === undefined && limite !== undefined ? { limite: Number(limite) } : {}),
          ...(marcadas === undefined && configuracaoId !== undefined ? { configuracaoId } : {}),
        }).map((c) => ({
          id: c.id,
          fonte: c.fonte,
          coletiva: c.coletiva,
          assunto: c.assunto,
          mensagens: c.mensagens,
          configuracao: c.configuracaoId === null ? null : (apelidoPorId.get(c.configuracaoId) ?? null),
        }));

        if (marcadas !== undefined) {
          conversas = conversas.filter((c) => marcadas.has(c.id));
          if (limite !== undefined) conversas = conversas.slice(0, Number(limite));
        }

        if (temBandeira(argumentos, 'json')) {
          escrever(JSON.stringify(conversas, null, 2));
        } else {
          for (const c of conversas) {
            const natureza = c.coletiva ? 'coletiva' : 'direta';
            escrever(`${c.id}  ${natureza}  ${c.mensagens} msgs  ${c.assunto ?? ''}`);
          }
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'buscar') {
      const inquilino = opcao(argumentos, 'inquilino');
      const texto = opcao(argumentos, 'texto');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');
      if (texto === undefined) throw new Error('Informe --texto.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const pessoa = opcao(argumentos, 'pessoa');
        const conversa = opcao(argumentos, 'conversa');
        const desde = opcao(argumentos, 'desde');
        const ate = opcao(argumentos, 'ate');
        const limite = opcao(argumentos, 'limite');
        const achadas = buscarMensagens(acervo, {
          texto,
          ...(pessoa === undefined ? {} : { pessoaId: pessoa }),
          ...(conversa === undefined ? {} : { conversaId: conversa }),
          ...(desde === undefined ? {} : { de: expandirData(desde, 'inicio') }),
          ...(ate === undefined ? {} : { ate: expandirData(ate, 'fim') }),
          ...(limite === undefined ? {} : { limite: Number(limite) }),
        });
        if (temBandeira(argumentos, 'json')) {
          escrever(JSON.stringify(achadas, null, 2));
        } else {
          for (const m of achadas) {
            escrever(`${new Date(m.ocorridaEm).toISOString()}  ${m.conteudo ?? '(sem texto)'}`);
            for (const a of m.anexos) {
              // A Presenca vai SEMPRE, inclusive `presente`: mostrar so o
              // descartado ensinaria que anexo sem aviso e anexo em disco, e a
              // ausencia de aviso passaria a significar duas coisas.
              const tamanho = a.tamanho === null ? 'tamanho desconhecido' : `${a.tamanho} bytes`;
              escrever(`    [${a.tipo}, ${tamanho}] ${a.presenca}`);
            }
          }
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'propostas' && acao === 'aplicar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const produtor = opcao(argumentos, 'produtor');
      if (produtor !== undefined && !(PRODUTORES as readonly string[]).includes(produtor)) {
        throw new Error(`Produtores: ${PRODUTORES.join(', ')}.`);
      }
      const comEfeito = temBandeira(argumentos, 'com-efeito');
      if (comEfeito && !temBandeira(argumentos, 'confirmo')) {
        throw new Error('Repita o comando com --confirmo para executar.');
      }

      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const propostas = propor(listarIdentificadores(acervo)).filter(
          (p) => produtor === undefined || p.produtor === produtor,
        );
        if (!comEfeito) {
          escrever(`Ensaio: ${propostas.length} proposta(s) seriam aplicadas.`);
          const porProdutor: Record<string, number> = {};
          for (const p of propostas) {
            porProdutor[p.produtor] = (porProdutor[p.produtor] ?? 0) + 1;
          }
          for (const [k, v] of Object.entries(porProdutor)) escrever(`  ${v}  ${k}`);
          escrever('Nada foi escrito. Repita com --com-efeito --confirmo.');
          return 0;
        }
        const r = aplicarLote(acervo, propostas, {
          ...(produtor !== undefined ? { produtor: produtor as ProdutorDeProposta } : {}),
        });
        escrever(`${r.aplicadas} de ${r.propostasVistas} proposta(s) aplicadas.`);
        escrever(`  ${r.vinculosCriados} vinculos, ${r.mesclagensFeitas} mesclagens`);
        escrever(`  ${r.pessoasCriadas} Pessoas criadas`);
        if (r.preservadoPorProcedencia > 0) {
          escrever(`  ${r.preservadoPorProcedencia} preservada(s) por procedencia`);
        }
        if (r.recusadoPorConflito > 0) {
          escrever(`  ${r.recusadoPorConflito} recusada(s) por conflito`);
        }
        for (const [motivo, quantas] of Object.entries(r.motivosPorCausa)) {
          escrever(`    ${quantas}  ${motivo}`);
        }
        // O criterio 20: a lista do que foi feito, para quem vai desfazer.
        if (temBandeira(argumentos, 'json')) escrever(JSON.stringify(r, null, 2));
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'propostas') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const produtor = opcao(argumentos, 'produtor');
      if (produtor !== undefined && !(PRODUTORES as readonly string[]).includes(produtor)) {
        throw new Error(`Produtores: ${PRODUTORES.join(', ')}.`);
      }
      const limite = Number(opcao(argumentos, 'limite') ?? 50);

      // Somente leitura por CONSTRUCAO, nao por disciplina: o SQLite recusa
      // gravar por este identificador. E a prova do criterio 10.
      const acervo = abrirAcervoSomenteLeitura(join(ambiente.dados, 'acervos'), inquilino);
      try {
        const todas = propor(listarIdentificadores(acervo)).filter(
          (p) => produtor === undefined || p.produtor === produtor,
        );
        if (temBandeira(argumentos, 'json')) {
          escrever(JSON.stringify(todas, null, 2));
          return 0;
        }
        escrever(`${todas.length} proposta(s).`);
        for (const p of todas.slice(0, limite)) {
          escrever(`  [${p.produtor}] ${p.identificadores.join(' + ')}`);
          escrever(`     ${p.evidencia}`);
        }
        if (todas.length > limite) {
          escrever(`  ... e mais ${todas.length - limite}. Use --limite <n> para ver.`);
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'listar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const precedencia = lerPrecedenciasDeNome(registro, inquilino);
        const filtro = temBandeira(argumentos, 'incluir-absorvidas')
          ? { incluirAbsorvidas: true }
          : {};
        for (const p of listarPessoas(acervo, precedencia, filtro)) {
          const marca = p.absorvidaPor === null ? '' : `  (absorvida por ${p.absorvidaPor})`;
          escrever(
            `${p.id}  ${p.nome ?? '(sem nome)'}  ${p.identificadores.length} endereco(s)${marca}`,
          );
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'ver') {
      const inquilino = opcao(argumentos, 'inquilino');
      const pessoaId = opcao(argumentos, 'pessoa');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      if (pessoaId === undefined) throw new Error('Informe --pessoa <id>.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const precedencia = lerPrecedenciasDeNome(registro, inquilino);
        const p = lerPessoa(acervo, pessoaId, precedencia);
        if (p === null) throw new Error(`Pessoa desconhecida: ${pessoaId}`);

        escrever(`Pessoa: ${p.id}`);
        escrever(`  nome: ${p.nome ?? '(sem nome)'}`);
        if (p.absorvidaPor !== null) escrever(`  absorvida por: ${p.absorvidaPor}`);
        escrever('  enderecos:');
        for (const i of p.identificadores) {
          escrever(`    ${i.fonte}  ${i.valor}  (${i.procedencia}, desde ${i.vinculadoEm})`);
        }
        escrever('  nomes conhecidos:');
        for (const n of p.historico) escrever(`    ${n.nome}  (${n.origem}, ${n.atribuidoEm})`);

        const desfeitos = desvinculosDaPessoa(acervo, pessoaId);
        if (desfeitos.length > 0) {
          escrever('  desfeito:');
          for (const d of desfeitos) {
            escrever(
              `    ${d.fonte}  ${d.valor}  (era ${d.procedencia}, saiu em ${d.desvinculadoEm})`,
            );
          }
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'vincular') {
      const inquilino = opcao(argumentos, 'inquilino');
      const identificador = opcao(argumentos, 'identificador');
      const pessoaPedida = opcao(argumentos, 'pessoa');
      const nome = opcao(argumentos, 'nome');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      if (identificador === undefined) throw new Error('Informe --identificador <id>.');
      if (pessoaPedida === undefined && nome === undefined) {
        throw new Error(
          'Informe --pessoa <id> para ligar a uma Pessoa existente, ou --nome para criar uma.',
        );
      }

      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const pessoaId = pessoaPedida ?? criarPessoa(acervo);
        try {
          vincularIdentificador(acervo, {
            identificadorId: identificador,
            pessoaId,
            // Pela CLI quem afirma e o humano, e e o vinculo que nenhuma
            // execucao automatica desfaz.
            procedencia: 'humano',
          });
        } catch (causa) {
          if (causa instanceof IdentificadorDeOutraPessoaError) {
            // Apresentado, nunca resolvido em silencio: a saida nomeia a
            // Pessoa que ja tem o endereco e diz qual e a operacao certa.
            escrever(causa.message);
            escrever(
              `Para juntar as duas: malote pessoa mesclar --inquilino ${inquilino} ` +
                `--pessoa ${causa.pessoaAtual} --pessoa ${pessoaId} --mestre ${pessoaId}`,
            );
            return 1;
          }
          throw causa;
        }
        if (nome !== undefined) {
          // `titular`: quem digita e o operador afirmando.
          registrarNome(acervo, { pessoaId, origem: 'manual', nome, autoridade: 'titular' });
        }
        escrever(`Pessoa: ${pessoaId}`);
        escrever(`  ${identificador} vinculado com procedencia humano.`);
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'desvincular') {
      const inquilino = opcao(argumentos, 'inquilino');
      const identificador = opcao(argumentos, 'identificador');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      if (identificador === undefined) throw new Error('Informe --identificador <id>.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        desvincularIdentificador(acervo, identificador);
        escrever(
          `${identificador} desvinculado. A Pessoa continua, com o registro do que foi desfeito.`,
        );
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'mesclar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const pessoas = todasAsOpcoes(argumentos, 'pessoa');
      if (pessoas.length !== 2) {
        throw new Error('Informe exatamente duas: --pessoa <id> --pessoa <id>.');
      }
      const mestre = opcao(argumentos, 'mestre');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const r = mesclarPessoas(acervo, {
          pessoaA: pessoas[0] as string,
          pessoaB: pessoas[1] as string,
          ...(mestre !== undefined ? { mestreId: mestre } : {}),
        });
        escrever(`Pessoa ${r.absorvidaId} absorvida por ${r.mestreId}.`);
        escrever(`  regra de mestre: ${r.regra}`);
        if (r.reapontadas > 0) escrever(`  ${r.reapontadas} ja absorvidas foram reapontadas`);
        escrever('A absorvida permanece, com tudo que tinha. Desfazer devolve tudo.');
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'desfazer-mesclagem') {
      const inquilino = opcao(argumentos, 'inquilino');
      const pessoa = opcao(argumentos, 'pessoa');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      if (pessoa === undefined) throw new Error('Informe --pessoa <id>.');
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        desfazerMesclagem(acervo, { absorvidaId: pessoa });
        escrever(`Mesclagem da Pessoa ${pessoa} desfeita. Ela volta com tudo que tinha.`);
        escrever('O registro permanece: desfazer acrescenta a trilha, nunca apaga.');
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'identidade' && sub === 'resolver-enderecos') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const comEfeito = temBandeira(argumentos, 'com-efeito');
      if (comEfeito && !temBandeira(argumentos, 'confirmo')) {
        throw new Error('Repita o comando com --confirmo para executar.');
      }

      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const r = resolverRetroativamente(acervo, { comEfeito });
        const cabeca = comEfeito ? 'Reconciliados' : 'Ensaio';
        escrever(
          `${cabeca}: ${r.paresReconciliados} de ${r.correspondenciasVistas} correspondencia(s).`,
        );
        for (const [tabela, n] of Object.entries(r.linhasRepontadas)) {
          escrever(`  ${n}  ${tabela} (repontadas)`);
        }
        for (const [tabela, n] of Object.entries(r.linhasFundidas)) {
          escrever(`  ${n}  ${tabela} (fundidas)`);
        }
        if (r.vinculosMigrados > 0) escrever(`  ${r.vinculosMigrados} vinculo(s) migrado(s)`);
        if (r.semNadaAResolver > 0) {
          escrever(`  ${r.semNadaAResolver} sem nada a resolver`);
        }
        // Cruzar fronteira de Pessoa NAO e reconciliado aqui: e proposta, e
        // quem aplica e `pessoa propostas aplicar`, que e ato humano.
        if (r.propostasDeMesclagem.length > 0) {
          escrever(`  ${r.propostasDeMesclagem.length} proposta(s) de mesclagem, nao aplicadas:`);
          for (const p of r.propostasDeMesclagem) {
            escrever(`    ${p.alternativo} -> ${p.canonico}`);
          }
        }
        if (!comEfeito) escrever('Nada foi escrito. Repita com --com-efeito --confirmo.');
        if (temBandeira(argumentos, 'json')) escrever(JSON.stringify(r, null, 2));
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'pessoa' && sub === 'remover-nomes-invalidos') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const comEfeito = temBandeira(argumentos, 'com-efeito');
      if (comEfeito && !temBandeira(argumentos, 'confirmo')) {
        throw new Error('Repita o comando com --confirmo para executar.');
      }

      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const r = removerNomesInvalidos(acervo, { comEfeito });
        // OS DOIS MOTIVOS, sempre separados. Total sozinho nao permite conferir
        // contra a linha de base medida antes, que e o que a Acao Documentada
        // usa como guard — e e o criterio do ciclo.
        escrever(r.ensaio ? 'Ensaio: nada foi removido.' : 'Removidas:');
        escrever(`  repetem o endereço: ${r.repetemOEndereco}`);
        escrever(`  duplicam por marca invisível: ${r.duplicamPorMarca}`);
        escrever(`  total: ${r.repetemOEndereco + r.duplicamPorMarca}`);
        if (r.ensaio) escrever('Repita com --com-efeito --confirmo para remover.');
        return 0;
      } finally {
        acervo.fechar();
      }
    }

    if (grupo === 'pessoa' && sub === 'conferir') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      if (!existsSync(join(ambiente.dados, 'acervos', `${inquilino}.db`))) {
        escrever('Acervo vazio: nenhum material foi importado para este Inquilino.');
        return 0;
      }
      // So leitura, e por CONSTRUCAO: o SQLite recusa gravar neste handle.
      const acervo = abrirAcervoSomenteLeitura(join(ambiente.dados, 'acervos'), inquilino);
      try {
        const orfas = conferirMesclagem(acervo);
        const fabricadas = conferirTransicoes(acervo);
        // Repetida NAO muda o codigo de saida, e a diferenca importa. As duas
        // linhas acima sao guardas violadas: nao deveriam acontecer, e sair 1
        // e o certo. Esta e uma MEDICAO de consequencia conhecida — o
        // identificador do evento administrativo nao converge entre as fontes,
        // e o produto conta em vez de prometer. Fazer um gate reprovar por ela
        // treinaria a ignorar o gate.
        const repetidas = conferirTransicoesRepetidas(acervo);
        const duasFormas = conferirTransicoesEmDuasFormas(acervo);
        // Mesma familia das duas acima: MEDICAO, nao guarda. Deveria ser zero
        // — o endereco e resolvido antes de virar Referencia Externa desde o
        // ciclo 10 —, e enquanto for, fundir Conversa nao precisa existir.
        const conversasAlt = conferirConversasEmFormaAlternativa(acervo);
        escrever(`Transicoes da mesma pessoa em duas formas de endereco: ${duasFormas}`);
        escrever(
          `Conversas com Referencia Externa na forma alternativa: ${conversasAlt}` +
            (conversasAlt > 0 ? ' — nasceram antes de a correspondencia ser conhecida.' : ''),
        );
        escrever(
          `Transicoes do mesmo evento sob identificadores diferentes: ${repetidas}` +
            (repetidas > 0 ? ' — o identificador nao converge entre as Fontes.' : ''),
        );
        if (orfas.length === 0 && fabricadas.length === 0) {
          escrever('Mesclagem integra: nenhuma Pessoa aponta para quem nao e mestre.');
          escrever('Transicoes integras: nenhuma com instante fabricado.');
          return 0;
        }
        if (orfas.length > 0) {
          escrever(`${orfas.length} Pessoas apontam para quem nao e mestre:`);
          for (const orfa of orfas) escrever(`  ${orfa}`);
        }
        if (fabricadas.length > 0) {
          escrever(`${fabricadas.length} Transicoes tem instante impossivel:`);
          for (const t of fabricadas) escrever(`  ${t}`);
        }
        escrever('Isto nao deveria acontecer: as guardas o impedem. Algo escreveu por fora.');
        // Sai 1 como comando de CHECAGEM — a familia do grep e dos gates. E
        // diferente de `acervo relatar`, que sai 0 porque divergencia entre
        // banco e disco e relato de rotina; orfa nao deveria existir.
        return 1;
      } finally {
        acervo.fechar();
      }
    }

    if (grupo === 'pessoa' && sub === 'precedencia') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const origem = opcao(argumentos, 'origem');
      const peso = opcao(argumentos, 'peso');

      if (origem !== undefined && peso !== undefined) {
        definirPrecedenciaDeNome(registro, inquilino, origem, Number(peso));
      } else if (origem !== undefined || peso !== undefined) {
        throw new Error('Informe --origem e --peso juntos, ou nenhum dos dois para listar.');
      }

      const apelidoPreferido = opcao(argumentos, 'catalogo-preferido');
      if (apelidoPreferido !== undefined) {
        const cfg = listarConfiguracoes(registro, inquilino).find(
          (x) => x.fonte === 'contatos' && x.apelido === apelidoPreferido,
        );
        if (cfg === undefined) {
          throw new Error(
            `Nao ha Configuracao de contatos com o apelido ${apelidoPreferido} neste Inquilino.`,
          );
        }
        definirCatalogoPreferido(registro, inquilino, cfg.id);
      }

      const atual = lerPrecedenciasDeNome(registro, inquilino);
      for (const [chave, valor] of Object.entries(atual.porOrigem).sort((a, b) => b[1] - a[1])) {
        escrever(`${chave}\t${valor}`);
      }
      if (atual.catalogoPreferido !== null) {
        const cfg = listarConfiguracoes(registro, inquilino).find(
          (x) => x.id === atual.catalogoPreferido,
        );
        escrever(`catalogo preferido: ${cfg?.apelido ?? atual.catalogoPreferido}`);
      }
      return 0;
    }

    if (grupo === 'retencao' && (sub === 'definir' || sub === 'ver' || sub === 'aplicar')) {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');

      if (sub === 'definir') {
        const dias = opcao(argumentos, 'mais-velho-que-dias');
        const mb = opcao(argumentos, 'maior-que-mb');
        const tipos = opcao(argumentos, 'tipos');
        definirPoliticaDeRetencao(registro, inquilino, {
          ...(dias !== undefined ? { maisVelhoQueDias: Number(dias) } : {}),
          ...(mb !== undefined ? { maiorQueBytes: Number(mb) * 1024 * 1024 } : {}),
          ...(tipos !== undefined ? { tipos: tipos.split(',') } : {}),
        });
        escrever('Politica de Retencao definida. Definir nao descarta: nada foi descartado.');
      }

      const politica = lerPoliticaDeRetencao(registro, inquilino);
      if (politica === null) {
        throw new Error(
          'Nenhuma Politica de Retencao definida para este Inquilino. Rode: ' +
            'malote retencao definir --inquilino <id> [--mais-velho-que-dias <n>] ' +
            '[--maior-que-mb <n>] [--tipos video,audio]',
        );
      }

      if (!existsSync(join(ambiente.dados, 'acervos', `${inquilino}.db`))) {
        escrever('Acervo vazio: nenhum material foi importado para este Inquilino.');
        return 0;
      }

      // A bandeira so vale em `aplicar`. Sem o `sub ===`, um
      // `retencao ver --com-efeito --confirmo` descartaria arquivo: comando de
      // leitura capaz de destruir e exatamente a classe de erro que este
      // ciclo existe para nao cometer.
      const comEfeito = sub === 'aplicar' && temBandeira(argumentos, 'com-efeito');
      const destinoDaPolitica = lerDestinoDeMidia(registro, inquilino);
      const pastaDeAcervos = join(ambiente.dados, 'acervos');

      // Ensaio e `ver` abrem SOMENTE LEITURA: a garantia de que nao escrevem e
      // do SQLite, nao da disciplina de quem manteve o codigo.
      const acervoDaPolitica = comEfeito
        ? acervoDoInquilino(registro, ambiente.dados, inquilino)
        : abrirAcervoSomenteLeitura(pastaDeAcervos, inquilino);
      try {
        if (!comEfeito) {
          const p = projetarRetencao(acervoDaPolitica, { politica, agora: Date.now() });
          escrever(`Politica: ${descreverPolitica(politica)}`);
          escrever(`Projecao: ${p.anexos} Anexos, ${p.bytes} bytes`);
          for (const [criterio, cont] of Object.entries(p.porCriterio)) {
            escrever(
              `  ${criterio} sozinho alcancaria ${cont.anexos} Anexos (${cont.bytes} bytes)`,
            );
          }
          if (sub === 'aplicar') {
            escrever(
              'Ensaio: nada foi descartado. Repita com --com-efeito --confirmo para executar.',
            );
          }
          return 0;
        }

        if (destinoDaPolitica === undefined) {
          throw new Error('Destino de Midia nao configurado: nao ha arquivo a descartar.');
        }
        if (!temBandeira(argumentos, 'confirmo')) {
          const p = projetarRetencao(acervoDaPolitica, { politica, agora: Date.now() });
          escrever(
            `Descartar e DEFINITIVO: ${p.anexos} arquivos (${p.bytes} bytes) saem do disco ` +
              'e nao voltam. A Mensagem continua no Acervo, com a Presenca dizendo descartado. ' +
              'Repita com --confirmo para executar.',
          );
          return 2;
        }

        const r = aplicarRetencao(acervoDaPolitica, {
          politica,
          destino: destinoDaPolitica.endereco,
          agora: Date.now(),
          comEfeito: true,
        });
        escrever(`Descartados: ${r.descartados} Anexos (${r.bytesLiberados} bytes liberados)`);
        if (r.falhas > 0) escrever(`  ${r.falhas} falharam e seguem presentes`);
      } finally {
        acervoDaPolitica.fechar();
      }
      return 0;
    }

    if (grupo === 'acervo' && sub === 'migrar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');
      const conhecido = listarInquilinos(registro).some((i) => i.id === inquilino);
      if (!conhecido) throw new Error(`Inquilino desconhecido: ${inquilino}`);

      // Abrir para escrita JA migra. Este comando existe para que migrar seja
      // um ato que se ESCOLHE, num momento que se controla, com relatorio do
      // que foi feito — e nao so um efeito de rodar qualquer outra coisa.
      // A forma de origem se le ANTES de abrir, senao ja subiu.
      const pastaDeAcervos = join(ambiente.dados, 'acervos');
      const antes = versaoDoAcervoEmDisco(pastaDeAcervos, inquilino);
      const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
      try {
        const depois = acervo.versaoDoSchema();
        if (antes === depois) {
          escrever(`Acervo do Inquilino ${inquilino} ja esta na forma ${depois}: nada a aplicar.`);
          return 0;
        }
        escrever(
          `Acervo do Inquilino ${inquilino}: forma ${antes ?? 'nova'} subiu para ${depois}.`,
        );
        for (const p of passosAplicados(acervo.db)) {
          escrever(`  ${p.de} -> ${p.para}  ${p.descricao}  [${p.conferencia}]`);
        }
        const semDirecao = (
          acervo.preparar('SELECT COUNT(*) AS n FROM mensagens WHERE direcao IS NULL').get() as {
            n: number;
          }
        ).n;
        if (semDirecao > 0) {
          escrever(
            `${semDirecao} Mensagem(ns) sem Direcao calculavel — Conteudo Bruto sem o ` +
              'discriminante conhecido, ou Configuracao sem o Nome do Titular na Fonte declarado.',
          );
        }
      } finally {
        acervo.fechar();
      }
      return 0;
    }

    if (grupo === 'acervo' && sub === 'recriar') {
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino <id>.');

      // rmSync com force sobre caminho ausente e no-op silencioso: sem esta
      // checagem, um --inquilino digitado errado sai com sucesso e a mensagem
      // "Acervo recriado", enquanto o Acervo verdadeiro fica intacto.
      const conhecido = listarInquilinos(registro).some((i) => i.id === inquilino);
      if (!conhecido) throw new Error(`Inquilino desconhecido: ${inquilino}`);

      const destinoDoRecriar = lerDestinoDeMidia(registro, inquilino);

      // Recriar com o Destino desmontado apagaria o banco e deixaria os
      // arquivos — o mesmo orfao que este ciclo veio pagar, so que produzido
      // pela operacao que existe para evita-lo.
      if (destinoDoRecriar !== undefined && !destinoAcessivel(destinoDoRecriar.endereco)) {
        throw new Error(
          `Destino de Midia inacessivel: ${destinoDoRecriar.endereco}. ` +
            'Recriar apagaria o Acervo e deixaria os arquivos para tras. ' +
            'Monte o Destino e repita.',
        );
      }

      if (!temBandeira(argumentos, 'confirmo')) {
        escrever(
          'Recriar apaga o Acervo deste Inquilino por inteiro, e tambem os arquivos ' +
            'de Anexo dele sob o Destino de Midia. O material e a fonte: reimporte depois. ' +
            'Repita o comando com --confirmo para executar.',
        );
        return 2;
      }

      // A trilha do Acervo mora DENTRO do Acervo e vai junto. Dizer ANTES de
      // agir: a linha impressa depois chega quando o dado ja se foi.
      escrever('A trilha de auditoria deste Acervo sera apagada junto — ela mora dentro dele.');

      // A Operacao vai no REGISTRO, que sobrevive ao ato. No Acervo ela seria
      // apagada pelo proprio comando que a escreveu. Gravada ANTES de apagar:
      // se apagar falhar, fica registrada a tentativa — que foi o que houve.
      emOperacao(
        registro,
        { natureza: 'recriar-acervo', reversibilidade: 'irreversivel', inquilinoId: inquilino },
        (op) => {
          op.valor({
            tabela: 'acervos',
            chave: inquilino,
            campo: 'recriado',
            antes: null,
            depois: new Date().toISOString(),
          });
        },
      );

      recriarAcervo(join(ambiente.dados, 'acervos'), inquilino, {
        ...(destinoDoRecriar !== undefined ? { destino: destinoDoRecriar.endereco } : {}),
      });
      escrever(`Acervo do Inquilino ${inquilino} recriado. Reimporte o material.`);
      if (destinoDoRecriar !== undefined) {
        escrever('Os arquivos de Anexo deste Inquilino tambem foram apagados.');
      }
      return 0;
    }

    if (grupo === 'operacao') {
      autorizarAdministracao(registro, chave, identidade);
      const inquilino = opcao(argumentos, 'inquilino');
      if (inquilino === undefined) throw new Error('Informe --inquilino.');

      // As DUAS bases, somente-leitura, numa linha do tempo so. O Acervo traz a
      // identidade; o Registro traz a configuracao DESTE Inquilino. Operacao de
      // instalacao — sem Inquilino — nao entra: nao e deste Inquilino.
      const lerTrilhas = <T>(usar: (a: Acervo, g: Registro) => T): T => {
        const a = abrirAcervoSomenteLeitura(join(ambiente.dados, 'acervos'), inquilino);
        const g = abrirRegistroSomenteLeitura(ambiente.dados);
        try {
          return usar(a, g);
        } finally {
          a.fechar();
          g.fechar();
        }
      };

      if (sub === 'listar') {
        const linhaDoTempo = lerTrilhas((a, g) =>
          [
            ...listarOperacoes(a, { limite: 500 }),
            ...listarOperacoes(g, { inquilinoId: inquilino, limite: 500 }),
          ].sort((x, y) => (x.ocorridaEm < y.ocorridaEm ? 1 : -1)),
        );
        if (linhaDoTempo.length === 0) escrever('Nenhuma Operacao registrada.');
        for (const o of linhaDoTempo.slice(0, 50)) {
          const marca = o.desfeitaPor === null ? '' : '  (desfeita)';
          escrever(
            `${o.ocorridaEm}  ${o.natureza}  ${quemOrdenou(o.ator)}  ` +
              `${o.linhas} linha(s)  ${o.id}${marca}`,
          );
        }
        return 0;
      }

      if (acao === undefined || acao.startsWith('--')) {
        throw new Error('Informe o identificador da Operacao.');
      }

      // Procura nas duas bases: o identificador nao diz de qual ele e.
      const vista = lerTrilhas((a, g) => lerOperacao(a, acao) ?? lerOperacao(g, acao));
      if (vista === null) {
        escrever(`Operacao desconhecida neste Inquilino: ${acao}`);
        return 2;
      }

      if (sub === 'ver') {
        escrever(`${vista.natureza}  ${vista.ocorridaEm}  (${vista.reversibilidade})`);
        escrever(`  por ordem de: ${quemOrdenou(vista.ator)}`);
        if (vista.desfeitaPor !== null) escrever(`  desfeita pela Operacao ${vista.desfeitaPor}`);
        for (const l of vista.efeito) {
          if (l.natureza === 'referencia') escrever(`  -> ${l.tabela} ${l.chave}`);
          else {
            escrever(
              `  ${l.tabela}.${l.campo}  ${l.antes ?? '(vazio)'} -> ${l.depois ?? '(vazio)'}`,
            );
          }
        }
        return 0;
      }

      if (sub === 'desfazer') {
        // ENSAIO E O PADRAO, e a recusa aparece AQUI — diz-la depois seria
        // informar quando ja nao adianta.
        if (!(temBandeira(argumentos, 'com-efeito') && temBandeira(argumentos, 'confirmo'))) {
          escrever(`${vista.natureza}  ${vista.efeito.length} linha(s) de efeito`);
          try {
            conferirSeDesfazivel(vista);
            escrever('Desfazer reverteria estas linhas.');
          } catch (erro) {
            escrever(erro instanceof Error ? erro.message : String(erro));
          }
          escrever('Nada foi escrito. Repita com --com-efeito --confirmo.');
          return 0;
        }

        const acervo = acervoDoInquilino(registro, ambiente.dados, inquilino);
        try {
          const r = desfazerOperacao(acervo, acao);
          escrever(`Operacao ${r.operacaoId} desfeita pela Operacao ${r.desfazerId}.`);
          escrever(`  ${r.desfeitos} linha(s) revertida(s), ${r.recusados.length} recusada(s)`);
          // Agrupado por CAUSA, nunca linha a linha: um lote real recusa
          // centenas de itens pelo mesmo motivo, e 922 linhas iguais na tela
          // escondem a informacao em vez de darem. Mesmo precedente do
          // relatorio de aplicacao em lote.
          const porCausa = new Map<string, number>();
          for (const rec of r.recusados) {
            porCausa.set(rec.causa, (porCausa.get(rec.causa) ?? 0) + 1);
          }
          for (const [causa, quantas] of porCausa) escrever(`  ${quantas}x  ${causa}`);
          return 0;
        } finally {
          acervo.fechar();
        }
      }

      escrever('Uso: malote operacao listar|ver <id>|desfazer <id> --inquilino <id>');
      return 2;
    }

    escrever(`Comando desconhecido: ${argumentos.join(' ')}`);
    escrever(AJUDA);
    return 2;
  } catch (causa) {
    escrever((causa as Error).message);
    return 1;
  } finally {
    registro.fechar();
  }
}

/**
 * A versao publicada, lida do manifesto.
 *
 * Do MANIFESTO e nao de uma constante: numero repetido em dois lugares diverge
 * em silencio, e o dia em que divergir sera justamente quando alguem de fora
 * perguntar que versao esta rodando. O caminho relativo vale da fonte
 * (`src/cli/`) e do build (`dist/cli/`) — os dois estao a dois niveis da raiz.
 */
export function versaoDoProduto(): string {
  const manifesto = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version?: string };
  const versao = manifesto.version;
  if (versao === undefined) throw new Error('o manifesto nao declara `version`');
  return versao;
}

if (ehPontoDeEntrada(import.meta, process.argv[1])) {
  const argumentos = process.argv.slice(2);
  const ambiente: Ambiente = {
    dados: raizDeDados(process.env),
    estado: raizDeEstado(process.env),
    ...(process.env['MALOTE_SERVIDOR'] !== undefined
      ? { servidor: process.env['MALOTE_SERVIDOR'] }
      : {}),
    ...(process.env['MALOTE_CHAVE_DE_ACESSO'] !== undefined
      ? { chave: process.env['MALOTE_CHAVE_DE_ACESSO'] }
      : {}),
    escrever: (texto) => console.log(texto),
  };
  // O ouvinte e o unico comando assincrono: ele nao termina sozinho. Despacha-lo
  // aqui e o que permite `executar()` continuar sincrona, do jeito que os testes
  // e todos os outros comandos a usam.
  if (argumentos[0] === 'ouvir') {
    void ouvir(argumentos, ambiente).then((codigo) => process.exit(codigo));
  } else if (argumentos[0] === 'servir') {
    void servir(argumentos, ambiente).then((codigo) => process.exit(codigo));
  } else if (COMANDOS_DE_REDE.has(argumentos[0] ?? '') && ambiente.servidor !== undefined) {
    // Modo REDE: a consulta e async (HTTP), e o executar e sincrono — mesmo
    // padrao do ouvir. A chave e a identidade; sem ela, recusa com o contrato
    // do cliente.
    const chave = ambiente.chave;
    if (chave === undefined) {
      console.log('Informe MALOTE_CHAVE_DE_ACESSO: a Chave de Acesso e a identidade da consulta por rede.');
      process.exit(2);
    }
    void executarConsultaRede(argumentos, {
      servidor: opcao(argumentos, 'servidor') ?? (ambiente.servidor as string),
      chave,
      escrever: (t) => console.log(t),
    }).then((codigo) => process.exit(codigo));
  } else {
    process.exit(executar(argumentos, ambiente));
  }
}
