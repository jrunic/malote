import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { abrirRegistro, listarInquilinos } from '../registro/registro.js';
import { configuracaoPorApelido } from '../registro/configuracao-adaptador.js';
import { abrirAcervo, type Acervo } from '../nucleo/acervo.js';
import {
  receberEvento,
  type MensagemRecebida,
  type RelatoDeRecepcao,
} from '../adaptadores/whatsapp/ao-vivo.js';
import { processarEstadoDeConversa } from '../adaptadores/whatsapp/estado-ao-vivo.js';
import { processarAvisoDeGrupo } from '../adaptadores/whatsapp/metadados-de-coletiva-ao-vivo.js';
import { processarEnvios } from '../adaptadores/whatsapp/enviar.js';
import { carregarDecodificador, conectar } from '../adaptadores/whatsapp/conexao.js';
import type { Decodificador } from '../adaptadores/whatsapp/edicao.js';
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
import { registrarDescartes } from './descartes.js';
import { criarMarcadorDoSinal } from './sinal-da-conexao.js';
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
import { opcao, recusarBandeiras } from './bandeiras.js';

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
  /** Serie diaria do que a recepcao nao grava como Mensagem (#1159). Ver `descartes.ts`. */
  descartes: string;
  /** Guarda do evento cru que a recepcao nao grava (#1159). Ver `guarda-de-descartes.ts`. */
  guarda: string;
  /** O instante do ultimo frame que a Conexao recebeu (#1162). Ver `sinal-da-conexao.ts`. */
  sinal: string;
  /** Serie diaria das Mensagens gravadas pela janela de relogio (#1204). Ver `descartes.ts`. */
  adiantadas: string;
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
      descartes: join(pasta, 'descartes.json'),
      guarda: join(pasta, 'descartados.jsonl'),
      sinal: join(pasta, 'ultimo-sinal.txt'),
      adiantadas: join(pasta, 'instantes-adiantados.json'),
  };
}

