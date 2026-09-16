import Database from 'better-sqlite3';
import { impressaoDeEntradas } from '../impressao.js';
import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TIPO_ADMINISTRATIVO } from './codigos-de-evento.js';

/**
 * Leitor de material exportado do WhatsApp: backup de dispositivo iOS.
 *
 * Esta camada conhece o FORMATO e não conhece o malote. Não importa tipo do
 * núcleo, não abre Acervo, não decide caminho de arquivo. Produz itens
 * neutros que a camada de importação traduz.
 */

/** Segundos entre 1970-01-01 e 2001-01-01. `ZMESSAGEDATE` é relativo a 2001. */
const EPOCA_CORE_DATA = 978_307_200;

/**
 * Cada conta do WhatsApp vive num dominio proprio do backup de iOS. O
 * vocabulario aqui e do Adaptador — o Registro guarda so a cadeia 'pessoal' ou
 * 'business' e nao sabe o que ela significa.
 *
 * Medido em 28/08/2026 contra backup real: um mesmo aparelho carrega os dois
 * dominios, e ate esta mudanca o produto so conseguia ler o primeiro — uma
 * conta inteira do Titular era invisivel.
 */
export const DOMINIO_POR_CONTA: Record<string, string> = {
  pessoal: 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared',
  business: 'AppDomainGroup-group.net.whatsapp.WhatsAppSMB.shared',
};

export const CONTA_PADRAO = 'pessoal';

export function dominioDaConta(conta: string): string {
  const dominio = DOMINIO_POR_CONTA[conta];
  if (dominio === undefined) {
    const conhecidas = Object.keys(DOMINIO_POR_CONTA).join(', ');
    throw new Error(
      `Conta desconhecida para a Fonte whatsapp: ${conta}. Contas conhecidas: ${conhecidas}.`,
    );
  }
  return dominio;
}

/** `ZMESSAGETYPE` do iOS para o tipo que o malote guarda. */
const TIPO_POR_CODIGO: Record<number, string> = {
  0: 'text',
  1: 'image',
  2: 'video',
  3: 'audio',
  4: 'contact',
  5: 'location',
  8: 'document',
  11: 'sticker',
};

export interface ParticipanteDoMaterial {
  endereco: string;
  /**
   * O nome que o DONO DA CONTA cadastrou para este membro.
   *
   * OPCIONAL pela mesma razao que `ativaNaFonte`: Conversa direta nao tem
   * roster, e o participante derivado nao tem linha de onde ler.
   *
   * Medido em 13/09/2026 contra o material de 05/09: 10.168 linhas de roster
   * trazem algum dos dois campos, e 8.151 membros distintos NAO tem Conversa
   * direta nenhuma — sao a populacao que este projeto vinha chamando de
   * enderecos sem par.
   */
  nome?: string;
  /**
   * O que a Fonte declara sobre a atividade deste membro no momento do export.
   *
   * OPCIONAL de propósito: Conversa direta não tem roster, e ali ninguém
   * declara nada — o campo é omitido, e não preenchido com `true`. Escrever
   * `true` seria afirmar o que a Fonte não disse.
   *
   * Medido em 30/08/2026: 58% das linhas de roster da conta pessoal e 98,7%
   * da comercial vêm inativas, e até este ciclo o adaptador descartava a
   * distinção — importava quem saiu como se estivesse.
   */
  ativaNaFonte?: boolean;
  /**
   * O registro original da linha de roster. OPCIONAL pela mesma razao de
   * `ativaNaFonte`: Conversa direta nao tem roster, e o participante ali e
   * DERIVADO — nao existe linha da Fonte para preservar. Onde ha roster, o
   * adaptador sempre preenche.
   */
  bruto?: string;
}

/** Uma linha crua da Fonte, como o driver a devolve. */
type LinhaCrua = Record<string, unknown>;

