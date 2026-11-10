import { createHash } from 'node:crypto';
import type { Acervo } from '../../src/nucleo/acervo.js';
import { aprenderCorrespondencia } from '../../src/nucleo/correspondencia.js';
import { registrarEdicao } from '../../src/nucleo/edicao.js';
import { registrarEnvio } from '../../src/nucleo/envio.js';
import { registrarAnexo, registrarConversa, registrarIdentificador, registrarMensagem, registrarParticipacao } from '../../src/nucleo/escrita.js';
import { registrarNome } from '../../src/nucleo/identidade.js';
import { marcarConversa } from '../../src/nucleo/marca-do-titular.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './configuracao.js';

/**
 * O Acervo sintetico da uniao das Conversas do contato (#1440): um caso por resposta do ensaio. Enderecos e numeros sao
 * ficticios. Usado pelos testes do Adaptador e da CLI e pelo autoteste da conferencia independente.
 */

export const AGORA = 1_790_000_000_000;

/** Mover: a opaca e a Conversa do numero (a mesma forma do par) na mesma Configuracao. */
export const OP_MOVER = '100000000000041@lid';
export const TEL_MOVER = '5565999990041@s.whatsapp.net';
/** Promover: so a opaca existe; o Identificador opaco tem nome e o do numero nao existe (a promovida perde o nome). */
export const OP_PROMOVER = '100000000000042@lid';
export const TEL_PROMOVER = '5565999990042@s.whatsapp.net';
export const TEL_PROMOVER_SEM9 = '556599990042@s.whatsapp.net';
/** Alvo ambiguo: as duas formas do numero existem como Conversa na mesma Configuracao. */
export const OP_AMBIGUO = '100000000000043@lid';
export const TEL_AMBIGUO_COM9 = '5565999990043@s.whatsapp.net';
export const TEL_AMBIGUO_SEM9 = '556599990043@s.whatsapp.net';
/** Duas opacas na mesma Configuracao para o mesmo numero. */
export const OP_DUAS_1 = '100000000000044@lid';
export const OP_DUAS_2 = '100000000000045@lid';
export const TEL_DUAS = '5565999990044@s.whatsapp.net';
/** A Conversa do numero so existe em OUTRA Configuracao: promove. */
export const OP_OUTRA_CFG = '100000000000046@lid';
export const TEL_OUTRA_CFG = '5565999990046@s.whatsapp.net';
/** A opaca ja vazia, com alvo, sem marca a levar: nada a fazer. */
export const OP_VAZIA = '100000000000047@lid';
export const TEL_VAZIA = '5565999990047@s.whatsapp.net';
/** Sem par: fora da uniao. */
export const OP_SEM_PAR = '100000000000048@lid';
/** Alvo achado so pela OUTRA forma do numero (o par aponta para a forma com o 9, a Conversa e a sem o 9). */
export const OP_OUTRA_FORMA = '100000000000049@lid';
export const TEL_OUTRA_FORMA_COM9 = '5565999990049@s.whatsapp.net';
export const TEL_OUTRA_FORMA_SEM9 = '556599990049@s.whatsapp.net';

export interface Montagem {
  conversa: Record<string, string>;
  outraCfg: string;
}

let seq = 0;

function mensagem(acervo: Acervo, conversaId: string, direcao: 'enviada' | 'recebida', autorId: string | undefined, quando: number, texto: string): string {
  seq += 1;
  return registrarMensagem(acervo, {
    origemDaChegada: 'ao-vivo',
    direcao,
    conversaId,
    fonte: 'whatsapp',
    idExterno: `UNIAO${seq}`,
    ...(autorId === undefined ? {} : { autorId }),
    conteudo: texto,
    ocorridaEm: quando,
    agora: AGORA,
    bruto: JSON.stringify({ key: { id: `UNIAO${seq}` }, message: { conversation: texto } }),
  });
}

function direta(acervo: Acervo, endereco: string, cfg: { id: string; fonte: 'whatsapp' } = CFG_WHATSAPP): string {
  return registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: endereco,
    coletiva: false,
    configuracao: cfg,
    bruto: JSON.stringify({ id: endereco }),
  });
}

function participa(acervo: Acervo, conversaId: string, identificadorId: string): void {
  registrarParticipacao(acervo, { conversaId, identificadorId, observadaEm: new Date(AGORA).toISOString() });
}

