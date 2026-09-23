import type { Acervo } from '../../nucleo/acervo.js';
import {
  anexoJaExiste,
  conversaJaExiste,
  InstanteImplausivelError,
  mensagemJaExiste,
  participacaoJaExiste,
  registrarAnexo,
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
  registrarTransicao,
} from '../../nucleo/escrita.js';
import { nomeRepeteOEndereco } from '../../nucleo/nome-do-endereco.js';
import { registrarNome } from '../../nucleo/identidade.js';
import { marcarMensagem } from '../../nucleo/marca-do-titular.js';
import {
  aprenderCorrespondencia,
  resolverEndereco,
  CorrespondenciaEmConflitoError,
} from '../../nucleo/correspondencia.js';
import { materialJaEntrou, registrarMaterialConcluido } from '../../nucleo/sincronizacao.js';
import { relatorioVazio, type RelatorioDeImportacao } from '../relatorio.js';
import {
  CONTA_PADRAO,
  dominioDaConta,
  impressaoDoMaterial,
  lerMaterial,
  type Material,
  type ParticipanteDoMaterial,
} from './material.js';
import { classificar } from './codigos-de-evento.js';
import { emOperacao } from '../../nucleo/trilha.js';

export type { RelatorioDeImportacao };

/**
 * Traduz o material lido para chamadas da porta do núcleo.
 *
 * Esta camada NÃO toca tabela: tudo passa pela porta. É o que faz o teste de
 * aceite do desenho ter poder no ciclo 2 — o adaptador conhece a porta, não
 * o schema.
 */

export interface OpcoesDeImportacao {
  agora: number;
  /**
   * Endereço do Titular nesta Fonte. O backup não o declara de forma
   * confiável, então o padrão é um marcador do próprio malote — o que importa
   * para o invariante é que a Conversa direta tenha os dois lados.
   */
  enderecoDoTitular?: string;
  /** Qual conta da Fonte. Vocabulário do Adaptador; ver DOMINIO_POR_CONTA. */
  conta?: string;
  /**
   * Configuração de Adaptador sob a qual este Material entra. OBRIGATÓRIA.
   *
   * Era opcional até 08/09/2026, e opcional é o que permitia o chamador não
   * passar nada e o produto seguir — com as Conversas diretas de duas contas
   * caindo no mesmo fio. Vem a Fonte junto do id porque é a porta de escrita
   * que confere o par.
   */
  configuracao: { id: string; fonte: 'whatsapp' };
  /** Percorre o material mesmo que ele já tenha sido registrado. */
  reprocessar?: boolean;
  /** Só para teste: injeta falha no N-ésimo item, dentro do lote. */
  falharNoItem?: number;
}

const TITULAR_PADRAO = 'titular@malote.local';

/**
 * A Operacao da ingestao e do MATERIAL, nunca do nome de cada Conversa.
 *
 * Sem este envelope, `registrarNome` — chamado uma vez por Conversa — abre
 * uma Operacao por nome: medido em 29/08/2026, 30 Cartoes produziam 30
 * Operacoes, e o catalogo real tem 6.693. Aqui a reentrancia junta tudo
 * numa so, e `registraEfeito: false` impede que o efeito de cada nome seja
 * gravado — o que dobraria o Acervo.
 */
export function importarMaterial(
  acervo: Acervo,
  raizDoBackup: string,
  opcoes: OpcoesDeImportacao,
): RelatorioDeImportacao {
  return emOperacao(
    acervo,
    {
      natureza: 'importar-material',
      reversibilidade: 'irreversivel',
      registraEfeito: false,
      // A importacao e retomavel: interrompida, o que entrou fica.
      emTransacao: false,
    },
    () => importarMaterialInterno(acervo, raizDoBackup, opcoes),
  );
}