function descreverIntervalo(de: number, ate: number): string {
  const minutos = Math.max(0, Math.floor((ate - de) / 60_000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h`;
  return `${Math.floor(horas / 24)} dias`;
}

/**
 * Codigo de saida de uma excecao que a biblioteca de recepcao deixou escapar (#1173).
 *
 * E contrato com o supervisor: o unit reserva `0 1 2 78` em `RestartPreventExitStatus` e reinicia
 * qualquer outro. O 1 e vinculo invalidado e pede pareamento humano, entao uma excecao nao pode sair
 * por ele (30/09/2026: `Connection Closed` rejeitada pela biblioteca em `sendRetryRequest` derrubou
 * o ouvinte com 1, o unit nao reiniciou e ele ficou 9h24 fora, sem alarme). 70 e `EX_SOFTWARE`
 * (sysexits), fora da lista reservada e de qualquer codigo que o ouvinte use.
 */
export const CODIGO_DE_EXCECAO_NAO_TRATADA = 70;

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
  aoDescartar?: (relato: RelatoDeRecepcao) => void,
  decodificar?: Decodificador,
  enderecoDaConta?: string,
): void {
  for (let i = 0; i < LOTES_POR_DRENAGEM; i += 1) {
    const lote = lerDerrame(caminho)[0];
    if (lote === undefined) return;
    try {
      const r = receberEvento(acervo, lote as MensagemRecebida[], {
        agora: agora(),
        configuracao,
        ...(decodificar !== undefined ? { decodificar } : {}),
        ...(enderecoDaConta !== undefined ? { enderecoDaConta } : {}),
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
      // O que a drenagem descartou tambem entra no contador: o lote so e visto aqui.
      //
      // MUTANTE EQUIVALENTE OBSERVAVEL (medido em 07/10/2026): chamar o gancho depois de
      // `removerPrimeiroLote` nao derruba teste algum; o contador e anotado dos dois jeitos.
      // A ordem importa so numa morte entre as duas linhas: aqui, morrer no meio DUPLICA a
      // contagem do lote (barato); invertido, PERDERIA (nao tem volta).
      aoDescartar?.(r);
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
  const recusaDeBandeira = recusarBandeiras(argumentos, escrever);
  if (recusaDeBandeira !== undefined) return recusaDeBandeira;
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
  // O endereco canonico da propria conta (#1334), para a Citacao dizer se a citada e dela. Vem do Registro (o ultimo
  // vinculo conferido) e e renovado quando o vinculo se identifica.
  let enderecoDaConta: string | undefined;
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
    enderecoDaConta = lerEnderecosDaConta(registro, cfg.id)?.jid ?? undefined;
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
    enderecoDaConta = id.jid;
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
  // Parar a conexao so existe depois de `conectar` retornar.
  let pararConexao: (() => void) | undefined;

  // EXCECAO QUE ESCAPA DA BIBLIOTECA (#1173). Sem tratador o Node sai com 1, que o unit le como
  // "vinculo invalidado" e NAO reinicia. Aqui a saida e por um codigo que o supervisor reinicia, e a
  // linha diz que foi excecao, para nao se confundir com o vinculo invalidado no log. A queda de
  // rotina (428, 515) nao passa por aqui: a conexao a trata por dentro e religa.
  let saiuPorExcecao = false;
  const aoEscaparExcecao =
    (origem: string) =>
    (causa: unknown): void => {
      if (saiuPorExcecao) return;
      saiuPorExcecao = true;
      // So o nome, a mensagem e o comeco da pilha: a pilha localiza a chamada (foi ela que achou
      // `messages-recv` em 30/09) e a mensagem de erro da biblioteca nao carrega texto de conversa.
      const descricao =
        causa instanceof Error
          ? (causa.stack ?? `${causa.name}: ${causa.message}`).split('\n').slice(0, 6).join(' | ')
          : String(causa);
      escrever(
        `[ouvinte] EXCECAO NAO TRATADA (${origem}): ${descricao}; ` +
          `saindo com ${CODIGO_DE_EXCECAO_NAO_TRATADA} para o supervisor reiniciar.`,
      );
      pararPollerDeEnvio?.();
      try {
        pararConexao?.();
      } catch {
        // A conexao ja pode estar morta, que e justamente o caso: o que importa e sair.
      }
      fecharUmaVez();
      encerrar(CODIGO_DE_EXCECAO_NAO_TRATADA);
    };
  const aoRejeitarSemTratamento = aoEscaparExcecao('rejeicao');
  const aoLancarSemTratamento = aoEscaparExcecao('excecao');
  process.on('unhandledRejection', aoRejeitarSemTratamento);
  process.on('uncaughtException', aoLancarSemTratamento);

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

  // O sinal de vida da Conexao (#1162): o instante do ultimo frame do transporte, estrangulado, em
  // arquivo ao lado do `ultimo-evento`. Falha dele nunca derruba a recepcao.
  const marcarSinal = criarMarcadorDoSinal({ caminho: caminhos.sinal, agora, avisar: escrever });

  // O decodificador da edicao cifrada (#1246) vem do portao e e carregado ANTES do primeiro evento, porque `receberEvento` e
  // sincrono. Falha em carregar nunca impede de ouvir: a edicao cifrada segue descartada e guardada, com a causa dita.
  //
  // A biblioteca injetada (teste) e carregada UMA vez e compartilhada com `conectar`: carregar e ter efeito, no dublê, e dois
  // carregamentos disparariam o efeito duas vezes. Em producao nao ha injecao e cada um faz o proprio import dinamico, que e
  // idempotente.
  let biblioteca: Promise<unknown> | undefined;
  const carregarUmaVez =
    ambiente.carregarBiblioteca === undefined
      ? undefined
      : (): Promise<unknown> => (biblioteca ??= (ambiente.carregarBiblioteca as () => Promise<unknown>)());
  let decodificar: Decodificador | undefined;
  try {
    decodificar = await carregarDecodificador({
      ...(carregarUmaVez !== undefined ? { carregarBiblioteca: carregarUmaVez } : {}),
    });
  } catch (erro) {
    escrever(`[ouvinte] decodificador de edicao indisponivel; edicoes cifradas ficam guardadas: ${String(erro)}`);
  }

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
      aoFrame: marcarSinal,
      // O aviso de metadados de grupo entra por um gancho que NAO e o de `aoReceber`: o Ator abre AQUI, pelo mesmo
      // motivo (o escopo nao atravessa o encanamento assincrono da biblioteca), senao a Operacao sairia
      // `indeterminado`. Uma Operacao por aviso. So CONTAGENS: assunto e descricao sao texto de conversa.
      aoAvisoDeGrupo: (fluxo, dado) =>
        comAtor(atorDeServico('ouvinte-whatsapp'), () => {
          const r = processarAvisoDeGrupo(acervo, fluxo, dado, agora());
          // O aviso REPETIDO (o que chega depois de todo evento de grupo) nao sai no log: seria uma linha por troca.
          if (r.gravados > 0 || r.semTexto > 0 || r.foraDeGrupo > 0) {
            escrever(
              `[ouvinte] metadados de coletiva (aviso): ${r.gravados} gravado(s), ${r.repetidos} repetido(s)` +
                (r.semTexto > 0 ? `, ${r.semTexto} sem texto` : '') +
                (r.foraDeGrupo > 0 ? `, ${r.foraDeGrupo} fora de grupo` : ''),
            );
          }
        }),
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
      ...(carregarUmaVez !== undefined ? { carregarBiblioteca: carregarUmaVez } : {}),
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
            r = receberEvento(acervo, mensagens, {
              agora: agora(),
              configuracao,
              ...(decodificar !== undefined ? { decodificar } : {}),
              ...(enderecoDaConta !== undefined ? { enderecoDaConta } : {}),
            });
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
          // So o NUMERO: e a medicao de campo da janela de relogio (#1204), e o texto da Mensagem nunca entra em log.
          if (r.mensagensPelaJanela > 0) {
            escrever(`[ouvinte] mensagens aceitas pela tolerancia de relogio: ${r.mensagensPelaJanela}`);
          }
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
          // So CONTAGENS: assunto e descricao de grupo sao texto de conversa e nunca entram em log.
          if (r.metadadosDeColetiva > 0) {
            escrever(`[ouvinte] metadados de coletiva: ${r.metadadosDeColetiva} gravado(s), ${r.metadadosRepetidos} repetido(s)`);
          }
          const ignoradosDeMetadados = Object.entries(r.metadadosIgnorados);
          if (ignoradosDeMetadados.length > 0) {
            escrever(`[ouvinte] metadados de coletiva ignorados: ${ignoradosDeMetadados.map(([m, n]) => `${m}=${n}`).join(', ')}`);
          }
          // So CONTAGENS: nome, telefone e e-mail de cartao nunca entram em log.
          if (r.contatosCompartilhados > 0 || r.contatosCompartilhadosRecusados > 0) {
            escrever(
              `[ouvinte] contatos compartilhados: ${r.contatosCompartilhados} gravado(s)` +
                (r.contatosCompartilhadosRecusados > 0 ? `, ${r.contatosCompartilhadosRecusados} recusado(s)` : ''),
            );
          }
          // Edicoes de Mensagem (#1246): so CONTAGENS e rotulos de causa; o texto da edicao nunca entra em log.
          if (r.edicoes > 0 || r.edicoesRepetidas > 0) {
            escrever(
              `[ouvinte] edicoes: ${r.edicoes} gravada(s)` +
                (r.edicoesRepetidas > 0 ? `, ${r.edicoesRepetidas} repetida(s)` : ''),
            );
          }
          const edicoesNaoGravadas = Object.entries(r.edicoesNaoGravadas);
          if (edicoesNaoGravadas.length > 0) {
            escrever(`[ouvinte] edicoes nao gravadas: ${edicoesNaoGravadas.map(([c, n]) => `${c}=${n}`).join(', ')}`);
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
          registrarDescartes(caminhos, r, agora(), escrever);
          // A escrita passou: e o sinal de que a disputa acabou.
          drenar(
            acervo,
            caminhos.derrame,
            configuracao,
            agora,
            escrever,
            caminhos.correspondencia,
            (relato) => registrarDescartes(caminhos, relato, agora(), escrever),
            decodificar,
            enderecoDaConta,
          );
        }),
    });

    pararConexao = (): void => conexao.parar();
    // Uma excecao durante `conectar` ja fechou o Acervo e resolveu o fim: nao sobe poller sobre ele.
    if (saiuPorExcecao) return CODIGO_DE_EXCECAO_NAO_TRATADA;

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
  } finally {
    // Processo vivo depois do `ouvir` (os testes chamam em processo): tratador que sobra vaza.
    process.off('unhandledRejection', aoRejeitarSemTratamento);
    process.off('uncaughtException', aoLancarSemTratamento);
  }
}