/** Monta o Acervo da uniao. Devolve o id de cada Conversa pela chave do caso. */
export function montarAcervoDaUniao(acervo: Acervo): Montagem {
  const conversa: Record<string, string> = {};
  const par = (alternativo: string, canonico: string): void => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo, canonico });
  };

  // Mover: 3 Mensagens na opaca (uma com Anexo, outra com Edicao, uma enviada citando a do alvo), 2 no alvo; marca na opaca.
  const idOpMover = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: OP_MOVER }).id;
  const idTelMover = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: TEL_MOVER }).id;
  registrarNome(acervo, { identificadorId: idTelMover, origem: 'whatsapp', nome: 'Contato Movido', autoridade: 'terceiro' });
  conversa['alvoMover'] = direta(acervo, TEL_MOVER);
  participa(acervo, conversa['alvoMover'], idTelMover);
  mensagem(acervo, conversa['alvoMover'], 'recebida', idTelMover, AGORA - 9000, 'alvo um');
  mensagem(acervo, conversa['alvoMover'], 'enviada', undefined, AGORA - 7000, 'alvo dois');
  conversa['opMover'] = direta(acervo, OP_MOVER);
  participa(acervo, conversa['opMover'], idOpMover);
  const comAnexo = mensagem(acervo, conversa['opMover'], 'recebida', idOpMover, AGORA - 8000, 'opaca um');
  registrarAnexo(acervo, { origemDaChegada: 'ao-vivo', mensagemId: comAnexo, tipo: 'image/jpeg', presenca: 'nunca-obtido', bruto: '{"anexo":1}' });
  const editada = mensagem(acervo, conversa['opMover'], 'enviada', undefined, AGORA - 6000, 'opaca dois');
  registrarEdicao(acervo, {
    origemDaChegada: 'ao-vivo',
    mensagemId: editada,
    fonte: 'whatsapp',
    idExterno: 'EDICAO1',
    texto: 'opaca dois editada',
    editadaEm: AGORA - 5900,
    origem: 'aberta',
    bruto: '{"edicao":1}',
    agora: AGORA,
  });
  registrarMensagem(acervo, {
    origemDaChegada: 'ao-vivo',
    direcao: 'recebida',
    conversaId: conversa['opMover'],
    fonte: 'whatsapp',
    idExterno: 'UNIAO-CITA',
    autorId: idOpMover,
    conteudo: 'opaca tres cita o alvo',
    ocorridaEm: AGORA - 5000,
    agora: AGORA,
    citacao: { idExterno: 'UNIAO-NAO-EXISTE', direcao: 'enviada' },
    bruto: '{"cita":1}',
  });
  marcarConversa(acervo, { conversaId: conversa['opMover'], marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: AGORA });
  registrarEnvio(acervo, { configuracaoId: CFG_WHATSAPP.id, destino: { conversaId: conversa['opMover'] }, conteudo: { tipo: 'texto', texto: 'envio antigo' } });
  par(OP_MOVER, TEL_MOVER);

  // Promover: 2 Mensagens, o Identificador opaco com nome, nenhum Identificador do numero.
  const idOpPromover = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: OP_PROMOVER }).id;
  registrarNome(acervo, { identificadorId: idOpPromover, origem: 'whatsapp', nome: 'Contato Promovido', autoridade: 'terceiro' });
  conversa['opPromover'] = direta(acervo, OP_PROMOVER);
  participa(acervo, conversa['opPromover'], idOpPromover);
  mensagem(acervo, conversa['opPromover'], 'recebida', idOpPromover, AGORA - 4000, 'promovida um');
  mensagem(acervo, conversa['opPromover'], 'enviada', undefined, AGORA - 3000, 'promovida dois');
  par(OP_PROMOVER, TEL_PROMOVER);

  // Ambiguo: as duas formas do numero sao Conversa na mesma Configuracao.
  conversa['opAmbiguo'] = direta(acervo, OP_AMBIGUO);
  mensagem(acervo, conversa['opAmbiguo'], 'enviada', undefined, AGORA - 2900, 'ambigua');
  conversa['ambiguoCom9'] = direta(acervo, TEL_AMBIGUO_COM9);
  conversa['ambiguoSem9'] = direta(acervo, TEL_AMBIGUO_SEM9);
  mensagem(acervo, conversa['ambiguoSem9'], 'enviada', undefined, AGORA - 2800, 'ambigua sem9');
  par(OP_AMBIGUO, TEL_AMBIGUO_COM9);

  // Duas opacas para o mesmo numero, na mesma Configuracao.
  conversa['opDuas1'] = direta(acervo, OP_DUAS_1);
  conversa['opDuas2'] = direta(acervo, OP_DUAS_2);
  mensagem(acervo, conversa['opDuas1'], 'enviada', undefined, AGORA - 2700, 'duas um');
  mensagem(acervo, conversa['opDuas2'], 'enviada', undefined, AGORA - 2600, 'duas dois');
  par(OP_DUAS_1, TEL_DUAS);
  par(OP_DUAS_2, TEL_DUAS);

  // O numero so tem Conversa em outra Configuracao: promove na primeira, nunca move entre Configuracoes.
  conversa['opOutraCfg'] = direta(acervo, OP_OUTRA_CFG);
  mensagem(acervo, conversa['opOutraCfg'], 'enviada', undefined, AGORA - 2500, 'outra cfg opaca');
  conversa['outraCfgTel'] = direta(acervo, TEL_OUTRA_CFG, CFG_WHATSAPP_SEGUNDA);
  mensagem(acervo, conversa['outraCfgTel'], 'enviada', undefined, AGORA - 2400, 'outra cfg numero');
  par(OP_OUTRA_CFG, TEL_OUTRA_CFG);

  // Opaca vazia com alvo: nada a fazer.
  conversa['opVazia'] = direta(acervo, OP_VAZIA);
  conversa['alvoVazia'] = direta(acervo, TEL_VAZIA);
  par(OP_VAZIA, TEL_VAZIA);

  // Sem par.
  conversa['opSemPar'] = direta(acervo, OP_SEM_PAR);
  mensagem(acervo, conversa['opSemPar'], 'enviada', undefined, AGORA - 2300, 'sem par');

  // Alvo so pela outra forma do numero.
  conversa['opOutraForma'] = direta(acervo, OP_OUTRA_FORMA);
  mensagem(acervo, conversa['opOutraForma'], 'enviada', undefined, AGORA - 2200, 'outra forma opaca');
  conversa['alvoOutraForma'] = direta(acervo, TEL_OUTRA_FORMA_SEM9);
  par(OP_OUTRA_FORMA, TEL_OUTRA_FORMA_COM9);

  return { conversa, outraCfg: CFG_WHATSAPP_SEGUNDA.id };
}

