import { randomUUID } from 'node:crypto';
import type { Acervo } from './acervo.js';
import type { ConversaId } from './tipos.js';
import { emOperacao } from './trilha.js';

export type DestinoDeEnvio = { conversaId: ConversaId } | { enderecoCru: string };

export interface ConteudoDeEnvioTexto {
  tipo: 'texto';
  texto: string;
}

export interface EntradaDeEnvio {
  configuracaoId: string;
  destino: DestinoDeEnvio;
  conteudo: ConteudoDeEnvioTexto;
}

export interface ResultadoDeRegistro {
  envioId: string;
  identificadorDeEnvio: string;
}

/**
 * Registra um pedido de Envio. O Identificador de Envio e gerado AQUI, antes
 * de qualquer tentativa de enviar — e o que sustenta a garantia ao menos uma
 * vez (ver docs/dominio/malote.md, agregado Envio).
 *
 * Comando de decisao: grava uma Operacao, com o Envio como Linha de Efeito.
 */
export function registrarEnvio(acervo: Acervo, entrada: EntradaDeEnvio): ResultadoDeRegistro {
  const envioId = randomUUID();
  const identificadorDeEnvio = randomUUID();
  const conversaId = 'conversaId' in entrada.destino ? entrada.destino.conversaId : null;
  const destinoCru = 'enderecoCru' in entrada.destino ? entrada.destino.enderecoCru : null;

  emOperacao(acervo, { natureza: 'solicitar-envio', reversibilidade: 'por-efeito' }, (op) => {
    acervo
      .preparar(
        `INSERT INTO envios
           (id, identificador_de_envio, configuracao_id, conversa_id, destino_cru,
            conteudo_tipo, conteudo_texto, estado, solicitada_em)
         VALUES (?, ?, ?, ?, ?, 'texto', ?, 'pendente', ?)`,
      )
      .run(
        envioId,
        identificadorDeEnvio,
        entrada.configuracaoId,
        conversaId,
        destinoCru,
        entrada.conteudo.texto,
        new Date().toISOString(),
      );
    op.valor({ tabela: 'envios', chave: envioId, campo: 'estado', antes: null, depois: 'pendente' });
  });

  return { envioId, identificadorDeEnvio };
}

export interface EnvioElegivel {
  envioId: string;
  identificadorDeEnvio: string;
  conversaId: string | null;
  destinoCru: string | null;
  conteudo: ConteudoDeEnvioTexto;
}

/**
 * O proximo Envio pendente DAQUELA Configuracao — nunca atravessa
 * Configuracao, porque `processarEnvios` roda dentro de um `ouvir` que so
 * tem o socket de UMA conta. Ordena por `tentativas` primeiro: um Envio que
 * ja tentou e nao conseguiu cede a vez aos que nunca tentaram, para a fila
 * nao travar atras do mesmo problema. Desempate por `solicitada_em` e, por
 * ultimo, `rowid` — duas solicitacoes no mesmo milissegundo precisam de
 * ordem estavel (mesmo motivo do `solicitada_em` em `transcricao.ts`).
 */
export function proximoEnvioPendente(
  acervo: Acervo,
  configuracaoId: string,
): EnvioElegivel | undefined {
  const linha = acervo
    .preparar(
      `SELECT id, identificador_de_envio, conversa_id, destino_cru, conteudo_texto
         FROM envios
        WHERE configuracao_id = ? AND estado = 'pendente'
        ORDER BY tentativas ASC, solicitada_em ASC, rowid ASC
        LIMIT 1`,
    )
    .get(configuracaoId) as
    | {
        id: string;
        identificador_de_envio: string;
        conversa_id: string | null;
        destino_cru: string | null;
        conteudo_texto: string;
      }
    | undefined;
  if (linha === undefined) return undefined;
  return {
    envioId: linha.id,
    identificadorDeEnvio: linha.identificador_de_envio,
    conversaId: linha.conversa_id,
    destinoCru: linha.destino_cru,
    conteudo: { tipo: 'texto', texto: linha.conteudo_texto },
  };
}