/**
 * Serializa a linha ORIGINAL da Fonte para o Conteudo Bruto.
 *
 * BLOB vira base64 num envelope nomeado. `JSON.stringify` de um Buffer produz
 * `{"type":"Buffer","data":[137,80,...]}` — um array de inteiros, cerca de
 * QUATRO vezes o tamanho dos bytes e ilegivel. Os unicos BLOBs do material sao
 * ZMEDIAKEY e ZMETADATA, em ZWAMEDIAITEM.
 *
 * Coluna nula e OMITIDA: o material real tem dezenas de colunas vazias por
 * linha, e grava-las como null triplicaria o custo sem acrescentar informacao
 * — ausente e nulo dizem a mesma coisa aqui.
 */
/** Tira do bruto da Mensagem as duas colunas que vieram do JOIN de midia. */
function semColunasDeMidia(linha: LinhaCrua): LinhaCrua {
  const { ZMEDIALOCALPATH: _a, ZFILESIZE: _b, ...resto } = linha;
  return resto;
}

export function serializarLinha(linha: LinhaCrua): string {
  const limpa: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(linha)) {
    if (valor === null || valor === undefined) continue;
    limpa[chave] = Buffer.isBuffer(valor) ? { __b64: valor.toString('base64') } : valor;
  }
  return JSON.stringify(limpa);
}

export interface ConversaDoMaterial {
  idExterno: string;
  nome: string | null;
  coletiva: boolean;
  /**
   * Quem a Fonte informa estar na Conversa no momento do export.
   * Vazio é resultado legítimo: grupo do qual o Titular saiu não traz membro.
   * Sem data de entrada — o formato não a tem. Ver a ADR
   * `20260826-participacao-sem-historico-em-material-exportado`.
   *
   * Continua sendo um RETRATO. A diferença entre dois retratos nunca produz
   * Transição — quem a produz é o evento declarado, lido em `eventos`.
   */
  participantesConhecidos: ParticipanteDoMaterial[];
  /** O registro original da Fonte. Ver o agregado Conteudo Bruto no modelo. */
  bruto: string;
}

export interface EventoDoMaterial {
  /** Identificador externo estável do evento. É ele que dá a idempotência. */
  idExterno: string;
  conversaIdExterno: string;
  /** Endereço do membro que o evento nomeia. */
  membroExterno: string;
  /** O código bruto da Fonte, antes de qualquer classificação. */
  codigo: number;
  ocorridoEm: number;
}

export interface AnexoDoMaterial {
  tipo: string;
  caminhoNaOrigem: string | null;
  /**
   * Tamanho que o MATERIAL declara, em bytes. Medido em 28/08/2026 contra o
   * material real: bate com o arquivo em disco em 4.761 de 4.761. E o que
   * permite relatar espaco antes de qualquer copia — sem ele, `tamanho` seria
   * nulo em todo Anexo ate alguem trazer o arquivo.
   */
  tamanhoDeclarado?: number;
  /** O registro original de ZWAMEDIAITEM. Carrega LATITUDE/LONGITUDE e vCard. */
  bruto?: string;
}

export interface MensagemDoMaterial {
  idExterno: string;
  conversaIdExterno: string;
  texto: string | null;
  /**
   * Instante em milissegundos, ou AUSENTE quando a origem não tem data.
   * Nunca zero: converter ausência em zero foi o defeito que produziu a
   * tarefa #606 no acervo de origem.
   */
  ocorridaEm?: number;
  daPropriaPessoa: boolean;
  autorExterno?: string;
  anexo?: AnexoDoMaterial;
  /**
   * A Mensagem que o dono da conta FAVORITOU — a Marca do Titular.
   *
   * Medido em 13/09/2026 nos dois materiais reais: 57 Mensagens em 6 Conversas
   * no de setembro, 90 em 7 no de abril. Favorito MUDA entre dois materiais, e
   * e por isso que numero antigo e linha de base e nunca expectativa.
   */
  favorita: boolean;
  /** O registro original da Fonte. Ver o agregado Conteudo Bruto no modelo. */
  bruto: string;
}

export interface CorrespondenciaDoMaterial {
  alternativo: string;
  canonico: string;
}

