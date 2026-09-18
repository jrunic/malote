import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Acervo } from '../nucleo/acervo.js';
import { buscarMensagens, contarPorFonte, expandirData, lerMensagens, listarConversas, procurarPessoas } from '../nucleo/consulta.js';
import { quemEstavaEm } from '../nucleo/presenca.js';
import { codificarCursor, decodificarCursor } from '../nucleo/cursor.js';
import { abrirRegistro } from '../registro/registro.js';
import { listarChavesDeAcesso } from '../registro/chave-de-acesso.js';
import { listarConfiguracoes, resolverFiltroDeConfiguracao } from '../registro/configuracao-adaptador.js';
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
    const coletiva = q.get('coletiva') ?? undefined;
    const busca = q.get('busca') ?? undefined;
    const pessoa = q.get('pessoa') ?? undefined;
    const limite = q.get('limite') ?? undefined;
    const configuracaoApelido = q.get('configuracao');

    const registro = abrirRegistro(ctx.dados);
    let configuracaoId: string | undefined;
    let apelidoPorId: Map<string, string>;
    try {
      if (configuracaoApelido !== null) {
        const resolucao = resolverFiltroDeConfiguracao(
          registro,
          ctx.identidade.inquilinoId,
          configuracaoApelido,
          fonte,
        );
        if (!resolucao.ok) {
          json(res, 400, { erro: resolucao.erro });
          return;
        }
        configuracaoId = resolucao.configuracao.id;
      }
      apelidoPorId = new Map(
        listarConfiguracoes(registro, ctx.identidade.inquilinoId).map((c) => [c.id, c.apelido]),
      );
    } finally {
      registro.fechar();
    }

    const conversas = listarConversas(ctx.acervo, {
      ...(fonte !== undefined ? { fonte: fonte as Fonte } : {}),
      ...(coletiva !== undefined ? { coletiva: coletiva === 'true' } : {}),
      ...(busca !== undefined ? { busca } : {}),
      ...(pessoa !== undefined ? { pessoaId: pessoa } : {}),
      ...(limite !== undefined ? { limite: Number(limite) } : {}),
      ...(configuracaoId !== undefined ? { configuracaoId } : {}),
    }).map((c) => ({
      id: c.id,
      fonte: c.fonte,
      coletiva: c.coletiva,
      assunto: c.assunto,
      mensagens: c.mensagens,
      configuracao: c.configuracaoId === null ? null : (apelidoPorId.get(c.configuracaoId) ?? null),
    }));
    json(res, 200, { conversas });
    return;
  }

  if (partes.length === 3 && partes[0] === 'conversas' && partes[2] === 'mensagens') {
    const conversaId = partes[1] as ConversaId;
    const q = url.searchParams;
    const limite = q.get('limite');
    const desde = q.get('desde');
    const ate = q.get('ate');
    const autor = q.get('autor');
    const antes = q.get('antes');
    let cursor: { ocorridaEm: number; id: string } | undefined;
    if (antes !== null) {
      cursor = decodificarCursor(antes);
      // Cursor invalido e erro de USO: tratar como primeira pagina seria uma
      // leitura silenciosamente errada (revisao do ciclo 21).
      if (cursor === undefined) {
        json(res, 400, { erro: 'cursor invalido — devolva o token `proximo` tal como recebeu' });
        return;
      }
    }
    let filtroDe: number | undefined;
    let filtroAte: number | undefined;
    try {
      if (desde !== null) filtroDe = expandirData(desde, 'inicio');
      if (ate !== null) filtroAte = expandirData(ate, 'fim');
    } catch (e) {
      json(res, 400, { erro: (e as Error).message });
      return;
    }
    const mensagens = lerMensagens(ctx.acervo, {
      conversaId,
      ...(filtroDe !== undefined ? { de: filtroDe } : {}),
      ...(filtroAte !== undefined ? { ate: filtroAte } : {}),
      ...(autor !== null ? { pessoaId: autor } : {}),
      ...(limite !== null ? { limite: Number(limite) } : {}),
      ...(cursor !== undefined
        ? { cursor, ordem: q.get('ordem') === 'cronologica' ? ('cronologica' as const) : ('recentes' as const) }
        : q.get('ordem') === 'cronologica'
          ? { ordem: 'cronologica' as const }
          : {}),
    });
    if (mensagens.length === 0) {
      // Conversa vazia e Conversa inexistente respondem igual. E limitacao
      // conhecida e preferivel ao inverso: distinguir exigiria confirmar a
      // existencia, e confirmar existencia e o que nao pode vazar.
      naoEncontrado(res);
      return;
    }
    // O cursor `proximo` so existe quando ha mais paginas: o consumidor nunca
    // monta cursor, devolve o que recebeu.
    const temMais = limite !== null && mensagens.length >= Number(limite);
    json(res, 200, {
      mensagens,
      ...(temMais
        ? {
            proximo: codificarCursor({
              ocorridaEm: mensagens[mensagens.length - 1]!.ocorridaEm,
              id: mensagens[mensagens.length - 1]!.id,
            }),
          }
        : {}),
    });
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
    const q = url.searchParams;
    const limite = q.get('limite');
    const desde = q.get('desde');
    const ate = q.get('ate');
    const autor = q.get('autor');
    const conversa = q.get('conversa');
    let filtroDe: number | undefined;
    let filtroAte: number | undefined;
    try {
      if (desde !== null) filtroDe = expandirData(desde, 'inicio');
      if (ate !== null) filtroAte = expandirData(ate, 'fim');
    } catch (e) {
      json(res, 400, { erro: (e as Error).message });
      return;
    }
    json(res, 200, { mensagens: buscarMensagens(ctx.acervo, {
      texto,
      ...(autor !== null ? { pessoaId: autor } : {}),
      ...(conversa !== null ? { conversaId: conversa } : {}),
      ...(filtroDe !== undefined ? { de: filtroDe } : {}),
      ...(filtroAte !== undefined ? { ate: filtroAte } : {}),
      ...(limite !== null ? { limite: Number(limite) } : {}),
    }) });
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

  if (partes.length === 1 && partes[0] === 'pessoas') {
    const texto = url.searchParams.get('texto');
    if (texto === null || texto === '') {
      json(res, 400, { erro: 'informe o parametro texto' });
      return;
    }
    // Envoltorio nomeado, forma das outras rotas; Pessoa inexistente e lista
    // vazia — e busca, nao endereco.
    json(res, 200, { pessoas: procurarPessoas(ctx.acervo, { texto }) });
    return;
  }

  if (partes.length === 3 && partes[0] === 'conversas' && partes[2] === 'participantes') {
    const conversaId = partes[1] as ConversaId;
    const emParam = url.searchParams.get('em');
    let em = Date.now();
    if (emParam !== null) {
      try {
        em = expandirData(emParam, 'fim');
      } catch (e) {
        json(res, 400, { erro: (e as Error).message });
        return;
      }
    }
    // A pergunta de Presenca que o modelo ja responde; o --em e o fim do dia
    // capado ao Alcance, regra medida (CONTEXTO.md).
    json(res, 200, { presenca: quemEstavaEm(ctx.acervo, { conversaId, em }) });
    return;
  }

  if (partes.length === 1 && partes[0] === 'relatorio') {
    json(res, 200, { relatorio: contarPorFonte(ctx.acervo) });
    return;
  }

  naoEncontrado(res);
}