function importarMaterialInterno(
  acervo: Acervo,
  raizDoBackup: string,
  opcoes: OpcoesDeImportacao,
): RelatorioDeImportacao {
  const dominio = dominioDaConta(opcoes.conta ?? CONTA_PADRAO);

  // Antes de abrir o material: se ele ja entrou, nao ha o que percorrer. E a
  // diferenca entre uma rodada recorrente barata e uma passagem completa que
  // descobre no fim que nao havia nada a fazer.
  const impressao = impressaoDoMaterial(raizDoBackup, dominio);
  if (opcoes.reprocessar !== true) {
    if (materialJaEntrou(acervo, opcoes.configuracao.id, impressao) !== null) {
      return { ...relatorioVazio(), jaRegistrado: true };
    }
  }

  const material = lerMaterial(raizDoBackup, dominio);
  // O iterador de Mensagens le do ChatStorage enquanto corre, entao o handle
  // sobrevive a `lerMaterial` e alguem tem de solta-lo. Falha no meio tambem
  // solta: `finally`, e nao uma chamada no caminho feliz.
  let relatorio: RelatorioDeImportacao;
  try {
    relatorio = gravarMaterialLido(acervo, material, opcoes);
  } finally {
    material.fechar();
  }

  // So aqui: o Material so e registrado quando a importacao TERMINA. Falha no
  // meio deixa o Acervo com o que entrou e sem registro, e a execucao seguinte
  // processa tudo de novo — a idempotencia e a rede embaixo.
  {
    registrarMaterialConcluido(acervo, {
      configuracaoId: opcoes.configuracao.id,
      fonte: 'whatsapp',
      impressao,
      conversasCriadas: relatorio.conversasCriadas,
      mensagensCriadas: relatorio.mensagensCriadas,
    });
  }

  return relatorio;
}

/**
 * Grava no Acervo um material JA LIDO.
 *
 * Extraida de `importarMaterialInterno` para que a guarda central do ciclo 9
 * seja testavel: montar dois retratos que diferem custa tres linhas aqui e um
 * arquivo de 1,2 GB do outro lado. A leitura do disco, a impressao do material
 * e o registro de conclusao continuam no chamador.
 */