/**
 * O que o leitor DESCARTOU, por motivo — porque o material se contradiz.
 *
 * Nao e politica de importacao: e fato sobre o arquivo. Linha cuja Conversa nao
 * existe no proprio material nao oferece decisao a jusante; a unica acao
 * possivel e recusar, e encaminha-la ao importador seria cerimonia — pior, o
 * caso real e `ZCHATSESSION` NULO, entao nao ha sequer identificador a repassar
 * sem fazer o tipo mentir.
 *
 * Mensagens e eventos ficam SEPARADOS: sao populacoes diferentes do material, e
 * somar os dois esconderia qual esta com defeito.
 */
export interface DescartesDoMaterial {
  mensagens: Record<string, number>;
  eventos: Record<string, number>;
}

export interface Material {
  conversas: ConversaDoMaterial[];
  /**
   * Preguicoso de proposito: as Mensagens saem uma a uma, e o material NUNCA e
   * materializado inteiro. Ver `lerMensagens` para a medicao que decidiu isso.
   *
   * Quem precisar de array pede explicitamente — `[...material.mensagens]` — e
   * assume o custo no proprio codigo, em vez de todo consumidor pagar por ele.
   */
  mensagens: Iterable<MensagemDoMaterial>;
  /** Eventos administrativos DECLARADOS. Nunca derivados de retrato. */
  eventos: EventoDoMaterial[];
  /**
   * O que foi descartado na leitura, por motivo.
   *
   * O objeto e VIVO: `lerMaterial` devolve antes de o gerador de Mensagens
   * rodar, entao os descartes de Mensagem so tem valor DEPOIS de o iterador ser
   * consumido. Ler antes de iterar devolve o que se sabia entao — que e zero, e
   * nao uma afirmacao de que nada foi descartado. Os de evento sao apurados na
   * leitura e ja estao prontos no retorno.
   */
  descartes: DescartesDoMaterial;
  /**
   * Linhas que o material repete pelo MESMO identificador externo.
   *
   * Elas colapsam na restricao de unicidade do Acervo e sao reportadas como "ja
   * existentes" — e quem le conclui que ja estavam no acervo, quando eram
   * repeticoes do proprio arquivo. Nao ha perda; ha relatorio enganoso.
   *
   * Medido por CONSULTA, nunca retendo identificadores: 455 repeticoes num
   * material real de 1.018.587 linhas, em 256 ms, por indice coberto e com zero
   * memoria no processo. Reter 1,2 milhao de ids para descobrir o mesmo numero
   * contrariaria a decisao de memoria do ciclo 12.
   */
  linhasRepetidasNoMaterial: number;
  /**
   * Pares de endereco que a MESMA linha do material declara.
   *
   * A tabela de sessoes guarda DUAS colunas de endereco, e ate 02/09/2026 o
   * adaptador lia so uma. Medido no material real da conta pessoal: 4.882
   * linhas com o telefone numa coluna e a forma alternativa na outra, mais 232
   * na direcao inversa. Sem ler o par, a importacao criava 18.653
   * Identificadores na forma alternativa — identidades separadas de gente que
   * ja estava no acervo pelo telefone.
   *
   * O canonico e SEMPRE o telefone: e a forma que o catalogo e as Pessoas
   * usam, e traduzir para ela e o que faz a convergencia acontecer.
   */
  correspondencias: CorrespondenciaDoMaterial[];
  /**
   * Solta o ChatStorage. Obrigatorio: o iterador de `mensagens` le do arquivo
   * enquanto corre, entao o handle sobrevive ao retorno de `lerMaterial`.
   */
  fechar(): void;
}

/** Vazio conta como ausente — a Fonte usa '' e null para a mesma coisa. */
function naoVazio(v: string | null): string | null {
  return v === null || v === '' ? null : v;
}

function acharChatStorage(raizDoBackup: string, dominio: string): string {
  const manifesto = join(raizDoBackup, 'Manifest.db');
  if (!existsSync(manifesto)) {
    throw new Error(
      `Backup sem Manifest.db em ${raizDoBackup}. Nao parece um backup de dispositivo.`,
    );
  }

  const db = new Database(manifesto, { readonly: true });
  try {
    const linha = db
      .prepare("SELECT fileID FROM Files WHERE domain = ? AND relativePath = 'ChatStorage.sqlite'")
      .get(dominio) as { fileID: string } | undefined;

    if (linha === undefined) {
      throw new Error(
        `ChatStorage.sqlite nao encontrado no backup ${raizDoBackup} para o dominio ${dominio}.`,
      );
    }

    const caminho = join(raizDoBackup, linha.fileID.slice(0, 2), linha.fileID);
    if (!existsSync(caminho)) {
      throw new Error(`ChatStorage.sqlite indexado mas ausente do backup: ${caminho}`);
    }
    return caminho;
  } finally {
    db.close();
  }
}

