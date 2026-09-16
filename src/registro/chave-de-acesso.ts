import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

/**
 * A Chave de Acesso: credencial de leitura por rede, escopada a UM Inquilino.
 *
 * Espelha a Chave de Operador de proposito — mesma derivacao, mesmo tamanho de
 * valor, mesma disciplina de nao guardar material de credencial na trilha. O
 * que muda e o que ela carrega: a Chave de Operador administra a instalacao e
 * NAO le Acervo; esta le UM Acervo e nao administra nada.
 */
const TAMANHO_DO_HASH = 64;
const TAMANHO_DO_SAL = 16;
const TAMANHO_DO_VALOR = 32;

export interface ChaveDeAcessoCriada {
  id: string;
  valor: string;
}

export interface ChaveDeAcessoListada {
  id: string;
  criadaEm: string;
  revogadaEm: string | null;
}

/** Quem a credencial diz ser. E o alcance dela, resolvido na verificacao. */
export interface IdentidadeDeAcesso {
  chaveId: string;
  inquilinoId: string;
}

function derivar(valor: string, sal: string): Buffer {
  return scryptSync(valor, sal, TAMANHO_DO_HASH);
}

export function emitirChaveDeAcesso(registro: Registro, inquilinoId: string): ChaveDeAcessoCriada {
  const existe = registro.preparar('SELECT 1 FROM inquilinos WHERE id = ?').get(inquilinoId);
  // A chave estrangeira barraria sozinha. A checagem existe pela MENSAGEM:
  // erro de FK diz "constraint failed" e nao diz qual Inquilino nao existe.
  if (existe === undefined) throw new Error(`Inquilino desconhecido: ${inquilinoId}`);

  const id = randomUUID();
  const valor = randomBytes(TAMANHO_DO_VALOR).toString('base64url');
  const sal = randomBytes(TAMANHO_DO_SAL).toString('hex');
  const hash = derivar(valor, sal).toString('hex');

  emOperacao(
    registro,
    { natureza: 'emitir-chave-de-acesso', reversibilidade: 'por-efeito', inquilinoId },
    (op) => {
      registro.preparar(
          `INSERT INTO chaves_de_acesso (id, inquilino_id, sal, hash, criada_em)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(id, inquilinoId, sal, hash, new Date().toISOString());
      // SO o id e o Inquilino. Nem valor, nem hash, nem sal: material de
      // credencial nao ganha uma segunda casa, e a trilha e lida por quem
      // audita, nao por quem autentica.
      op.valor({
        tabela: 'chaves_de_acesso',
        chave: id,
        campo: 'inquilino_id',
        antes: null,
        depois: inquilinoId,
      });
    },
  );

  return { id, valor };
}

/**
 * Devolve QUEM a credencial e, ou `null`.
 *
 * Nao devolve booleano de proposito: e daqui que sai o Inquilino da consulta,
 * e e por isso que ele nunca precisa vir do chamador. Devolver `true` obrigaria
 * quem chama a perguntar o alcance depois — e a janela entre "e valida" e "o
 * que ela abre" e exatamente onde o isolamento se perde.
 */
export function verificarChaveDeAcesso(
  registro: Registro,
  valor: string,
): IdentidadeDeAcesso | null {
  const ativas = registro.preparar('SELECT id, inquilino_id, sal, hash FROM chaves_de_acesso WHERE revogada_em IS NULL')
    .all() as Array<{ id: string; inquilino_id: string; sal: string; hash: string }>;

  for (const chave of ativas) {
    const esperado = Buffer.from(chave.hash, 'hex');
    const obtido = derivar(valor, chave.sal);
    if (obtido.length === esperado.length && timingSafeEqual(obtido, esperado)) {
      registrarTentativaDeAcesso(registro, chave.id, chave.inquilino_id, true);
      return { chaveId: chave.id, inquilinoId: chave.inquilino_id };
    }
  }
  // Sem casar, NAO ha Inquilino a registrar — e a ausencia e o dado honesto.
  // Exigir alvo aqui exigiria o impossivel: credencial que nao corresponde a
  // Chave nenhuma nao aponta para Inquilino nenhum.
  registrarTentativaDeAcesso(registro, null, null, false);
  return null;
}

function registrarTentativaDeAcesso(
  registro: Registro,
  chaveId: string | null,
  inquilinoAlvo: string | null,
  aceita: boolean,
): void {
  registro.preparar(
      `INSERT INTO tentativas_de_chave (ocorrida_em, chave_id, aceita, inquilino_alvo)
       VALUES (?, ?, ?, ?)`,
    )
    .run(new Date().toISOString(), chaveId, aceita ? 1 : 0, inquilinoAlvo);
}

export function revogarChaveDeAcesso(registro: Registro, chaveId: string): void {
  const atual = registro.preparar('SELECT inquilino_id, revogada_em FROM chaves_de_acesso WHERE id = ?')
    .get(chaveId) as { inquilino_id: string; revogada_em: string | null } | undefined;
  if (atual === undefined) throw new Error(`Chave de Acesso desconhecida: ${chaveId}`);
  // Ja revogada: quem chama quer o estado, e ele ja e esse. Gravar Operacao
  // aqui encheria a trilha de linhas sem efeito.
  if (atual.revogada_em !== null) return;

  const quando = new Date().toISOString();
  emOperacao(
    registro,
    {
      natureza: 'revogar-chave-de-acesso',
      reversibilidade: 'por-efeito',
      inquilinoId: atual.inquilino_id,
    },
    (op) => {
      registro.preparar('UPDATE chaves_de_acesso SET revogada_em = ? WHERE id = ?')
        .run(quando, chaveId);
      op.valor({
        tabela: 'chaves_de_acesso',
        chave: chaveId,
        campo: 'revogada_em',
        antes: null,
        depois: quando,
      });
    },
  );
}

/**
 * As Chaves de UM Inquilino — nunca as de outro, e nunca o valor.
 *
 * O filtro por Inquilino e o proprio isolamento: e o que torna a auditoria de
 * emissao util a quem nao e o Operador. O Titular ve Chave emitida para o seu
 * Inquilino ainda que nao tenha sido ele a pedir.
 */
export function listarChavesDeAcesso(
  registro: Registro,
  inquilinoId: string,
): ChaveDeAcessoListada[] {
  return registro.preparar(
      `SELECT id, criada_em AS criadaEm, revogada_em AS revogadaEm
         FROM chaves_de_acesso
        WHERE inquilino_id = ?
        ORDER BY criada_em`,
    )
    .all(inquilinoId) as ChaveDeAcessoListada[];
}
