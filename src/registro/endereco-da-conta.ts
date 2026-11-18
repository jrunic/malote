import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

/**
 * Os Enderecos da Conta de uma Configuracao (spec #1149): o telefone que o
 * humano DECLARA e o JID e o LID que o vinculo MOSTRA. O valor e opaco para o
 * Registro — quem sabe normalizar e comparar e o Adaptador da Fonte.
 */
export interface EnderecosDaConta {
  telefone: string | null;
  jid: string | null;
  lid: string | null;
  declaradoEm: string | null;
  /** Quando o vinculo confirmou a conta. Nulo ate a primeira conexao conferida. */
  conferidoEm: string | null;
}

export class TelefoneJaConferidoError extends Error {
  constructor() {
    super(
      'a conta desta Configuracao ja foi conferida pelo vinculo: uma conta nova e uma Configuracao nova',
    );
    this.name = 'TelefoneJaConferidoError';
  }
}

const TELEFONE = /^\d{10,15}$/;

/** So digitos, com codigo do pais: de 10 a 15 (o teto do plano internacional). */
export function telefoneValido(valor: string): boolean {
  return TELEFONE.test(valor);
}

interface LinhaEnderecos {
  telefone: string | null;
  jid: string | null;
  lid: string | null;
  declarado_em: string | null;
  conferido_em: string | null;
}

export function lerEnderecosDaConta(
  registro: Registro,
  configuracaoId: string,
): EnderecosDaConta | undefined {
  const l = registro
    .preparar(
      'SELECT telefone, jid, lid, declarado_em, conferido_em FROM enderecos_da_conta WHERE configuracao_id = ?',
    )
    .get(configuracaoId) as LinhaEnderecos | undefined;
  if (l === undefined) return undefined;
  return {
    telefone: l.telefone,
    jid: l.jid,
    lid: l.lid,
    declaradoEm: l.declarado_em,
    conferidoEm: l.conferido_em,
  };
}

function inquilinoDaConfiguracao(registro: Registro, configuracaoId: string): string {
  const dono = registro
    .preparar('SELECT inquilino_id FROM configuracoes_de_adaptador WHERE id = ?')
    .get(configuracaoId) as { inquilino_id: string } | undefined;
  if (dono === undefined) throw new Error(`Configuracao desconhecida: ${configuracaoId}`);
  return dono.inquilino_id;
}

/**
 * Declara o telefone da conta. Idempotente: o mesmo telefone nao escreve nem
 * abre Operacao. Numa Configuracao que o vinculo ja CONFERIU, trocar por outro
 * e recusado — a conta e a mesma pessoa, e conta nova e Configuracao nova.
 */
export function declararTelefoneDaConta(
  registro: Registro,
  configuracaoId: string,
  telefone: string,
): void {
  if (!telefoneValido(telefone)) {
    throw new Error('telefone invalido: use so digitos, com codigo do pais (de 10 a 15)');
  }
  const inquilinoId = inquilinoDaConfiguracao(registro, configuracaoId);
  const antes = lerEnderecosDaConta(registro, configuracaoId);
  if (antes?.telefone === telefone) return;
  if (antes?.conferidoEm != null && antes.telefone !== null) throw new TelefoneJaConferidoError();

  emOperacao(
    registro,
    { natureza: 'declarar-telefone-da-conta', reversibilidade: 'por-efeito', inquilinoId },
    (op) => {
      const agora = new Date().toISOString();
      registro
        .preparar(
          `INSERT INTO enderecos_da_conta (configuracao_id, telefone, declarado_em)
           VALUES (?, ?, ?)
           ON CONFLICT (configuracao_id) DO UPDATE SET
             telefone = excluded.telefone, declarado_em = excluded.declarado_em`,
        )
        .run(configuracaoId, telefone, agora);
      op.valor({
        tabela: 'enderecos_da_conta',
        chave: configuracaoId,
        campo: 'telefone',
        antes: antes?.telefone ?? null,
        depois: telefone,
      });
    },
  );
}

