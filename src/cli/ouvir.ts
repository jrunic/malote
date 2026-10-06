import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { abrirRegistro, listarInquilinos } from '../registro/registro.js';
import { configuracaoPorApelido } from '../registro/configuracao-adaptador.js';
import { abrirAcervo, type Acervo } from '../nucleo/acervo.js';
import { receberEvento, type MensagemRecebida } from '../adaptadores/whatsapp/ao-vivo.js';
import { processarEstadoDeConversa } from '../adaptadores/whatsapp/estado-ao-vivo.js';
import { processarEnvios } from '../adaptadores/whatsapp/enviar.js';
import { conectar } from '../adaptadores/whatsapp/conexao.js';
import { lerDestinoDeMidia } from '../registro/destino-midia.js';
import { gravarArquivoDeAnexo } from '../nucleo/arquivo-de-anexo.js';
import { lerUltimoEvento, marcarUltimoEvento } from './ultimo-evento.js';
import {
  caminhoDoEnvenenado,
  contarDerrame,
  derramar,
  ehBancoOcupado,
  lerDerrame,
  moverLoteEnvenenado,
  removerPrimeiroLote,
} from './derrame.js';
import { abrirCaptura } from './captura-de-retrato.js';
import { anotarRetrato, pareceRetrato } from './retrato.js';
import { anotarPulos } from './pulos.js';
import { atorDeServico, comAtor } from '../nucleo/ator.js';
import {
  identidadeDoVinculo,
  mesmoTelefone,
  type IdentidadeBrutaDoVinculo,
} from '../adaptadores/whatsapp/identidade-da-conta.js';
import { declararEnderecosDaConta } from '../nucleo/endereco-da-conta.js';
import {
  declararTelefoneDaConta,
  lerEnderecosDaConta,
  registrarEnderecosDoVinculo,
  telefoneValido,
} from '../registro/endereco-da-conta.js';
import { configuracaoComTelefoneEquivalente } from './telefone-da-conta.js';
import { anotarCorrespondencia } from './vigilancia.js';
import type { Ambiente } from './index.js';

export interface CaminhosDaConta {
  vinculo: string;
  ultimoEvento: string;
  /** Onde o evento cai quando o Acervo esta ocupado. Ver `derrame.ts`. */
  derrame: string;
  /** Serie diaria da fonte de correspondencia de endereco. Ver `vigilancia.ts`. */
  correspondencia: string;
  /** Instante e tamanho do ultimo Retrato de Estado recebido. Ver `retrato.ts`. */
  retrato: string;
  /** Contadores de pulo visiveis no --json. Ver `pulos.ts`. */
  pulos: string;
}

/**
 * Onde vive o estado do ouvinte de uma conta.
 *
 * FORA do Acervo e do Registro, de proposito. O vinculo do dispositivo e
 * credencial e muda a cada mensagem; perde-lo custa parear de novo e NADA do
 * acervo. O nucleo tambem nao nomeia ferramenta, e um agregado para isto seria
 * exatamente isso.
 */
export function caminhosDaConta(raiz: string, conta: string): CaminhosDaConta {
  const pasta = join(raiz, 'ouvinte', conta);
  return {
    vinculo: join(pasta, 'vinculo'),
    ultimoEvento: join(pasta, 'ultimo-evento.txt'),
    derrame: join(pasta, 'nao-gravados.jsonl'),
    correspondencia: join(pasta, 'correspondencia.json'),
      retrato: join(pasta, 'retrato.json'),
      pulos: join(pasta, 'pulos.json'),
  };
}

function opcao(argumentos: string[], nome: string): string | undefined {
  const i = argumentos.indexOf(`--${nome}`);
  if (i === -1) return undefined;
  return argumentos[i + 1];
}

