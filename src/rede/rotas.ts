import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Acervo } from '../nucleo/acervo.js';
import { buscarMensagens, lerMensagens, listarConversas } from '../nucleo/consulta.js';
import { abrirRegistro } from '../registro/registro.js';
import { listarChavesDeAcesso } from '../registro/chave-de-acesso.js';
import type { IdentidadeDeAcesso } from '../registro/chave-de-acesso.js';
import type { ConversaId, Fonte } from '../nucleo/tipos.js';

/**
 * As rotas. Cada uma recebe o Acervo que a Chave abriu e devolve dado.
 *
 * Nenhuma delas escolhe Inquilino: quando chegam aqui, o alcance ja esta
 * decidido pela credencial. E isso que impede que um parametro do chamador
 * amplie o que ele ve.
 */

export interface ContextoDaRequisicao {
  acervo: Acervo;
  identidade: IdentidadeDeAcesso;
  dados: string;
}

function json(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

/**
 * Vazio de proposito: 404 detalhado e mapa para quem varre.
 *
 * Serve tanto para rota inexistente quanto para Conversa que este Acervo nao
 * tem — e a mesma resposta nos dois casos, porque distinguir "esta Conversa nao
 * e sua" de "esta Conversa nao existe" vazaria que ela existe em algum lugar.
 */
function naoEncontrado(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('');
}

export function responder(req: IncomingMessage, res: ServerResponse, ctx: ContextoDaRequisicao): void {
  const url = new URL(req.url ?? '/', 'http://interno');
  const partes = url.pathname.split('/').filter((p) => p !== '');

  if (req.method !== 'GET') {
    // A Chave de Acesso e SOMENTE-LEITURA no v1, decidido em 24/08/2026.
    naoEncontrado(res);
    return;
  }

  if (partes.length === 1 && partes[0] === 'conversas') {
    // Parametros OPCIONAIS: quem nao os envia recebe a resposta de sempre —
    // o contrato publicado no guia do cliente nao muda de significado.
    const q = url.searchParams;
    const fonte = q.get('fonte') ?? undefined;
    const coletiva = q.get('coletiva');
    const busca = q.get('busca') ?? undefined;
    const pessoa = q.get('pessoa') ?? undefined;
    const limite = q.get('limite') ?? undefined;
    const conversas = listarConversas(ctx.acervo, {
      ...(fonte !== undefined ? { fonte: fonte as Fonte } : {}),
      ...(coletiva !== undefined ? { coletiva: coletiva === 'true' } : {}),
      ...(busca !== undefined ? { busca } : {}),
      ...(pessoa !== undefined ? { pessoaId: pessoa } : {}),
      ...(limite !== undefined ? { limite: Number(limite) } : {}),
    }).map((c) => ({
      id: c.id,
      fonte: c.fonte,
      coletiva: c.coletiva,
      assunto: c.assunto,
      mensagens: c.mensagens,
    }));
    json(res, 200, { conversas });
    return;
  }

  if (partes.length === 3 && partes[0] === 'conversas' && partes[2] === 'mensagens') {
    const conversaId = partes[1] as ConversaId;
    const mensagens = lerMensagens(ctx.acervo, { conversaId });
    if (mensagens.length === 0) {
      // Conversa vazia e Conversa inexistente respondem igual. E limitacao
      // conhecida e preferivel ao inverso: distinguir exigiria confirmar a
      // existencia, e confirmar existencia e o que nao pode vazar.
      naoEncontrado(res);
      return;
    }
    json(res, 200, { mensagens });
    return;
  }

  if (partes.length === 1 && partes[0] === 'buscar') {
    const texto = url.searchParams.get('texto');
    if (texto === null || texto === '') {
      // 400, e nao 404: invocacao errada nao e "nao existe". Quem apresentou
      // Chave valida merece saber que errou a chamada.
      json(res, 400, { erro: 'informe o parametro texto' });
      return;
    }
    json(res, 200, { mensagens: buscarMensagens(ctx.acervo, { texto }) });
    return;
  }

  if (partes.length === 1 && partes[0] === 'chaves') {
    // As Chaves vivem no REGISTRO, e nao no Acervo. Reabrir aqui custa 0,46 ms
    // — medido em 03/09/2026 —, e evita segurar a base aberta durante a
    // consulta ao Acervo.
    //
    // O Inquilino e o da credencial, entao o Titular ve as Chaves DELE,
    // inclusive as que nao pediu, e nunca as de outro.
    const registro = abrirRegistro(ctx.dados);
    try {
      json(res, 200, { chaves: listarChavesDeAcesso(registro, ctx.identidade.inquilinoId) });
    } finally {
      registro.fechar();
    }
    return;
  }

  naoEncontrado(res);
}