/**
 * Troca o telefone declarado de uma Configuracao que JA o tinha, quando a conta e a MESMA com outro numero
 * (spec #1564): e a excecao declarada a "conta nova e Configuracao nova", e so por este caminho. Mexe SO no
 * telefone: o `jid`, o `lid` e o instante da conferencia ficam como o vinculo os mostrou, ate o vinculo novo os
 * regravar. Devolve `false`, sem escrever nem abrir Operacao, quando o telefone ja e o declarado.
 *
 * A equivalencia do nono digito entre este telefone e o atual, e a recusa por telefone de OUTRA Configuracao, sao
 * da CLI (o Registro e opaco para o valor). Nao ha `desfazer` de Operacao do Registro: volta-se rodando de novo.
 */
export function trocarTelefoneDaConta(
  registro: Registro,
  configuracaoId: string,
  telefone: string,
): boolean {
  if (!telefoneValido(telefone)) {
    throw new Error('telefone invalido: use so digitos, com codigo do pais (de 10 a 15)');
  }
  const inquilinoId = inquilinoDaConfiguracao(registro, configuracaoId);
  const antes = lerEnderecosDaConta(registro, configuracaoId);
  if (antes?.telefone == null) {
    throw new Error('a Configuracao nao tem telefone declarado: use configuracao definir-telefone');
  }
  if (antes.telefone === telefone) return false;

  emOperacao(
    registro,
    { natureza: 'trocar-telefone-da-conta', reversibilidade: 'por-efeito', inquilinoId },
    (op) => {
      registro
        .preparar('UPDATE enderecos_da_conta SET telefone = ?, declarado_em = ? WHERE configuracao_id = ?')
        .run(telefone, new Date().toISOString(), configuracaoId);
      op.valor({
        tabela: 'enderecos_da_conta',
        chave: configuracaoId,
        campo: 'telefone',
        antes: antes.telefone,
        depois: telefone,
      });
    },
  );
  return true;
}

export interface EnderecosDoVinculo {
  telefone: string;
  jid: string;
  lid: string | null;
}

/**
 * Grava o que o vinculo mostrou: o JID e o LID (o LID ausente nunca apaga o
 * gravado), o telefone SO se ainda nao havia (o declarado pelo humano fica, e
 * pode diferir do JID so pelo nono digito) e o instante da conferencia.
 * Devolve `false`, sem escrever nem abrir Operacao, quando nada mudaria.
 */
export function registrarEnderecosDoVinculo(
  registro: Registro,
  configuracaoId: string,
  vinculo: EnderecosDoVinculo,
): boolean {
  const inquilinoId = inquilinoDaConfiguracao(registro, configuracaoId);
  const antes = lerEnderecosDaConta(registro, configuracaoId);

  const telefone = antes?.telefone ?? vinculo.telefone;
  const jid = vinculo.jid;
  const lid = vinculo.lid ?? antes?.lid ?? null;
  const jaConferido = antes?.conferidoEm != null;
  if (
    jaConferido &&
    antes?.telefone === telefone &&
    antes?.jid === jid &&
    antes?.lid === lid
  ) {
    return false;
  }

  emOperacao(
    registro,
    // `irreversivel`: quem escreve e o SERVICO, nao um humano, e nao ha "redefinir" para ele.
    { natureza: 'conferir-conta-do-vinculo', reversibilidade: 'irreversivel', inquilinoId },
    (op) => {
      const agora = new Date().toISOString();
      registro
        .preparar(
          `INSERT INTO enderecos_da_conta (configuracao_id, telefone, jid, lid, conferido_em)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (configuracao_id) DO UPDATE SET
             telefone = excluded.telefone, jid = excluded.jid, lid = excluded.lid,
             conferido_em = COALESCE(enderecos_da_conta.conferido_em, excluded.conferido_em)`,
        )
        .run(configuracaoId, telefone, jid, lid, agora);
      const campos: Array<[string, string | null, string | null]> = [
        ['telefone', antes?.telefone ?? null, telefone],
        ['jid', antes?.jid ?? null, jid],
        ['lid', antes?.lid ?? null, lid],
      ];
      for (const [campo, valorAntes, valorDepois] of campos) {
        if (valorAntes !== valorDepois) {
          op.valor({
            tabela: 'enderecos_da_conta',
            chave: configuracaoId,
            campo,
            antes: valorAntes,
            depois: valorDepois,
          });
        }
      }
    },
  );
  return true;
}
