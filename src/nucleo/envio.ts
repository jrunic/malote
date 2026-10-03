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