export function gravarMaterialLido(
  acervo: Acervo,
  material: Material,
  opcoes: OpcoesDeImportacao,
): RelatorioDeImportacao {
  // `mensagensLidas` e contado DENTRO do laco, e nao pelo tamanho do material:
  // as Mensagens chegam por iterador, e perguntar o tamanho antes obrigaria a
  // materializar tudo — que e exatamente o custo que o iterador existe para
  // evitar. O compilador pegou este sitio quando o tipo mudou.
  const relatorio: RelatorioDeImportacao = { ...relatorioVazio() };

  const observadaEm = new Date(opcoes.agora).toISOString();

  // As correspondencias sao aprendidas ANTES de qualquer escrita de endereco, e
  // a ordem NAO e livre: aprender depois nao resolveria nada, porque Conversas
  // e Identificadores ja teriam nascido na forma alternativa. Foi assim que o
  // acervo real ganhou 18.653 Identificadores nessa forma — identidades
  // separadas de gente que ja estava la pelo telefone.
  for (const par of material.correspondencias) {
    try {
      aprenderCorrespondencia(acervo, { fonte: 'whatsapp', ...par });
    } catch (erro) {
      if (!(erro instanceof CorrespondenciaEmConflitoError)) throw erro;
      // Conflito e achado, nao motivo para abortar a importacao inteira.
      relatorio.conflitosDeEndereco += 1;
    }
  }

  const idPorConversaExterna = new Map<string, string>();
  for (const cru of material.conversas) {
    // O endereco e traduzido para a forma canonica ANTES de virar `id_externo`.
    const c = { ...cru, idExterno: resolverEndereco(acervo, 'whatsapp', cru.idExterno) };
    const conversaJaEstava = conversaJaExiste(acervo, 'whatsapp', c.idExterno);
    const id = registrarConversa(acervo, {
      fonte: 'whatsapp',
      bruto: c.bruto,
      idExterno: c.idExterno,
      coletiva: c.coletiva,
      // Condicional, e não incondicional: a porta RECUSA coletiva com
      // Configuração, porque o grupo é um só para todas as contas.
      ...(c.coletiva ? {} : { configuracao: opcoes.configuracao }),
      ...(c.coletiva && c.nome !== null ? { metadadosDeColetiva: { assunto: c.nome } } : {}),
    });
    idPorConversaExterna.set(c.idExterno, id);
    idPorConversaExterna.set(cru.idExterno, id);
    if (conversaJaEstava) relatorio.conversasJaExistentes += 1;
    else relatorio.conversasCriadas += 1;

    // Conversa direta: as duas Participações são deriváveis sempre — o Titular
    // e o outro lado, que é o próprio endereço da Conversa.
    // Conversa coletiva: só o que a Fonte informar. Vazio é válido.
    // NENHUMA data de entrada é gravada: o material não a tem. ADR
    // 20260826-participacao-sem-historico-em-material-exportado.
    // Conversa direta NAO declara atividade: nao ha roster, nao ha o campo.
    // Por isso ele e omitido aqui, e nao preenchido com `true` — escrever
    // `true` afirmaria o que a Fonte nao disse.
    const participantes: ParticipanteDoMaterial[] = c.coletiva
      ? c.participantesConhecidos
      : [{ endereco: c.idExterno }, { endereco: opcoes.enderecoDoTitular ?? TITULAR_PADRAO }];

    for (const {
      endereco: enderecoCru,
      ativaNaFonte,
      bruto: brutoDoRoster,
      nome: nomeDoMembro,
    } of participantes) {
      // Mesma traducao do endereco da Conversa, e pela mesma razao: gravar a
      // forma alternativa criaria uma segunda identidade para quem ja esta no
      // acervo pelo telefone.
      const endereco = resolverEndereco(acervo, 'whatsapp', enderecoCru);
      const { id: identificadorId } = registrarIdentificador(acervo, {
        fonte: 'whatsapp',
        valor: endereco,
      });
      const participacaoJaEstava = participacaoJaExiste(acervo, id, identificadorId);
      registrarParticipacao(acervo, {
        conversaId: id,
        identificadorId,
        observadaEm,
        ...(ativaNaFonte !== undefined ? { ativaNaFonte } : {}),
        // Ausente em Conversa direta, onde o participante e DERIVADO e nao ha
        // linha de roster para preservar.
        ...(brutoDoRoster !== undefined ? { bruto: brutoDoRoster } : {}),
      });
      if (participacaoJaEstava) relatorio.participacoesJaExistentes += 1;
      else relatorio.participacoesCriadas += 1;

      // O nome que o DONO DA CONTA cadastrou para este membro. So existe em
      // roster de COLETIVA: em Conversa direta o participante e derivado, e o
      // nome da contraparte entra pelo bloco proprio, mais abaixo.
      //
      // Medido em 13/09/2026 contra o material de 05/09: 10.168 linhas de roster
      // trazem o campo, e 8.151 membros distintos NAO tem Conversa direta
      // nenhuma — sao exatamente a populacao que este projeto vinha chamando de
      // enderecos sem par. A mesma recusa da contraparte vale aqui: nome que
      // repete o proprio endereco nao nomeia ninguem.
      if (nomeDoMembro !== undefined) {
        if (nomeRepeteOEndereco(nomeDoMembro, endereco)) {
          relatorio.nomesQueRepetemOEndereco += 1;
        } else {
          registrarNome(acervo, {
            identificadorId,
            origem: 'whatsapp',
            nome: nomeDoMembro,
            autoridade: 'titular',
          });
        }
      }

      // Comparacao explicita contra true e false: `undefined` nao cai em
      // nenhum dos dois, que e o caso da Conversa direta — la a Fonte nao
      // declara atividade, e contar seria inventar declaracao.
      if (ativaNaFonte === true) relatorio.participantesAtivos += 1;
      else if (ativaNaFonte === false) relatorio.participantesInativos += 1;

      // O material afirma que ESTE ENDERECO se chama X — nao que uma pessoa
      // se chama X. Por isso o nome pendura no Identificador, e importar
      // continua nao criando Pessoa nenhuma.
      //
      // So na Conversa direta: em grupo, `nome` e o nome do GRUPO, e ja vira
      // assunto nos Metadados de Coletiva. Grava-lo como nome do participante
      // chamaria todo mundo do grupo pelo nome do grupo.
      if (!c.coletiva && c.nome !== null && endereco === c.idExterno) {
// A plataforma preenche este campo com o PROPRIO numero quando nao ha
        // contato cadastrado, e isso nao nomeia ninguem. Recusa CONTADA: sem o
        // contador, 'ninguem tem nome' e 'o produto descartou' ficam iguais.
        if (nomeRepeteOEndereco(c.nome, endereco)) {
          relatorio.nomesQueRepetemOEndereco += 1;
        } else {
          // `titular`: vem de ZPARTNERNAME, que e a agenda do DONO DA CONTA, e
          // nao o nome que o outro escolheu para si. Procedencia provada em
          // 07/09/2026: 90% dos nomes deste campo diferem do que chega ao vivo.
          registrarNome(acervo, {
            identificadorId,
            origem: 'whatsapp',
            nome: c.nome,
            autoridade: 'titular',
          });
        }
      }
    }
  }

  // As Transicoes saem dos EVENTOS declarados, nunca da comparacao entre
  // retratos. Nao existe, em lugar nenhum deste arquivo, leitura do roster
  // anterior — e essa ausencia e a guarda central do ciclo.
  for (const ev of material.eventos) {
    const conversaId = idPorConversaExterna.get(ev.conversaIdExterno);
    if (conversaId === undefined) continue;

    const natureza = classificar(ev.codigo);
    if (natureza === null) {
      const chave = String(ev.codigo);
      relatorio.eventosDesconhecidos[chave] = (relatorio.eventosDesconhecidos[chave] ?? 0) + 1;
      continue;
    }

    const { id: identificadorId } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: resolverEndereco(acervo, 'whatsapp', ev.membroExterno),
    });
    const nasceu = registrarTransicao(acervo, {
      conversaId,
      identificadorId,
      natureza,
      ocorridaEm: ev.ocorridoEm,
      fonte: 'whatsapp',
      idExterno: ev.idExterno,
      codigoDaFonte: String(ev.codigo),
    });
    if (nasceu) relatorio.transicoesCriadas += 1;
  }

  let item = 0;
  for (const m of material.mensagens) {
    item += 1;
    relatorio.mensagensLidas += 1;
    if (opcoes.falharNoItem !== undefined && item === opcoes.falharNoItem) {
      throw new Error(`Importacao: falha injetada no item ${item}`);
    }

    const conversaId = idPorConversaExterna.get(m.conversaIdExterno);
    if (conversaId === undefined) {
      relatorio.mensagensRejeitadas += 1;
      const motivo = 'conversa da mensagem ausente no material';
      relatorio.rejeicoesPorMotivo[motivo] = (relatorio.rejeicoesPorMotivo[motivo] ?? 0) + 1;
      continue;
    }

    // Instante ausente na origem NÃO vira zero: vira um valor que a porta
    // recusa, e a recusa é contabilizada por motivo. Ver #606.
    const ocorridaEm = m.ocorridaEm ?? Number.NaN;

    let autorId: string | undefined;
    if (m.autorExterno !== undefined) {
      autorId = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: m.autorExterno }).id;
    }

    const jaExistia = mensagemJaExiste(acervo, 'whatsapp', m.idExterno);

    let mensagemId: string;
    try {
      mensagemId = registrarMensagem(acervo, {
        conversaId,
        fonte: 'whatsapp',
        idExterno: m.idExterno,
        direcao: m.daPropriaPessoa ? 'enviada' : 'recebida',
        ...(autorId !== undefined ? { autorId } : {}),
        ...(m.texto !== null ? { conteudo: m.texto } : {}),
        ocorridaEm,
        bruto: m.bruto,
        agora: opcoes.agora,
      });
    } catch (causa) {
      if (causa instanceof InstanteImplausivelError) {
        relatorio.mensagensRejeitadas += 1;
        relatorio.rejeicoesPorMotivo[causa.motivo] =
          (relatorio.rejeicoesPorMotivo[causa.motivo] ?? 0) + 1;
        continue;
      }
      throw causa;
    }

    if (jaExistia) relatorio.mensagensJaExistentes += 1;
    else relatorio.mensagensCriadas += 1;

    // A MARCA ENTRA AQUI, e o lugar foi medido: producao ja tem todas as
    // Mensagens do material, entao marca num ramo que so rode para Mensagem
    // NOVA marcaria zero na reimportacao. `registrarMensagem` devolve o id da
    // existente em vez de pular, e o bloco de Anexo logo abaixo ja depende
    // dessa propriedade — a marca depende da mesma.
    //
    // `observadaEm` e o instante do MATERIAL, nunca o de agora: o favorito foi
    // observado quando o backup foi tirado, e reimportar o mesmo material duas
    // vezes nao pode mover a data.
    if (m.favorita) {
      const nasceu = marcarMensagem(acervo, {
        mensagemId,
        marca: 'favorito',
        configuracaoId: opcoes.configuracao.id,
        observadaEm: opcoes.agora,
      });
      if (nasceu) relatorio.favoritos += 1;
    }

    // ANTES de qualquer desvio por Mensagem ja existente: o Anexo de uma
    // Mensagem repetida precisa ser contado como ja existente, senao o campo
    // fica sempre zero na reimportacao e mente por omissao.
    if (m.anexo !== undefined) {
      if (anexoJaExiste(acervo, mensagemId)) {
        relatorio.anexosJaExistentes += 1;
      } else {
        // O caminho é decidido pelo NÚCLEO, dentro da porta, a partir do id
        // interno. O adaptador não o conhece — o caminho da origem, que carrega
        // apelido e número, não atravessa.
        registrarAnexo(acervo, {
          mensagemId,
          tipo: m.anexo.tipo,
          presenca: 'nunca-obtido',
          ...(m.anexo.tamanhoDeclarado !== undefined ? { tamanho: m.anexo.tamanhoDeclarado } : {}),
          ...(m.anexo.bruto !== undefined ? { bruto: m.anexo.bruto } : {}),
        });
        relatorio.anexosCriados += 1;
      }
    }
  }

  // DEPOIS do laco, e isso nao e estilo: o leitor conta enquanto o gerador
  // corre, entao antes daqui `material.descartes.mensagens` esta vazio. Ler
  // antes reportaria zero descartes com o material contraditorio — exatamente o
  // silencio que esta correcao existe para acabar.
  //
  // Somado e nao atribuido: `gravarMaterialLido` pode ser chamado mais de uma
  // vez sobre o mesmo relatorio.
  for (const [motivo, quantas] of Object.entries(material.descartes.mensagens)) {
    relatorio.descartesDoLeitor[motivo] = (relatorio.descartesDoLeitor[motivo] ?? 0) + quantas;
  }
  relatorio.linhasRepetidasNoMaterial += material.linhasRepetidasNoMaterial;
  for (const [motivo, quantas] of Object.entries(material.descartes.eventos)) {
    const rotulo = `${motivo} (evento)`;
    relatorio.descartesDoLeitor[rotulo] = (relatorio.descartesDoLeitor[rotulo] ?? 0) + quantas;
  }

  return relatorio;
}
