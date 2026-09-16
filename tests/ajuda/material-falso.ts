import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Segundos entre 1970-01-01 e 2001-01-01 — o instante Core Data do iOS. */
export const EPOCA_CORE_DATA = 978_307_200;

export function paraCoreData(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000) - EPOCA_CORE_DATA;
}

export interface MensagemFalsa {
  stanzaId: string;
  /**
   * NULO reproduz o defeito real: `ZCHATSESSION` ausente na origem. Medido em
   * 07/09/2026, e a causa das 99 Mensagens que o leitor descartava sem contar —
   * 96 num material real e 3 no outro. Sem poder produzir nulo aqui, a guarda
   * que as conta nao tem como ser testada.
   */
  chatSessionPk: number | null;
  texto: string | null;
  /** Nulo reproduz o defeito real: ZMESSAGEDATE ausente na origem. */
  dataCoreData: number | null;
  daPropriaPessoa?: boolean;
  tipo?: number;
  /**
   * ZSTARRED — a Mensagem que o dono da conta favoritou.
   *
   * Medido em 13/09/2026 nos dois materiais reais: 57 Mensagens em 6 Conversas
   * no material de setembro, 90 em 7 no de abril. Favorito MUDA entre dois
   * materiais, entao numero antigo e linha de base, nunca expectativa.
   */
  favorita?: boolean;
  /** ZGROUPEVENTTYPE. So e lido quando `tipo` e o administrativo. */
  codigoDeEvento?: number;
  grupoMembroPk?: number;
  deJid?: string;
  caminhoDeMidia?: string;
  /** Tamanho que o material DECLARA, em bytes — o ZFILESIZE real. */
  tamanhoDeMidia?: number;
  /**
   * Conteudo do arquivo de midia. Quando presente, o arquivo e gravado no
   * caminho por hash E indexado no Manifest — o material CARREGA a midia.
   * Quando ausente, so o caminho e declarado: e o caso medido dos 24% de
   * Anexos que o material declara e nao entrega.
   */
  conteudoDeMidia?: string;
  /** ZLATITUDE do item de midia. NAO modelado — testemunha do Conteudo Bruto. */
  latitude?: number;
  /** ZPUSHNAME. NAO modelado — testemunha do Conteudo Bruto. */
  nomeTransmitido?: string;
}

export interface ConversaFalsa {
  pk: number;
  endereco: string;
  nome: string | null;
  /** ZARCHIVED. NAO modelado — testemunha do Conteudo Bruto. */
  arquivada?: boolean;
  /** 0 = direta; qualquer outro = coletiva, como o ZSESSIONTYPE real. */
  tipoDeSessao: number;
}

export interface MembroFalso {
  pk: number;
  endereco: string;
  /** A qual ZWACHATSESSION o membro pertence. */
  conversaPk?: number;
  /**
   * O que a Fonte declara sobre a atividade do membro. O backup real traz a
   * coluna sempre; omitir aqui vale `ativo`, que e o caso comum.
   */
  ativo?: boolean;
  /** ZISADMIN. NAO modelado — testemunha do Conteudo Bruto. */
  administrador?: boolean;
  /** ZFIRSTNAME — o primeiro nome que o dono da conta cadastrou para o membro. */
  nome?: string;
  /**
   * ZCONTACTNAME — o nome completo.
   *
   * Medido em 13/09/2026 contra o material real: quando as duas colunas existem
   * e diferem, esta COMECA com a outra em 509 de 510 casos e e mais longa em
   * 510 de 510. Sao primeiro nome e nome completo, e o leitor prefere esta.
   */
  nomeCompleto?: string;
}

/**
 * Uma conta dentro do MESMO backup: seu dominio e seu conteudo.
 *
 * Backup real de aparelho carrega os dois aplicativos do WhatsApp em dominios
 * distintos, num Manifest.db so — medido em 28/08/2026. Testar com dois
 * backups separados exercitaria o mapa conta->dominio, nao o caso real.
 */
export interface ContaFalsa {
  dominio: string;
  conversas: ConversaFalsa[];
  mensagens: MensagemFalsa[];
  membros?: MembroFalso[];
}