function descreverIntervalo(de: number, ate: number): string {
  const minutos = Math.max(0, Math.floor((ate - de) / 60_000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h`;
  return `${Math.floor(horas / 24)} dias`;
}

export interface AmbienteDeEscuta extends Ambiente {
  carregarBiblioteca?: () => Promise<unknown>;
  agora?: () => number;
}

/**
 * Quantos lotes a drenagem consome por escrita bem-sucedida.
 *
 * Existe para que drenar nao vire uma segunda escrita em lote competindo com a
 * recepcao — que e a disputa que causou o derrame. Tres e folgado para o caso
 * real medido em 09/09/2026 (dois lotes de um evento cada) e curto o bastante
 * para nao segurar o laco de eventos.
 */
const LOTES_POR_DRENAGEM = 3;

/**
 * Drena o derrame depois de uma escrita que funcionou.
 *
 * O GATILHO E O SUCESSO, e nao um temporizador. Escrita que passou e evidencia
 * de que a disputa acabou; temporizador tentaria no escuro e poderia bater
 * exatamente na janela ocupada.
 *
 * Para no PRIMEIRO lote que nao couber, e deixa o resto: insistir contra a
 * disputa e reabrir o problema que o derrame veio fechar.
 *
 * EXPORTADA de proposito, e nao por conveniencia de teste. O manipulador de
 * eventos e SINCRONO — `receberEvento` sucede, `marcarUltimoEvento`, `drenar`,
 * tudo na mesma pilha —, entao nao existe ponto em que um teste pela biblioteca
 * falsa adquira a trava ENTRE o sucesso e a drenagem. Testar so por la deixaria
 * tres criterios da spec sem cobertura real.
 */
export function drenar(
  acervo: Acervo,
  caminho: string,
  configuracao: { id: string; fonte: 'whatsapp' },
  agora: () => number,
  escrever: (texto: string) => void,
  caminhoDaCorrespondencia?: string,
): void {
  for (let i = 0; i < LOTES_POR_DRENAGEM; i += 1) {
    const lote = lerDerrame(caminho)[0];
    if (lote === undefined) return;
    try {
      const r = receberEvento(acervo, lote as MensagemRecebida[], {
        agora: agora(),
        configuracao,
      });
      // O EVENTO DERRAMADO E CONTADO AQUI, E SO AQUI — nao ha dupla contagem.
      //
      // Na recepcao ao vivo, o que derrama e o lote cujo `receberEvento`
      // LANCOU: a excecao sobe antes de o relato voltar, entao a contagem
      // daquele lote nunca chegou a ser anotada. Contar na drenagem nao repete
      // nada; deixar de contar aqui e que perderia a evidencia de que a fonte
      // da correspondencia estava viva durante a disputa.
      if (caminhoDaCorrespondencia !== undefined) {
        anotarCorrespondencia(caminhoDaCorrespondencia, r.correspondencia, agora());
      }
      // GRAVA PRIMEIRO, REMOVE DEPOIS. Ver `removerPrimeiroLote`: invertido,
      // morrer no meio apaga o que nunca entrou no Acervo.
      removerPrimeiroLote(caminho);
      escrever(
        `[ouvinte] drenado: ${r.gravados} gravada(s); restam ${contarDerrame(caminho)} lote(s)`,
      );
      // Recusa durante a drenagem tem de aparecer, pelo mesmo motivo que na
      // recepcao: sem isto, dado recusado aqui some sem linha nenhuma.
      if (r.recusados.length > 0) {
        escrever(`[ouvinte] drenagem, recusados: ${r.recusados.length}`);
      }
    } catch (erro) {
      if (ehBancoOcupado(erro)) {
        escrever(
          `[ouvinte] drenagem adiada: Acervo ocupado; restam ${contarDerrame(caminho)} lote(s)`,
        );
        return;
      }
      // NAO e disputa: o lote sai do caminho em vez de matar o ouvinte a cada
      // drenagem. Sem isto o venenoso volta a cada religada, para sempre.
      // Decidido no gate de 09/09/2026 — criterio 10 da spec do #842.
      moverLoteEnvenenado(caminho, erro);
      escrever(
        `[ouvinte] LOTE ENVENENADO movido para ${caminhoDoEnvenenado(caminho)}: ${String(erro)}`,
      );
    }
  }
}

export async function ouvir(argumentos: string[], ambiente: AmbienteDeEscuta): Promise<number> {
  const { escrever } = ambiente;
  const agora = ambiente.agora ?? ((): number => Date.now());
  const inquilinoId = opcao(argumentos, 'inquilino');
  const conta = opcao(argumentos, 'conta');
  if (inquilinoId === undefined || conta === undefined) {
    escrever(
      'Uso: malote ouvir --inquilino <id> --conta <nome> --configuracao <apelido> ' +
        '[--numero <so digitos>]',
    );
    escrever('Um processo escuta UMA conta. Uma segunda conta e um segundo processo.');
    return 2;
  }

  // O apelido da Configuracao vem por ARGUMENTO PROPRIO, e nao derivado de
  // `--conta`: os dois sao vocabularios diferentes e NAO casam por construcao.
  // Medido em 08/09/2026: o servico roda `--conta pessoal`, que
  // nomeia a pasta do vinculo do dispositivo, e o Registro guardava a
  // Configuracao sob o apelido `padrao`. Derivar um do outro devolveria
  // `undefined` em producao e o ouvinte nunca mais subiria.
  const apelido = opcao(argumentos, 'configuracao');
  if (apelido === undefined) {
    escrever('Uso: malote ouvir --inquilino <id> --conta <nome> --configuracao <apelido>');
    escrever('A Configuracao NAO e derivada de --conta: aquilo nomeia a pasta do vinculo.');
    return 2;
  }

  const registro = comAtor(atorDeServico('ouvinte-whatsapp'), () =>
    abrirRegistro(ambiente.dados),
  );
  let configuracao: { id: string; fonte: 'whatsapp' };
  // O telefone que vale para PEDIR o codigo de pareamento: o --numero, ou o da Configuracao.
  let telefoneDaConfiguracao: string | undefined;
  // Sem Destino, o Anexo ao vivo fica `nunca-obtido` (como hoje): recusar a
  // subida so por isso quebraria instalacao que nunca configurou um — a
  // mesma razao pela qual `midia trazer` RECUSA e o ouvinte so AVISA.
  let destinoDeMidia: string | undefined;
  try {
    if (!listarInquilinos(registro).some((i) => i.id === inquilinoId)) {
      escrever(`Inquilino desconhecido: ${inquilinoId}`);
      return 1;
    }
    // Busca, NUNCA cria. `resolverConfiguracao` criaria uma Configuracao vazia
    // aqui, e ela passaria a receber Conversa: a captura gravaria na conta
    // errada e nada alarmaria. Recusar e o comportamento certo.
    const cfg = configuracaoPorApelido(registro, inquilinoId, 'whatsapp', apelido);
    if (cfg === undefined) {
      escrever(`Configuracao "${apelido}" nao existe neste Inquilino para whatsapp.`);
      escrever('Importe um material dela primeiro. O ouvinte nao a cria, porque criar a');
      escrever('conta errada e pior que nao subir.');
      return 2;
    }
    configuracao = { id: cfg.id, fonte: 'whatsapp' };
    // Regra unica de declaracao do telefone (spec #1149): a Configuracao e a
    // fonte; o --numero nao e uma segunda declaracao concorrente. Nenhuma
    // mensagem daqui ecoa digitos: o journal do servico e dado pessoal.
    const numeroInformado = opcao(argumentos, 'numero');
    telefoneDaConfiguracao = cfg.telefone ?? undefined;
    if (numeroInformado !== undefined) {
      if (!telefoneValido(numeroInformado)) {
        escrever('--numero precisa ser so digitos, com codigo do pais (de 10 a 15).');
        return 2;
      }
      if (cfg.telefone !== null) {
        if (!mesmoTelefone(cfg.telefone, numeroInformado)) {
          escrever('O --numero nao e o telefone desta Configuracao. Nada foi feito.');
          return 2;
        }
      } else {
        const outra = configuracaoComTelefoneEquivalente(registro, inquilinoId, numeroInformado, cfg.id);
        if (outra !== undefined) {
          escrever(`Esse numero ja pertence a Configuracao ${outra.apelido} deste Inquilino.`);
          return 2;
        }
        comAtor(atorDeServico('ouvinte-whatsapp'), () =>
          declararTelefoneDaConta(registro, cfg.id, numeroInformado),
        );
        telefoneDaConfiguracao = numeroInformado;
      }
    }
    destinoDeMidia = lerDestinoDeMidia(registro, inquilinoId)?.endereco;
  } finally {
    registro.fechar();
  }
  if (destinoDeMidia === undefined) {
    escrever('AVISO: Destino de Midia nao configurado — midia recebida ao vivo permanece');
    escrever('nunca-obtido. Configure com: malote inquilino destino --chave <valor> --inquilino');
    escrever(`<id> --endereco <caminho>`);
  }

  const caminhos = caminhosDaConta(ambiente.estado, conta);
  // A pasta <raiz>/ouvinte/<conta> NAO e criada aqui: trabalho de disco na
  // subida e o que travou em filesystem patologico (CONTEXTO.md), e a pasta e
  // pre-condicao do operador — igual ao proprio vinculo. mkdirSync recursivo
  // sobre caminho patologico nao lanca e nao retorna.

  // Primeiro pareamento SEM numero e laco morto, e o coletor descartavel ja
  // tinha aprendido isso: sem vinculo, o socket sobe nao-registrado, toma 428, e
  // a religacao tenta de novo para sempre. Espera sem prazo e o que a doutrina
  // proibe — e aqui ela se disfarca de processo saudavel.
  const numeroDoPareamento = opcao(argumentos, 'numero') ?? telefoneDaConfiguracao;
  const jaPareada = existsSync(join(caminhos.vinculo, 'creds.json'));
  if (!jaPareada && numeroDoPareamento === undefined) {
    escrever(`Conta ${conta} ainda nao esta pareada, e nao ha o que religar.`);
    escrever('Informe --numero <so digitos, com codigo do pais> para receber o codigo.');
    return 2;
  }

  // O aviso sai em TODA partida, e nao so na primeira. "Primeira execucao" e
  // estado que alguem zera reinstalando, e a regra deste produto e sobre estado,
  // nunca sobre contagem de invocacoes — o mesmo criterio da Chave de Operador.
  escrever('AVISO: a biblioteca de recepcao e nao-oficial. A conta usada pode ser');
  escrever('bloqueada pela plataforma. Voce assume esse risco ao rodar este comando.');

  // A lacuna e DECLARADA. O que a plataforma nao reentregar nao vira silencio:
  // quem opera sai daqui sabendo que intervalo ficou sem cobertura e como
  // preenche-lo.
  const ultimo = lerUltimoEvento(caminhos.ultimoEvento);
  if (ultimo === null) {
    escrever(`Conta ${conta}: primeiro inicio, sem cobertura anterior.`);
  } else {
    escrever(`Ultimo evento recebido em ${new Date(ultimo).toISOString()}.`);
    escrever(`Intervalo sem cobertura: ${descreverIntervalo(ultimo, agora())}.`);
    escrever('A plataforma reentrega parte do periodo; o resto se preenche por');
    escrever('importacao de backup posterior.');
  }

  // Mesma razao da CLI: abrir pode MIGRAR, e migrar grava Operacao. Aqui o
  // Ator ja e conhecido — quem abre e o servico —, entao a migracao sai
  // atribuida a ele em vez de `indeterminado`.
  const acervo = comAtor(atorDeServico('ouvinte-whatsapp'), () =>
    abrirAcervo(join(ambiente.dados, 'acervos'), inquilinoId),
  );

  // Codigo de saida quando a conexao termina para nao voltar: 1 e o vinculo
  // invalidado pela plataforma; 2 e a conta do vinculo nao ser a da Configuracao
  // (a mesma classe das outras recusas de configuracao deste comando).
  let codigoDeFim = 1;
  let recusouIdentidade = false;

  // O gancho de identidade (spec #1149). Confere o vinculo contra a Configuracao
  // e, se for a conta certa, persiste o que o vinculo mostrou e declara o par ao
  // Acervo. O Registro REABRE aqui: `ouvir` o fechou antes de conectar.
  const aoIdentificar = (bruta: IdentidadeBrutaDoVinculo): 'seguir' | 'recusar' => {
    const id = identidadeDoVinculo(bruta);
    if (id === undefined) {
      escrever('[ouvinte] a identidade do vinculo nao e legivel; sigo sem conferir a conta.');
      return 'seguir';
    }
    const registroDaConferencia = comAtor(atorDeServico('ouvinte-whatsapp'), () =>
      abrirRegistro(ambiente.dados),
    );
    try {
      const atual = lerEnderecosDaConta(registroDaConferencia, configuracao.id);
      if (atual?.telefone != null && !mesmoTelefone(atual.telefone, id.telefone)) {
        escrever('[ouvinte] RECUSADO: o vinculo e de outra conta que a da Configuracao. Nada foi gravado.');
        recusouIdentidade = true;
        codigoDeFim = 2;
        return 'recusar';
      }
      comAtor(atorDeServico('ouvinte-whatsapp'), () =>
        registrarEnderecosDoVinculo(registroDaConferencia, configuracao.id, id),
      );
    } finally {
      registroDaConferencia.fechar();
    }
    const declarado = comAtor(atorDeServico('ouvinte-whatsapp'), () =>
      declararEnderecosDaConta(acervo, {
        fonte: 'whatsapp',
        canonico: id.jid,
        ...(id.lid !== null ? { alternativo: id.lid } : {}),
      }),
    );
    if (declarado.conflito) {
      escrever('[ouvinte] AVISO: o par de enderecos da conta ja estava gravado de outra forma; mantive o anterior.');
    }
    return 'seguir';
  };

  // O processo tem TRES fins possiveis, e os tres passam por aqui: sinal de
  // termino, sinal de interrupcao, e a conexao dizendo que nao volta. Sem o
  // terceiro, o vinculo invalidado deixaria o processo pendurado.
  let encerrar: (codigo: number) => void = () => undefined;
  const fim = new Promise<number>((resolver) => {
    encerrar = resolver;
  });
  let fechado = false;
  const fecharUmaVez = (): void => {
    if (fechado) return;
    fechado = true;
    acervo.fechar();
  };

  // Captura DIAGNOSTICA de app-state, DESLIGADA por default — sem a variavel,
  // `abrirCaptura` devolve o nada nomeado e nada e escrito. Ver
  // `captura-de-retrato.ts` para por que ela existe e qual e o prazo dela.
  const capturar = abrirCaptura(process.env['MALOTE_CAPTURA_DE_RETRATO']);

  // Declarada ANTES de `conectar`: `aoTerminar`, passado a ele, precisa
  // referencia-la antes de o poller existir (ver atribuicao logo apos
  // `conectar` retornar).
  let pararPollerDeEnvio: (() => void) | undefined;

  // keyId -> caminho de staging. Alimentado por `aoEnviar` quando um Envio de
  // MIDIA sai com sucesso; consumido no laco de `anexosNuncaObtidos` quando o
  // eco daquela Mensagem chega, ANTES de recorrer a `midia.baixar` — que
  // baixaria de volta do WhatsApp os bytes que o proprio malote acabou de
  // enviar (#1112). Mapa de PROCESSO: se o processo cair entre o envio e o
  // eco, o staging fica orfao em `envios-pendentes/` (janela aceita e
  // nomeada na spec, fora de escopo).
  const bytesOriginados = new Map<string, string>();
  // A passada de Envio em curso, se houver. A biblioteca pode emitir o eco
  // DE DENTRO do sendMessage, antes de `aoEnviar` rodar: quem recebe o eco
  // espera a passada terminar antes de decidir entre staging e download.
  let passadaDeEnvio: Promise<unknown> | undefined;

  try {
    const conexao = await conectar({
      pastaDoVinculo: caminhos.vinculo,
      capturar,
      aoIdentificar,
      aoObservar: (_fluxo, resumo) => {
        // Anota SO o que parece Retrato. A regra vive em `retrato.ts` com a
        // medicao que a sustenta, e e a mesma que o `--json` documenta.
        if (!pareceRetrato(resumo.chaves, resumo.itens)) return;
        anotarRetrato(caminhos.retrato, {
          em: new Date().toISOString(),
          itens: resumo.itens,
        });
      },
      aoEstado: (fluxo, dado) => {
        const r = processarEstadoDeConversa(acervo, {
          fluxo,
          dado,
          configuracaoId: configuracao.id,
          observadaEm: agora(),
        });
        if (r.opacosPulados > 0 || r.favoritosSemMensagem > 0) {
          anotarPulos(caminhos.pulos, {
            enderecosOpacos: r.opacosPulados,
            favoritosSemMensagem: r.favoritosSemMensagem,
          });
        }
      },
      numero: numeroDoPareamento,
      registrar: (linha) => escrever(`[ouvinte] ${linha}`),
      aoTerminar: (motivo) => {
        escrever(`[ouvinte] encerrando: ${motivo}`);
        // Para o poller ANTES de fechar o Acervo — e nao marca Envio pendente
        // como falhou: a causa e do vinculo, nao do Envio (#1112, criterio 12).
        pararPollerDeEnvio?.();
        fecharUmaVez();
        // Diferente de zero: o supervisor tem de saber que isto NAO foi uma
        // parada pedida. Vinculo invalidado exige pareamento humano.
        encerrar(codigoDeFim);
      },
      ...(ambiente.carregarBiblioteca !== undefined
        ? { carregarBiblioteca: ambiente.carregarBiblioteca }
        : {}),
      aoReceber: (mensagens, midia) =>
        // O escopo do Ator abre AQUI, e nao ao redor do laco de recepcao.
        // `receberEvento` e sincrono, entao o Ator vale por construcao — sem
        // depender de o contexto atravessar o encanamento assincrono da
        // biblioteca.
        //
        // Envolver o laco inteiro pareceria mais simples e seria FRAGIL: a
        // biblioteca tem buffer proprio de eventos e religa o socket por
        // temporizador encadeado. Se algum despejo interno emitisse de um
        // contexto criado fora do escopo, o Ator sairia `indeterminado` — em
        // producao, intermitente ou sempre.
        //
        // E o teste com biblioteca injetada NAO pegaria: o dublê dispara de
        // dentro do escopo do teste, entao o contexto sobreviveria ali e
        // morreria no real. E a mesma classe de "a forma da chamada no aceite
        // nao e a forma em producao" que custou o defeito do envelope de
        // trilha em 03/09/2026.
        comAtor(atorDeServico('ouvinte-whatsapp'), () => {
          let r;
          try {
            r = receberEvento(acervo, mensagens, { agora: agora(), configuracao });
          } catch (erro) {
            // BANCO OCUPADO NAO MATA O OUVINTE, e SO ele e tratado aqui.
            //
            // Medido em 08/09/2026 contra a conta real: com a conversao
            // rodando, `SQLITE_BUSY` subiu de dentro do envelope de Operacao e
            // derrubou o processo em tres minutos. O unit nao o reergueu, e
            // isso e deliberado — ele declara
            // `RestartPreventExitStatus=0 1 2 78` e o Node sai com 1.
            //
            // Esperar nao serve: `better-sqlite3` e sincrono e o
            // `busy_timeout` bloqueia a THREAD, entao esperar minutos
            // congelaria o WebSocket. Recusar tambem nao: a Fonte nao
            // reentrega, e recusar e PERDER.
            //
            // Qualquer outro erro SOBE. Um `catch` largo aqui transformaria
            // todo defeito do produto em evento derramado em silencio.
            if (!ehBancoOcupado(erro)) throw erro;
            derramar(caminhos.derrame, mensagens);
            // O efeito TAMBEM avanca no derrame: o watchdog da frota alarma por
            // silencio, e um ouvinte que esta derramando esta vivo e recebendo.
            // Declara-lo morto mandaria olhar o lugar errado.
            marcarUltimoEvento(caminhos.ultimoEvento, agora());
            escrever(
              `[ouvinte] Acervo ocupado; ${mensagens.length} evento(s) derramado(s) em ` +
                `${caminhos.derrame}. Reprocesse com: malote ouvinte reprocessar`,
            );
            return;
          }
          // O efeito e marcado por EVENTO RECEBIDO, e nao por Mensagem
          // gravada: um ouvinte que so recebe o que ja tem continua vivo, e um
          // efeito que so avanca com escrita nova o declararia morto.
          marcarUltimoEvento(caminhos.ultimoEvento, agora());
          if (r.recusados.length > 0) escrever(`[ouvinte] recusados: ${r.recusados.length}`);
          // So CONTAGENS: o texto da etiqueta e dado pessoal declarado e nunca
          // entra em log, mensagem de erro nem relatorio.
          if (r.etiquetas > 0 || r.etiquetasDaContaSemEndereco > 0) {
            escrever(
              `[ouvinte] etiquetas: ${r.etiquetas} gravada(s), ${r.etiquetasRemovidas} removida(s)` +
                (r.etiquetasDaContaSemEndereco > 0
                  ? `, ${r.etiquetasDaContaSemEndereco} da propria conta sem endereco conferido`
                  : ''),
            );
          }
          // A #1068: cada Anexo que nasceu `nunca-obtido` NESTE lote baixa em
          // segundo plano — fire-and-forget de proposito, porque `aoReceber` e
          // sincrono por construcao (o Ator acima depende disso) e esperar o
          // download aqui bloquearia a proxima mensagem da biblioteca.
          //
          // O Ator abre DE NOVO dentro do `.then`: o comentario no topo desta
          // funcao ja diz por que — o escopo nao atravessa o `await` da
          // biblioteca, e o mesmo vale para o `await` do download.
          for (const anexo of r.anexosNuncaObtidos) {
            const destino = destinoDeMidia;
            if (destino === undefined) continue;
            const keyId = mensagens[anexo.indice]?.key?.id;
            const emVoo = passadaDeEnvio;
            let caminhoOriginado: string | undefined;
            void (async (): Promise<Buffer> => {
              if (keyId !== undefined) {
                caminhoOriginado = bytesOriginados.get(keyId);
                if (caminhoOriginado === undefined && emVoo !== undefined) {
                  await emVoo.catch(() => undefined);
                  caminhoOriginado = bytesOriginados.get(keyId);
                }
              }
              return caminhoOriginado !== undefined
                ? readFileSync(caminhoOriginado)
                : midia.baixar(anexo.indice);
            })()
              .then((bytes) =>
                comAtor(atorDeServico('ouvinte-whatsapp'), () => {
                  try {
                    gravarArquivoDeAnexo(acervo, { anexoId: anexo.anexoId, destino, bytes });
                    // MOVE, nunca apaga ("o produto nunca apaga o que moveu"),
                    // e so DEPOIS de gravar: se a escrita falhar, o staging
                    // continua no lugar para a proxima tentativa.
                    if (caminhoOriginado !== undefined && keyId !== undefined) {
                      bytesOriginados.delete(keyId);
                      const processados = join(dirname(caminhoOriginado), 'processados');
                      mkdirSync(processados, { recursive: true });
                      renameSync(caminhoOriginado, join(processados, basename(caminhoOriginado)));
                    }
                  } catch (erroDeEscrita) {
                    // Mesma politica do resto deste arquivo: banco ocupado
                    // NAO E FALHA, e um catch largo aqui esconderia defeito
                    // real do produto atras de "midia nao chegou".
                    if (ehBancoOcupado(erroDeEscrita)) {
                      escrever(`[ouvinte] midia do Anexo ${anexo.anexoId} adiada: Acervo ocupado.`);
                      return;
                    }
                    escrever(
                      `[ouvinte] midia do Anexo ${anexo.anexoId} falhou ao gravar: ` +
                        `${String(erroDeEscrita)}`,
                    );
                  }
                }),
              )
              .catch((erroDeDownload) => {
                // Rejeicao sem `.catch` mata o processo — o Anexo continua
                // `nunca-obtido`, exatamente como antes desta correcao.
                escrever(
                  `[ouvinte] midia do Anexo ${anexo.anexoId} falhou ao baixar: ` +
                    `${String(erroDeDownload)}`,
                );
              });
          }
          // A serie de vigilancia da #775. Anotada DEPOIS de a recepcao ter
          // sucedido, porque so aqui o relato existe — no caminho do derrame a
          // excecao sobe antes, e aquele lote e contado quando drenar.
          anotarCorrespondencia(caminhos.correspondencia, r.correspondencia, agora());
          // A escrita passou: e o sinal de que a disputa acabou.
          drenar(acervo, caminhos.derrame, configuracao, agora, escrever, caminhos.correspondencia);
        }),
    });

    // Recusa de identidade ANTES do poller: o gancho pode ter recusado durante
    // `conectar`, e nesse caso o Acervo ja foi fechado por `aoTerminar` — o
    // poller de Envio nao pode nascer contra um Acervo fechado.
    if (recusouIdentidade) {
      conexao.parar();
      fecharUmaVez();
      return codigoDeFim;
    }

    // Poller de Envio: so processa a fila DESTA Configuracao, pela conexao que
    // este processo mantem viva — nunca socket proprio (#1112). O mecanismo de
    // nao empilhar passada e por PROCESSO (igual ao worker de Transcricao em
    // src/cli/transcricao.ts), nao lock real entre instancias — suficiente
    // porque um `ouvir` atende uma unica Configuracao por desenho.
    const INTERVALO_DE_ENVIO_MS = Number(process.env['MALOTE_ENVIO_INTERVALO_MS'] ?? '5000');
    let processandoEnvio = false;
    const pollerDeEnvio = setInterval(
      () => {
        if (processandoEnvio) return;
        processandoEnvio = true;
        // Publicada ANTES de a passada comecar: o eco pode chegar de dentro
        // do primeiro trecho sincrono dela, antes de a atribuicao abaixo.
        let terminouAPassada: () => void = () => undefined;
        passadaDeEnvio = new Promise<void>((resolver) => {
          terminouAPassada = resolver;
        });
        comAtor(atorDeServico('ouvinte-whatsapp'), () =>
          processarEnvios(acervo, {
            configuracao,
            enviar: (jid, conteudo) => conexao.enviar(jid, conteudo),
            aoEnviar: (keyId, caminhoDeStaging) => {
              bytesOriginados.set(keyId, caminhoDeStaging);
            },
          }),
        )
          .catch((erro: unknown) =>
            escrever(`[ouvinte] passada de envio abortou: ${(erro as Error).message}`),
          )
          .finally(() => {
            processandoEnvio = false;
            terminouAPassada();
          });
      },
      Number.isInteger(INTERVALO_DE_ENVIO_MS) && INTERVALO_DE_ENVIO_MS > 0 ? INTERVALO_DE_ENVIO_MS : 5000,
    );
    pararPollerDeEnvio = (): void => clearInterval(pollerDeEnvio);

    const parada = (sinal: string): void => {
      escrever(`[ouvinte] ${sinal} recebido; parando.`);
      pararPollerDeEnvio?.();
      conexao.parar();
      fecharUmaVez();
      encerrar(0);
    };
    process.once('SIGTERM', () => parada('SIGTERM'));
    process.once('SIGINT', () => parada('SIGINT'));

    return await fim;
  } catch (causa) {
    escrever(`[ouvinte] nao consegui conectar: ${(causa as Error).message}`);
    fecharUmaVez();
    return 1;
  }
}
