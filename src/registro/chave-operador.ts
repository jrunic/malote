import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

/** Custo do scrypt. Alto o bastante para credencial, barato o bastante para CLI. */
const TAMANHO_DO_HASH = 64;
const TAMANHO_DO_SAL = 16;
const TAMANHO_DO_VALOR = 32;

export interface ChaveDeOperadorCriada {
  id: string;
  /** Aparece uma única vez. Não é recuperável depois. */
  valor: string;
}

export interface ChaveDeOperadorListada {
  id: string;
  criadaEm: string;
  revogadaEm: string | null;
}

function derivar(valor: string, sal: string): Buffer {
  return scryptSync(valor, sal, TAMANHO_DO_HASH);
}

/**
 * Cria uma Chave de Operador. O valor é gerado, nunca escolhido, e devolvido
 * uma única vez — o Registro guarda só o hash.
 */
export function criarChaveDeOperador(registro: Registro): ChaveDeOperadorCriada {
  const id = randomUUID();
  const valor = randomBytes(TAMANHO_DO_VALOR).toString('base64url');
  const sal = randomBytes(TAMANHO_DO_SAL).toString('hex');
  const hash = derivar(valor, sal).toString('hex');

  emOperacao(
    registro,
    { natureza: 'criar-chave-operador', reversibilidade: 'por-efeito' },
    (op) => {
      registro.preparar('INSERT INTO chaves_de_operador (id, sal, hash, criada_em) VALUES (?, ?, ?, ?)')
        .run(id, sal, hash, new Date().toISOString());
      // SO o id. Nem valor, nem hash, nem sal: material de credencial nao ganha
      // uma segunda casa, e a trilha e lida por quem audita, nao por quem
      // autentica. Mesmo padrao de `criarPessoa`.
      op.valor({ tabela: 'chaves_de_operador', chave: id, campo: 'id', antes: null, depois: id });
    },
  );

  return { id, valor };
}

function registrarTentativa(registro: Registro, chaveId: string | null, aceita: boolean): void {
  registro.preparar('INSERT INTO tentativas_de_chave (ocorrida_em, chave_id, aceita) VALUES (?, ?, ?)')
    .run(new Date().toISOString(), chaveId, aceita ? 1 : 0);
}

/**
 * Confere o valor apresentado contra as Chaves ativas. Registra a tentativa.
 *
 * Devolve o ID da chave que casou, ou `null`.
 *
 * Era booleano ate o ciclo 11. Mudou porque a trilha passou a gravar Ator, e
 * "autenticou" sem "quem" nao serve de auditoria — descobrir depois exigiria
 * verificar de novo, dobrando a derivacao no caminho quente.
 *
 * NUNCA devolve o valor. O id identifica sem autenticar.
 */
export function verificarChaveDeOperador(registro: Registro, valor: string): string | null {
  const ativas = registro.preparar('SELECT id, sal, hash FROM chaves_de_operador WHERE revogada_em IS NULL')
    .all() as Array<{ id: string; sal: string; hash: string }>;

  for (const chave of ativas) {
    const esperado = Buffer.from(chave.hash, 'hex');
    const obtido = derivar(valor, chave.sal);
    if (obtido.length === esperado.length && timingSafeEqual(obtido, esperado)) {
      registrarTentativa(registro, chave.id, true);
      return chave.id;
    }
  }
  registrarTentativa(registro, null, false);
  return null;
}

export function listarChavesDeOperador(registro: Registro): ChaveDeOperadorListada[] {
  const linhas = registro.preparar('SELECT id, criada_em, revogada_em FROM chaves_de_operador ORDER BY criada_em')
    .all() as Array<{ id: string; criada_em: string; revogada_em: string | null }>;
  return linhas.map((l) => ({ id: l.id, criadaEm: l.criada_em, revogadaEm: l.revogada_em }));
}

export function contarChavesAtivas(registro: Registro): number {
  const linha = registro.preparar('SELECT COUNT(*) AS total FROM chaves_de_operador WHERE revogada_em IS NULL')
    .get() as { total: number };
  return linha.total;
}

/**
 * Revoga uma Chave de Operador, com efeito imediato.
 * Recusa quando é a última ativa: a instalação nunca fica sem administração
 * possível. Revogar uma já revogada não é erro — a operação é idempotente.
 */
export function revogarChaveDeOperador(registro: Registro, chaveId: string): void {
  const alvo = registro.preparar('SELECT id, revogada_em FROM chaves_de_operador WHERE id = ?')
    .get(chaveId) as { id: string; revogada_em: string | null } | undefined;

  if (alvo === undefined) {
    throw new Error(`Chave de Operador desconhecida: ${chaveId}`);
  }
  if (alvo.revogada_em !== null) {
    return;
  }
  if (contarChavesAtivas(registro) <= 1) {
    throw new Error(
      'Recusado: esta e a ultima Chave de Operador ativa. Crie outra antes de revogar esta.',
    );
  }

  // As tres recusas acima ficam FORA do envoltorio: recusa nao e ato, e o
  // return antecipado de chave ja revogada e o que faz a segunda revogacao
  // nao gravar Operacao.
  const quando = new Date().toISOString();
  emOperacao(
    registro,
    { natureza: 'revogar-chave-operador', reversibilidade: 'por-efeito' },
    (op) => {
      registro.preparar('UPDATE chaves_de_operador SET revogada_em = ? WHERE id = ?')
        .run(quando, chaveId);
      op.valor({
        tabela: 'chaves_de_operador',
        chave: chaveId,
        campo: 'revogada_em',
        antes: null,
        depois: quando,
      });
    },
  );
}