export function lerMaterial(
  raizDoBackup: string,
  dominio: string = dominioDaConta(CONTA_PADRAO),
): Material {
  const db = new Database(acharChatStorage(raizDoBackup, dominio), { readonly: true });
  try {
    const conversasBrutas = db
      .prepare(
        // `SELECT *` de proposito: o Conteudo Bruto guarda a linha INTEIRA, e
        // enumerar colunas aqui seria escolher hoje o que sera util depois —
        // que e exatamente o erro que este campo existe para nao cometer.
        `SELECT * FROM ZWACHATSESSION WHERE ZCONTACTJID IS NOT NULL`,
      )
      .all() as Array<
      LinhaCrua & {
        Z_PK: number;
        ZCONTACTJID: string;
        // Ja vinha no `SELECT *`; o que faltava era ler.
        ZCONTACTIDENTIFIER: string | null;
        ZPARTNERNAME: string | null;
        ZSESSIONTYPE: number | null;
      }
    >;

    // O que o material contradiz. Declarado aqui, ANTES dos lacos, porque o
    // gerador de Mensagens fecha sobre ele e continua escrevendo depois de
    // `lerMaterial` ter retornado.
    const descartes: DescartesDoMaterial = { mensagens: {}, eventos: {} };
    const contagem = db
      .prepare(
        `SELECT COUNT(*) AS linhas, COUNT(DISTINCT ZSTANZAID) AS distintos
           FROM ZWAMESSAGE WHERE ZSTANZAID IS NOT NULL`,
      )
      .get() as { linhas: number; distintos: number };
    const repetidas = contagem.linhas - contagem.distintos;
    const contar = (onde: Record<string, number>, motivo: string): void => {
      onde[motivo] = (onde[motivo] ?? 0) + 1;
    };

    // O par de enderecos que a propria linha declara. So entra quando as duas
    // colunas estao preenchidas e sao formas DIFERENTES — mesma forma nos dois
    // lados nao e correspondencia, e telefone nos dois seria ruido.
    const correspondencias: CorrespondenciaDoMaterial[] = [];
    for (const c of conversasBrutas) {
      // `undefined` e nao `null`: material antigo — e a fixture de teste — nao
      // tem a coluna, e o driver devolve ausente, nao nulo. Tratar so `null`
      // deixava o codigo estourar em `endsWith` sobre indefinido.
      const outro = c.ZCONTACTIDENTIFIER;
      if (outro === null || outro === undefined || outro === c.ZCONTACTJID) continue;
      if (typeof c.ZCONTACTJID !== 'string') continue;
      const jidEhTelefone = c.ZCONTACTJID.endsWith('@s.whatsapp.net');
      const outroEhTelefone = outro.endsWith('@s.whatsapp.net');
      if (jidEhTelefone === outroEhTelefone) continue;
      correspondencias.push(
        jidEhTelefone
          ? { alternativo: outro, canonico: c.ZCONTACTJID }
          : { alternativo: c.ZCONTACTJID, canonico: outro },
      );
    }

    const enderecoPorConversa = new Map(conversasBrutas.map((c) => [c.Z_PK, c.ZCONTACTJID]));

    const membrosBrutos = db
      .prepare(
        `SELECT * FROM ZWAGROUPMEMBER WHERE ZMEMBERJID IS NOT NULL`,
      )
      .all() as Array<
      LinhaCrua & {
        Z_PK: number;
        ZMEMBERJID: string;
        ZCHATSESSION: number | null;
        ZISACTIVE: number | null;
        ZFIRSTNAME: string | null;
        ZCONTACTNAME: string | null;
      }
    >;

    const membros = new Map(membrosBrutos.map((m) => [m.Z_PK, m.ZMEMBERJID]));

    const rosterPorConversa = new Map<number, ParticipanteDoMaterial[]>();
    for (const m of membrosBrutos) {
      if (m.ZCHATSESSION === null) continue;
      const atual = rosterPorConversa.get(m.ZCHATSESSION) ?? [];
      // DUAS colunas de nome, e a COMPLETA vence. Medido em 13/09/2026 contra o
      // material real: ZCONTACTNAME comeca com ZFIRSTNAME em 509 de 510 casos em
      // que as duas existem e diferem, e e mais longa em 510 de 510 — sao
      // primeiro nome e nome completo. Preferir a completa soma 722 membros que
      // a outra nao alcanca, e entrega o nome inteiro onde ele existe.
      // VAZIO CONTA COMO AUSENTE, e `??` nao serve aqui: ele so cai para o
      // segundo quando o primeiro e nulo, e o material real grava STRING VAZIA
      // na maioria das linhas da coluna do nome completo. Com `??`, elas
      // devolviam '' e o membro ficava sem nome.
      //
      // Medido em 13/09/2026 contra o material de 05/09, depois de a
      // reimportacao entregar so 1.071 nomes onde havia 9.119 esperados.
      const nomeDoMembro = naoVazio(m.ZCONTACTNAME) ?? naoVazio(m.ZFIRSTNAME);
      atual.push({
        endereco: m.ZMEMBERJID,
        ativaNaFonte: m.ZISACTIVE === 1,
        bruto: serializarLinha(m),
        ...(nomeDoMembro !== null && nomeDoMembro !== undefined && nomeDoMembro !== ''
          ? { nome: nomeDoMembro }
          : {}),
      });
      rosterPorConversa.set(m.ZCHATSESSION, atual);
    }

    const conversas: ConversaDoMaterial[] = conversasBrutas.map((c) => ({
      idExterno: c.ZCONTACTJID,
      nome: c.ZPARTNERNAME,
      coletiva: (c.ZSESSIONTYPE ?? 0) !== 0,
      participantesConhecidos: rosterPorConversa.get(c.Z_PK) ?? [],
      bruto: serializarLinha(c),
    }));

    // O item de midia entra por consulta PROPRIA, e nao por `mi.*` no JOIN: as
    // duas tabelas compartilham Z_PK, Z_ENT e Z_OPT, e o driver devolve so a
    // ultima coluna homonima — o bruto do Anexo sairia com o Z_PK da MENSAGEM.
    //
    // A consulta e por Z_PK, uma por Anexo, em vez do mapa inteiro em memoria:
    // no material real sao 437 mil itens de midia, e carrega-los todos custava
    // memoria proporcional ao acervo antes de a primeira Mensagem sair. O
    // statement e compilado UMA vez e reusado — ver `Acervo.preparar` para a
    // razao de nunca compilar por chamada.
    const midiaPorChave = db.prepare(`SELECT * FROM ZWAMEDIAITEM WHERE Z_PK = ?`);

    // Os Eventos administrativos saem numa passada PROPRIA e filtrada. Eles
    // precisam estar completos antes de a importacao comecar a escrever
    // Mensagem — a ordem e do importador —, e sao poucos: 16.684 no material
    // real, contra 1,23 milhao de Mensagens. Filtrar no SQL e o que torna essa
    // passada barata; as tres condicoes sao as mesmas que o laco aplicava.
    const eventos: EventoDoMaterial[] = [];
    for (const r of db
      .prepare(
        `SELECT ZSTANZAID, ZCHATSESSION, ZGROUPMEMBER, ZGROUPEVENTTYPE, ZMESSAGEDATE
           FROM ZWAMESSAGE
          WHERE ZSTANZAID IS NOT NULL
            AND ZMESSAGETYPE = ?
            AND ZGROUPMEMBER IS NOT NULL
            AND ZMESSAGEDATE IS NOT NULL
          ORDER BY Z_PK`,
      )
      .all(TIPO_ADMINISTRATIVO) as Array<{
      ZSTANZAID: string;
      ZCHATSESSION: number;
      ZGROUPMEMBER: number;
      ZGROUPEVENTTYPE: number | null;
      ZMESSAGEDATE: number;
    }>) {
      const conversaIdExterno = enderecoPorConversa.get(r.ZCHATSESSION);
      if (conversaIdExterno === undefined) {
        contar(descartes.eventos, 'conversa ausente no material');
        continue;
      }
      const membroExterno = membros.get(r.ZGROUPMEMBER);
      if (membroExterno === undefined) {
        contar(descartes.eventos, 'membro ausente no material');
        continue;
      }
      eventos.push({
        idExterno: r.ZSTANZAID,
        conversaIdExterno,
        membroExterno,
        codigo: r.ZGROUPEVENTTYPE ?? 0,
        ocorridoEm: Math.floor((r.ZMESSAGEDATE + EPOCA_CORE_DATA) * 1000),
      });
    }

    const daMensagem = db.prepare(
      `SELECT m.*, mi.ZMEDIALOCALPATH, mi.ZFILESIZE
         FROM ZWAMESSAGE m
         LEFT JOIN ZWAMEDIAITEM mi ON mi.Z_PK = m.ZMEDIAITEM
        WHERE m.ZSTANZAID IS NOT NULL
        ORDER BY m.Z_PK`,
    );

    /**
     * As Mensagens saem por iterador, uma a uma, e NUNCA como array.
     *
     * Medido em 06/09/2026: materializa-las custava 2,7 GB de heap no material
     * real, antes de a primeira escrita acontecer. O produto e instalado por
     * terceiros, em maquinas que podem ter menos memoria que a Mensagem mais
     * gorda do acervo de quem instala.
     *
     * O gerador segura o ChatStorage aberto enquanto corre — por isso o
     * Material tem `fechar()`, e por isso ele nao fecha sozinho no fim do laco:
     * quem parar a iteracao no meio tambem precisa soltar o arquivo.
     */
    function* lerMensagens(): Generator<MensagemDoMaterial> {
      for (const bruta of daMensagem.iterate()) {
        const r = bruta as LinhaCrua & {
          ZSTANZAID: string;
          ZCHATSESSION: number;
          ZFROMJID: string | null;
          ZGROUPMEMBER: number | null;
          ZISFROMME: number;
          ZMESSAGETYPE: number | null;
          ZGROUPEVENTTYPE: number | null;
          ZMESSAGEDATE: number | null;
          ZMEDIAITEM: number | null;
          ZTEXT: string | null;
          ZMEDIALOCALPATH: string | null;
          ZFILESIZE: number | null;
          /** Ausente em material antigo, que nao tinha a coluna. */
          ZSTARRED: number | null;
        };
        const conversaIdExterno = enderecoPorConversa.get(r.ZCHATSESSION);
        if (conversaIdExterno === undefined) {
          contar(descartes.mensagens, 'conversa ausente no material');
          continue;
        }

        const daPropriaPessoa = r.ZISFROMME === 1;

        // Em conversa coletiva, ZFROMJID traz o endereço do GRUPO. O remetente
        // real vem de ZWAGROUPMEMBER pela FK ZGROUPMEMBER.
        let autorExterno: string | undefined;
        if (!daPropriaPessoa) {
          const doMembro = r.ZGROUPMEMBER === null ? undefined : membros.get(r.ZGROUPMEMBER);
          autorExterno = doMembro ?? r.ZFROMJID ?? undefined;
        }

        const tipo = TIPO_POR_CODIGO[r.ZMESSAGETYPE ?? 0] ?? 'other';
        const temAnexo = r.ZMEDIALOCALPATH !== null || (tipo !== 'text' && tipo !== 'other');

        const mensagem: MensagemDoMaterial = {
          idExterno: r.ZSTANZAID,
          conversaIdExterno,
          texto: r.ZTEXT,
          // Igualdade explicita com 1, e a medicao diz que hoje ela NAO
          // discrimina: nos dois materiais reais a coluna so assume NULL, 0 e
          // 1 — 1.218.439 / 16.180 / 57 no de setembro. Trocar por coercao
          // passa em toda a suite, e o mutante que tentou isso sobreviveu por
          // EQUIVALENCIA, nao por teste faltando. Fica explicita pelo que
          // protege se a Fonte passar a usar outro valor, e isto esta escrito
          // para ninguem gastar um teste tentando matar o mutante.
          //
          // Material antigo sem a coluna entrega `undefined`, que tambem cai
          // no falso — e e o valor certo.
          favorita: r.ZSTARRED === 1,
          daPropriaPessoa,
          // As duas colunas do JOIN de midia saem do bruto da MENSAGEM: elas nao
          // sao dela, e o bruto do Anexo ja as carrega inteiras.
          bruto: serializarLinha(semColunasDeMidia(r)),
        };
        // Ausência atravessa como ausência. Ver #606.
        if (r.ZMESSAGEDATE !== null) {
          mensagem.ocorridaEm = Math.floor((r.ZMESSAGEDATE + EPOCA_CORE_DATA) * 1000);
        }
        if (autorExterno !== undefined) mensagem.autorExterno = autorExterno;
        if (temAnexo) {
          const daMidia =
            r.ZMEDIAITEM === null
              ? undefined
              : (midiaPorChave.get(r.ZMEDIAITEM) as LinhaCrua | undefined);
          mensagem.anexo = {
            tipo,
            caminhoNaOrigem: r.ZMEDIALOCALPATH,
            ...(r.ZFILESIZE !== null && r.ZFILESIZE > 0 ? { tamanhoDeclarado: r.ZFILESIZE } : {}),
            ...(daMidia === undefined ? {} : { bruto: serializarLinha(daMidia) }),
          };
        }

        yield mensagem;
      }
    }

    return {
      conversas,
      mensagens: { [Symbol.iterator]: lerMensagens },
      eventos,
      // O MESMO objeto que o gerador muta, nao uma copia: copiar aqui
      // congelaria os descartes de Mensagem em zero, porque este `return`
      // acontece antes de `lerMensagens` rodar uma unica vez.
      descartes,
      linhasRepetidasNoMaterial: repetidas,
      correspondencias,
      fechar: () => db.close(),
    };
  } catch (erro) {
    db.close();
    throw erro;
  }
}