/**
 * Marca "enviado" — chamado quando `sendMessage` devolve `key.id`. NAO espera
 * o eco de `messages.upsert`: o retorno ja confirma relay aceito.
 */
export function marcarEnvioEnviado(acervo: Acervo, envioId: string): void {
  acervo
    .preparar(`UPDATE envios SET estado = 'enviado', concluida_em = ? WHERE id = ?`)
    .run(new Date().toISOString(), envioId);
}

/**
 * Marca falha DEFINITIVA — destino malformado ou rejeicao que `conexao.enviar`
 * nao classificou como transporte. Retorno `undefined` por transporte caido
 * NAO chama esta funcao: ver `incrementarTentativaDeEnvio`.
 */
export function marcarEnvioFalhou(acervo: Acervo, envioId: string, motivo: string): void {
  acervo
    .preparar(`UPDATE envios SET estado = 'falhou', motivo_falha = ? WHERE id = ?`)
    .run(motivo, envioId);
}

/**
 * Soma uma tentativa SEM mudar o estado — o Envio continua `pendente`.
 * Chamado quando `conexao.enviar` devolve indeterminado (transporte caido ou
 * retorno sem key.id): a garantia e ao menos uma vez, e o risco de duplicata
 * e aceito; o que este contador evita e a fila travar atras do mesmo item.
 */
export function incrementarTentativaDeEnvio(acervo: Acervo, envioId: string): void {
  acervo.preparar(`UPDATE envios SET tentativas = tentativas + 1 WHERE id = ?`).run(envioId);
}

/**
 * Grava a Conversa resolvida/criada apos o envio ter sucesso, e apaga o
 * destino cru — a partir daqui o Envio sabe para onde foi sem reresolver.
 */
export function atualizarConversaDoEnvio(
  acervo: Acervo,
  envioId: string,
  conversaId: string,
): void {
  acervo
    .preparar(`UPDATE envios SET conversa_id = ?, destino_cru = NULL WHERE id = ?`)
    .run(conversaId, envioId);
}

export interface EnvioFalho {
  envioId: string;
  motivoFalha: string | null;
}

export function listarEnviosFalhos(acervo: Acervo): EnvioFalho[] {
  return (
    acervo
      .preparar(`SELECT id AS envioId, motivo_falha AS motivoFalha FROM envios WHERE estado = 'falhou'`)
      .all() as { envioId: string; motivoFalha: string | null }[]
  ).map((l) => ({ envioId: l.envioId, motivoFalha: l.motivoFalha }));
}

/**
 * Volta todo Envio falho para pendente E ZERA tentativas — mesmo espirito de
 * `reenfileirarFalhas` (Transcricao) e `reprocessar-derrame`: estado de
 * falha e terminal ate este ato explicito.
 */
export function reenfileirarEnviosFalhos(acervo: Acervo): number {
  const falhas = listarEnviosFalhos(acervo);
  if (falhas.length === 0) return 0;
  emOperacao(acervo, { natureza: 'reprocessar-envio', reversibilidade: 'por-efeito' }, (op) => {
    for (const f of falhas) {
      acervo
        .preparar(`UPDATE envios SET estado = 'pendente', motivo_falha = NULL, tentativas = 0 WHERE id = ?`)
        .run(f.envioId);
      op.valor({
        tabela: 'envios',
        chave: f.envioId,
        campo: 'estado',
        antes: 'falhou',
        depois: 'pendente',
      });
    }
  });
  return falhas.length;
}

export interface ContagemDeEnvio {
  estado: 'pendente' | 'enviado' | 'falhou';
  n: number;
}

/** O "sinal proprio" de `malote envio estado` — nunca embutido em outra saida. */
export function contarEnviosPorEstado(acervo: Acervo): ContagemDeEnvio[] {
  return acervo
    .preparar(`SELECT estado, COUNT(*) AS n FROM envios GROUP BY estado ORDER BY estado`)
    .all() as ContagemDeEnvio[];
}