export interface BackupFalso {
  raiz: string;
  limpar: () => void;
}

/**
 * Monta um backup de dispositivo iOS sintético: Manifest.db apontando para o
 * ChatStorage.sqlite, guardado no caminho por hash que o formato real usa.
 *
 * Todo dado é inventado. Nenhum nome, número ou apelido de pessoa real entra
 * aqui — fixture de repositório público é dado sintético, sempre.
 */
export function backupFalso(conteudo: {
  conversas: ConversaFalsa[];
  mensagens: MensagemFalsa[];
  membros?: MembroFalso[];
  dominio?: string;
  /** Contas adicionais no MESMO backup, cada uma no seu dominio. */
  contas?: ContaFalsa[];
}): BackupFalso {
  const raiz = mkdtempSync(join(tmpdir(), 'malote-backup-'));

  const manifesto = new Database(join(raiz, 'Manifest.db'));
  manifesto.exec(`
    CREATE TABLE Files (
      fileID       TEXT PRIMARY KEY,
      domain       TEXT NOT NULL,
      relativePath TEXT NOT NULL
    );
  `);
  const indexar = manifesto.prepare(
    'INSERT INTO Files (fileID, domain, relativePath) VALUES (?, ?, ?)',
  );

  /** Grava um ChatStorage.sqlite no caminho por hash que o formato real usa. */
  function gravarConta(
    idDoArquivo: string,
    dominio: string,
    dados: { conversas: ConversaFalsa[]; mensagens: MensagemFalsa[]; membros?: MembroFalso[] },
  ): void {
    indexar.run(idDoArquivo, dominio, 'ChatStorage.sqlite');

    // Midia que o material CARREGA: arquivo no caminho por hash, indexado com
    // o mesmo `Message/<caminho declarado>` que o backup real usa.
    let semente = 0;
    for (const m of dados.mensagens) {
      if (m.caminhoDeMidia === undefined || m.conteudoDeMidia === undefined) continue;
      semente += 1;
      const idDaMidia = `${idDoArquivo.slice(0, 34)}${String(semente).padStart(6, '0')}`;
      indexar.run(idDaMidia, dominio, `Message/${m.caminhoDeMidia}`);
      const pastaDaMidia = join(raiz, idDaMidia.slice(0, 2));
      mkdirSync(pastaDaMidia, { recursive: true });
      writeFileSync(join(pastaDaMidia, idDaMidia), m.conteudoDeMidia);
    }
    const pasta = join(raiz, idDoArquivo.slice(0, 2));
    mkdirSync(pasta, { recursive: true });

    const chat = new Database(join(pasta, idDoArquivo));
    chat.exec(`
      -- As colunas ZARCHIVED, ZISADMIN, ZLATITUDE e ZPUSHNAME existem aqui de
      -- proposito e o adaptador NAO as modela. Sao as testemunhas do Conteudo
      -- Bruto: se o bruto nao as carregar, ele nao esta preservando o registro
      -- original, e nenhuma outra assercao mostraria isso. Todas espelham
      -- colunas reais do backup — ZPUSHNAME aparece em 715.946 Mensagens do
      -- material medido em 31/08/2026.
      CREATE TABLE ZWACHATSESSION (
        Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT, ZPARTNERNAME TEXT, ZSESSIONTYPE INTEGER,
        ZARCHIVED INTEGER
      );
      CREATE TABLE ZWAGROUPMEMBER (
        Z_PK INTEGER PRIMARY KEY, ZMEMBERJID TEXT, ZCHATSESSION INTEGER, ZISACTIVE INTEGER,
        ZISADMIN INTEGER, ZFIRSTNAME TEXT, ZCONTACTNAME TEXT
      );
      CREATE TABLE ZWAMEDIAITEM (
        Z_PK INTEGER PRIMARY KEY, ZMEDIALOCALPATH TEXT, ZFILESIZE INTEGER, ZLATITUDE REAL
      );
      CREATE TABLE ZWAMESSAGE (
        Z_PK INTEGER PRIMARY KEY, ZSTANZAID TEXT, ZCHATSESSION INTEGER, ZFROMJID TEXT,
        ZTOJID TEXT, ZGROUPMEMBER INTEGER, ZISFROMME INTEGER, ZMESSAGETYPE INTEGER,
        ZGROUPEVENTTYPE INTEGER, ZMESSAGEDATE REAL, ZTEXT TEXT, ZMEDIAITEM INTEGER,
        ZPUSHNAME TEXT, ZSTARRED INTEGER
      );
    `);

    const porConversa = chat.prepare(
      `INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME, ZSESSIONTYPE, ZARCHIVED)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const c of dados.conversas)
      porConversa.run(c.pk, c.endereco, c.nome, c.tipoDeSessao, c.arquivada === true ? 1 : 0);

    const porMembro = chat.prepare(
      `INSERT INTO ZWAGROUPMEMBER
         (Z_PK, ZMEMBERJID, ZCHATSESSION, ZISACTIVE, ZISADMIN, ZFIRSTNAME, ZCONTACTNAME)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of dados.membros ?? [])
      porMembro.run(
        m.pk,
        m.endereco,
        m.conversaPk ?? null,
        m.ativo === false ? 0 : 1,
        m.administrador === true ? 1 : 0,
        m.nome ?? null,
        m.nomeCompleto ?? null,
      );

    const porMidia = chat.prepare(
      `INSERT INTO ZWAMEDIAITEM (Z_PK, ZMEDIALOCALPATH, ZFILESIZE, ZLATITUDE)
       VALUES (?, ?, ?, ?)`,
    );
    const porMensagem = chat.prepare(
      `INSERT INTO ZWAMESSAGE
         (Z_PK, ZSTANZAID, ZCHATSESSION, ZFROMJID, ZTOJID, ZGROUPMEMBER,
          ZISFROMME, ZMESSAGETYPE, ZGROUPEVENTTYPE, ZMESSAGEDATE, ZTEXT, ZMEDIAITEM,
          ZPUSHNAME, ZSTARRED)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    let pk = 1;
    let pkDeMidia = 1;
    for (const m of dados.mensagens) {
      let idDeMidia: number | null = null;
      if (m.caminhoDeMidia !== undefined) {
        idDeMidia = pkDeMidia++;
        porMidia.run(idDeMidia, m.caminhoDeMidia, m.tamanhoDeMidia ?? null, m.latitude ?? null);
      }
      const conversa = dados.conversas.find((c) => c.pk === m.chatSessionPk);
      porMensagem.run(
        pk++,
        m.stanzaId,
        m.chatSessionPk,
        m.deJid ?? conversa?.endereco ?? null,
        conversa?.endereco ?? null,
        m.grupoMembroPk ?? null,
        m.daPropriaPessoa === true ? 1 : 0,
        m.tipo ?? 0,
        m.codigoDeEvento ?? null,
        m.dataCoreData,
        m.texto,
        idDeMidia,
        m.nomeTransmitido ?? null,
        // Escreve 0 no caso negativo. A Fonte usa AS DUAS formas — medido no
        // material de setembro: 1.218.439 nulos, 16.180 zeros e 57 uns —, e as
        // duas caem no falso. Escrever o zero e a escolha mais dura das duas:
        // fixture que grava ausente onde a Fonte grava valor foi como o campo
        // vazio do nome de membro passou despercebido ate 13/09/2026.
        m.favorita === true ? 1 : 0,
      );
    }
    chat.close();
  }

  gravarConta(
    'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    conteudo.dominio ?? 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared',
    conteudo,
  );

  // Cada conta extra tem fileID proprio; o indice e um so, como no backup real.
  let sufixo = 0;
  for (const conta of conteudo.contas ?? []) {
    sufixo += 1;
    gravarConta(`b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2${String(sufixo).padStart(2, '0')}`,
      conta.dominio, conta);
  }

  manifesto.close();

  writeFileSync(join(raiz, 'midia-de-exemplo.bin'), 'conteudo sintetico');

  return { raiz, limpar: () => rmSync(raiz, { recursive: true, force: true }) };
}