/** As tabelas que a uniao toca ou nao pode tocar, e a chave de cada linha. A trilha fica de fora: ela cresce de proposito. */
export const TABELAS_FOTOGRAFADAS: Record<string, string> = {
  conversas: 'id',
  mensagens: 'id',
  participacoes: "conversa_id || '|' || identificador_id",
  marcas_de_conversa: "conversa_id || '|' || marca || '|' || configuracao_id",
  identificadores: 'id',
  anexos: 'id',
  edicoes: 'id',
  chegadas: 'seq',
  envios: 'id',
  correspondencias_de_endereco: "fonte || '|' || alternativo",
  atribuicoes_de_nome: 'id',
};

/** Por tabela, a chave de cada linha e o sha256 da linha inteira. */
export function fotografar(acervo: Acervo, tabelas: string[] = Object.keys(TABELAS_FOTOGRAFADAS)): Record<string, Record<string, string>> {
  const foto: Record<string, Record<string, string>> = {};
  for (const tabela of tabelas) {
    const linhas = acervo.db.prepare(`SELECT ${TABELAS_FOTOGRAFADAS[tabela]} AS chave_da_foto, * FROM ${tabela}`).all() as Array<Record<string, unknown>>;
    foto[tabela] = {};
    for (const l of linhas) {
      const chave = String(l['chave_da_foto']);
      const corpo = { ...l };
      delete corpo['chave_da_foto'];
      foto[tabela]![chave] = createHash('sha256').update(JSON.stringify(corpo, (_k, v: unknown) => (Buffer.isBuffer(v) ? v.toString('base64') : v))).digest('hex');
    }
  }
  return foto;
}

/** As linhas da trilha (Operacoes e linhas de efeito): o ensaio nao pode acrescentar nenhuma. */
export function contarTrilha(acervo: Acervo): { operacoes: number; linhas: number } {
  return {
    operacoes: (acervo.db.prepare('SELECT COUNT(*) AS n FROM operacoes').get() as { n: number }).n,
    linhas: (acervo.db.prepare('SELECT COUNT(*) AS n FROM linhas_de_efeito').get() as { n: number }).n,
  };
}
