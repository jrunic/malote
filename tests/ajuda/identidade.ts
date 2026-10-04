import { createServer } from 'node:http';
import { cenario } from './acervo.js';
import { CFG_WHATSAPP } from './configuracao.js';
import { abrirAcervoSomenteLeitura, type Acervo } from '../../src/nucleo/acervo.js';
import { criarServidor } from '../../src/rede/servidor.js';
import { emitirChaveDeAcesso } from '../../src/registro/chave-de-acesso.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
} from '../../src/nucleo/escrita.js';
import { criarPessoa, registrarNome, vincularIdentificador } from '../../src/nucleo/identidade.js';
import { aprenderCorrespondencia } from '../../src/nucleo/correspondencia.js';
import { PRECEDENCIA_PADRAO, type PrecedenciaDeNome } from '../../src/registro/precedencia-de-nome.js';

export const PRECEDENCIA: PrecedenciaDeNome = { porOrigem: { ...PRECEDENCIA_PADRAO }, catalogoPreferido: null };

export const ANA = '5565111111111@s.whatsapp.net';
export const BRUNO = '5565222222222@s.whatsapp.net';
/** Forma alternativa de Bruno que SO existe como correspondencia, sem linha de Identificador. */
export const BRUNO_LID = '222222@lid';
export const CARLA = '5565333333333@s.whatsapp.net';
/** Forma alternativa de Carla que existe TAMBEM como linha (heranca de antes de a correspondencia ser conhecida). */
export const CARLA_LID = '333333@lid';
export const DANI = '5565444444444@s.whatsapp.net';
export const EDU = '5565555555555@s.whatsapp.net';
export const SOLTO_LID = '999999@lid';

export const BASE = Date.parse('2026-06-01T12:00:00Z');
export const minuto = (n: number): number => BASE + n * 60_000;

export interface Sementes {
  ana: string;
  bruno: string;
  carla: string;
  carlaLid: string;
  dani: string;
  edu: string;
  solto: string;
  pessoaDeAna: string;
  diretaDeAna: string;
  diretaDeBruno: string;
  diretaDeEdu: string;
  grupo: string;
}

/**
 * Identidade com todos os casos que o ciclo 30 precisa distinguir:
 * - Ana: com Pessoa, nome proprio de plataforma e nome de catalogo NA Pessoa.
 * - Bruno: sem Pessoa, dois nomes de origens diferentes (a precedencia decide), e a forma
 *   alternativa so como correspondencia.
 * - Carla: canonica com nome, e a alternativa tambem gravada como linha.
 * - Dani: so AUTORA (escreve no grupo, nao consta na participacao).
 * - Edu: so PARTICIPANTE (consta no grupo, nunca escreveu), sem nome.
 * - Solto: Identificador sem Pessoa, sem nome, sem nada.
 */
export function semearIdentidade(acervo: Acervo): Sementes {
  const id = (valor: string): string => registrarIdentificador(acervo, { fonte: 'whatsapp', valor }).id;
  const ana = id(ANA);
  const bruno = id(BRUNO);
  const carla = id(CARLA);
  const carlaLid = id(CARLA_LID);
  const dani = id(DANI);
  const edu = id(EDU);
  const solto = id(SOLTO_LID);

  const pessoaDeAna = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: ana, pessoaId: pessoaDeAna, procedencia: 'material' });
  registrarNome(acervo, { identificadorId: ana, origem: 'whatsapp', nome: 'Ana WhatsApp', autoridade: 'terceiro' });
  registrarNome(acervo, { pessoaId: pessoaDeAna, origem: 'contatos', nome: 'Ana Catalogo', autoridade: 'titular' });

  registrarNome(acervo, { identificadorId: bruno, origem: 'whatsapp', nome: 'Bruno Silva', autoridade: 'terceiro' });
  registrarNome(acervo, { identificadorId: bruno, origem: 'contatos', nome: 'Bruno Contato', autoridade: 'titular' });
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: BRUNO_LID, canonico: BRUNO });

  registrarNome(acervo, { identificadorId: carla, origem: 'whatsapp', nome: 'Carla Souza', autoridade: 'terceiro' });
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: CARLA_LID, canonico: CARLA });

  registrarNome(acervo, { identificadorId: dani, origem: 'whatsapp', nome: 'Dani', autoridade: 'terceiro' });

  const direta = (idExterno: string): string =>
    registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno,
      coletiva: false,
      configuracao: CFG_WHATSAPP,
      bruto: '{}',
    });
  const diretaDeAna = direta(ANA);
  const diretaDeBruno = direta(BRUNO);
  const diretaDeEdu = direta(EDU);
  const grupo = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'grupo-1@g.us',
    coletiva: true,
    metadadosDeColetiva: { assunto: 'Grupo da Familia' },
    bruto: '{}',
  });

  for (const identificadorId of [ana, bruno, edu]) {
    registrarParticipacao(acervo, { conversaId: grupo, identificadorId, observadaEm: new Date(BASE).toISOString() });
  }

  let n = 0;
  const msg = (conversaId: string, autorId: string, quando: number): void => {
    n += 1;
    registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno: `m-${n}`,
      autorId,
      conteudo: `texto ${n}`,
      ocorridaEm: quando,
      agora: Date.now(),
      direcao: 'recebida',
    });
  };
  msg(diretaDeBruno, bruno, minuto(1));
  msg(diretaDeBruno, bruno, minuto(2));
  msg(diretaDeBruno, bruno, minuto(3));
  msg(grupo, bruno, minuto(10));
  msg(grupo, dani, minuto(11));
  msg(grupo, dani, minuto(12));
  msg(grupo, ana, minuto(13));
  msg(grupo, ana, minuto(14));
  msg(diretaDeAna, ana, minuto(20));

  return { ana, bruno, carla, carlaLid, dani, edu, solto, pessoaDeAna, diretaDeAna, diretaDeBruno, diretaDeEdu, grupo };
}