/**
 * O backup guarda todas as Conversas dentro de um arquivo so, entao a
 * impressao e o nome e o tamanho DESSE arquivo — obtidos por `statSync`, sem
 * abrir o banco. Duas contas do mesmo backup vivem em dominios distintos e
 * portanto em arquivos distintos: as impressoes saem diferentes sozinhas.
 */
export function impressaoDoMaterial(
  raizDoBackup: string,
  dominio: string = dominioDaConta(CONTA_PADRAO),
): string {
  const alvo = acharChatStorage(raizDoBackup, dominio);
  return impressaoDeEntradas([
    { relativo: relative(raizDoBackup, alvo), tamanho: statSync(alvo).size },
  ]);
}

/**
 * Indice dos arquivos de midia do backup: caminho relativo -> caminho absoluto.
 *
 * Monta em UMA passagem. Abrir o `Manifest.db` por Anexo custaria 6.332
 * aberturas no material real de aceite, medido em 28/08/2026.
 *
 * So entra o que EXISTE em disco: o material indexa mais do que carrega, e
 * quem chama precisa distinguir "declarado e ausente" de "nunca declarado".
 */
export function indiceDeArquivos(raizDoBackup: string, dominio: string): Map<string, string> {
  const manifesto = join(raizDoBackup, 'Manifest.db');
  if (!existsSync(manifesto)) return new Map();

  const db = new Database(manifesto, { readonly: true });
  try {
    const linhas = db
      .prepare(
        `SELECT fileID, relativePath FROM Files
          WHERE domain = ? AND relativePath LIKE 'Message/Media/%'`,
      )
      .all(dominio) as Array<{ fileID: string; relativePath: string }>;

    const indice = new Map<string, string>();
    for (const l of linhas) {
      const alvo = join(raizDoBackup, l.fileID.slice(0, 2), l.fileID);
      if (existsSync(alvo)) indice.set(l.relativePath, alvo);
    }
    return indice;
  } finally {
    db.close();
  }
}