/** Acervo semeado, pronto para teste de nucleo. */
export function acervoDeIdentidade(): { acervo: Acervo; s: Sementes; limpar: () => void } {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  return { acervo, s: semearIdentidade(acervo), limpar: c.limpar };
}

async function portaLivre(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return porta;
}

export interface CenaDeIdentidade {
  raiz: string;
  url: string;
  inquilinoId: string;
  s: Sementes;
  chave: { id: string; valor: string };
  /** Chave de OUTRO Inquilino, cujo Acervo tem o MESMO valor de Identificador com outro nome. */
  chaveDoOutro: { id: string; valor: string };
  pedir: (caminho: string, chave?: string) => Promise<{ status: number; corpo: string }>;
  operacoes: () => number;
  encerrar: () => void;
}

/** Servidor real sobre um Acervo com a identidade semeada e um segundo Inquilino com o mesmo valor. */
export async function subirCenaDeIdentidade<T = undefined>(
  opcoes: {
    /** Sementes a mais no Acervo do Titular, antes de ele ser fechado. */
    semearMais?: (acervo: Acervo, s: Sementes) => T;
    /** Sementes no Acervo do OUTRO Inquilino (o que tem o mesmo valor de Identificador). */
    semearNoOutro?: (acervo: Acervo, intruso: string) => void;
  } = {},
): Promise<CenaDeIdentidade & { extra: T }> {
  const c = cenario();
  const { id: inquilinoId, acervo } = c.novoInquilino('Titular');
  const s = semearIdentidade(acervo);
  const extra = opcoes.semearMais?.(acervo, s) as T;
  acervo.fechar();
  const { id: outroId, acervo: acervoDoOutro } = c.novoInquilino('Outro');
  const intruso = registrarIdentificador(acervoDoOutro, { fonte: 'whatsapp', valor: BRUNO }).id;
  registrarNome(acervoDoOutro, { identificadorId: intruso, origem: 'whatsapp', nome: 'Intruso', autoridade: 'terceiro' });
  opcoes.semearNoOutro?.(acervoDoOutro, intruso);
  acervoDoOutro.fechar();
  const chave = emitirChaveDeAcesso(c.registro, inquilinoId);
  const chaveDoOutro = emitirChaveDeAcesso(c.registro, outroId);

  const porta = await portaLivre();
  const srv = criarServidor({ dados: c.raiz, porta });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
  const url = `http://127.0.0.1:${porta}`;
  return {
    raiz: c.raiz,
    url,
    inquilinoId,
    s,
    extra,
    chave: { id: chave.id, valor: chave.valor },
    chaveDoOutro: { id: chaveDoOutro.id, valor: chaveDoOutro.valor },
    pedir: async (caminho, k) => {
      const r = await fetch(`${url}${caminho}`, { headers: k ? { authorization: `Bearer ${k}` } : {} });
      return { status: r.status, corpo: await r.text() };
    },
    operacoes: () => {
      const a = abrirAcervoSomenteLeitura(`${c.raiz}/acervos`, inquilinoId);
      try {
        return (a.db.prepare('SELECT COUNT(*) AS n FROM operacoes').get() as { n: number }).n;
      } finally {
        a.fechar();
      }
    },
    encerrar: () => {
      srv.closeAllConnections();
      srv.close();
      c.limpar();
    },
  };
}
