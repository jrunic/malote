import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Acervo } from '../nucleo/acervo.js';
import { buscarMensagens, contarPorFonte, expandirData, fonteDaConversa, lerAnexoPorId, lerMensagens, listarConversas, procurarPessoas } from '../nucleo/consulta.js';
import { quemEstavaEm } from '../nucleo/presenca.js';
import { codificarCursor, decodificarCursor } from '../nucleo/cursor.js';
import { abrirRegistro } from '../registro/registro.js';
import { listarChavesDeAcesso } from '../registro/chave-de-acesso.js';
import { listarConfiguracoes, resolverFiltroDeConfiguracao } from '../registro/configuracao-adaptador.js';
import { conversasMarcadas } from '../nucleo/marca-do-titular.js';
import { lerDestinoDeMidia } from '../registro/destino-midia.js';
import type { IdentidadeDeAcesso } from '../registro/chave-de-acesso.js';
import { ehFonte } from '../nucleo/tipos.js';
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

/**
 * `video` fica de fora: recusado com sinal dedicado (415), nunca chega aqui.
 * Tipo desconhecido cai em `application/octet-stream` — generico, nao quebra.
 */
const CONTENT_TYPE_POR_TIPO: Record<string, string> = {
  image: 'image/jpeg',
  audio: 'audio/opus',
  document: 'application/octet-stream',
  sticker: 'image/webp',
};

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
    const fixada = q.get('fixada') ?? undefined;

    if (fixada === 'true' && configuracaoApelido === null) {
      json(res, 400, { erro: 'fixada exige configuracao' });
      return;
    }

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

    // Quando fixada esta ativo, `configuracao` escopa a MARCA
    // (marcas_de_conversa.configuracao_id), NAO a atribuicao
    // (conversas.configuracao_id) — compor os dois em AND mataria coletiva
    // fixada, porque a atribuicao e NULL nela e a Marca nao depende dela. O
    // filtro de marca acontece DEPOIS, em JS, contra o conjunto que
    // conversasMarcadas devolve — nunca como condicao SQL a mais.
    const marcadas = fixada === 'true'
      ? new Set(conversasMarcadas(ctx.acervo, { marca: 'fixada', configuracaoId: configuracaoId! }))
      : undefined;

    let conversas = listarConversas(ctx.acervo, {
      ...(fonte !== undefined ? { fonte: fonte as Fonte } : {}),
      ...(coletiva !== undefined ? { coletiva: coletiva === 'true' } : {}),
      ...(busca !== undefined ? { busca } : {}),
      ...(pessoa !== undefined ? { pessoaId: pessoa } : {}),
      // limite so vai pro SQL quando NAO ha marca a filtrar depois — senao o
      // corte aconteceria ANTES do filtro de marca, podendo devolver menos
      // que o pedido mesmo havendo marcadas suficientes.
      ...(marcadas === undefined && limite !== undefined ? { limite: Number(limite) } : {}),
      ...(marcadas === undefined && configuracaoId !== undefined ? { configuracaoId } : {}),
    }).map((c) => ({
      id: c.id,
      fonte: c.fonte,
      coletiva: c.coletiva,
      assunto: c.assunto,
      mensagens: c.mensagens,
      configuracao: c.configuracaoId === null ? null : (apelidoPorId.get(c.configuracaoId) ?? null),
    }));

    if (marcadas !== undefined) {
      conversas = conversas.filter((c) => marcadas.has(c.id));
      if (limite !== undefined) conversas = conversas.slice(0, Number(limite));
    }

    json(res, 200, { conversas });
    return;
  }

  if (partes.length === 1 && partes[0] === 'mensagens') {
    const q = url.searchParams;
    const limite = q.get('limite');
    const desde = q.get('desde');
    const ate = q.get('ate');
    const autor = q.get('autor');
    const fonte = q.get('fonte');
    const direcao = q.get('direcao');
    const antes = q.get('antes');

    if (direcao !== null && direcao !== 'enviada' && direcao !== 'recebida') {
      json(res, 400, { erro: 'direcao invalida — use "enviada" ou "recebida"' });
      return;
    }
    if (fonte !== null && !ehFonte(fonte)) {
      json(res, 400, { erro: `fonte invalida: ${fonte}` });
      return;
    }

    let cursor: { ocorridaEm: number; id: string } | undefined;
    if (antes !== null) {
      cursor = decodificarCursor(antes);
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

    // Default de ORDEM diverge da rota por Conversa DE PROPOSITO: esta rota
    // existe para "ultimas mensagens", entao recencia e o default — a rota
    // por Conversa continua cronologica por default, sem regressao.
    const ordem = q.get('ordem') === 'cronologica' ? ('cronologica' as const) : ('recentes' as const);

    const mensagens = lerMensagens(ctx.acervo, {
      ...(filtroDe !== undefined ? { de: filtroDe } : {}),
      ...(filtroAte !== undefined ? { ate: filtroAte } : {}),
      ...(autor !== null ? { pessoaId: autor } : {}),
      ...(fonte !== null ? { fonte } : {}), // já estreitado para Fonte pela guarda ehFonte acima
      ...(direcao !== null ? { direcao: direcao as 'enviada' | 'recebida' } : {}),
      ...(limite !== null ? { limite: Number(limite) } : {}),
      ordem,
      ...(cursor !== undefined ? { cursor } : {}),
    });

    // Sem a ambiguidade da rota por Conversa: aqui vazio e resultado
    // legitimo (Inquilino sem Mensagem que bata o filtro), nunca 404 — nao
    // ha existencia de recurso singular para confirmar ou negar.
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

  if (partes.length === 3 && partes[0] === 'conversas' && partes[2] === 'mensagens') {
    const conversaId = partes[1] as ConversaId;
    const q = url.searchParams;
    const limite = q.get('limite');
    const desde = q.get('desde');
    const ate = q.get('ate');
    const autor = q.get('autor');
    const antes = q.get('antes');
    const favorito = q.get('favorito');
    const configuracaoApelido = q.get('configuracao');
    const direcao = q.get('direcao');
    if (direcao !== null && direcao !== 'enviada' && direcao !== 'recebida') {
      json(res, 400, { erro: 'direcao invalida — use "enviada" ou "recebida"' });
      return;
    }
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

    let configuracaoId: string | undefined;
    if (favorito === 'true') {
      if (configuracaoApelido === null) {
        json(res, 400, { erro: 'favorito exige configuracao' });
        return;
      }
      // Fonte IMPLICITA da propria Conversa — esta rota nunca e ambigua,
      // porque Conversa tem uma Fonte so. Se a Conversa nao existe, a
      // resposta e o mesmo 404 vazio de sempre, sem distinguir.
      const fonteDaConversaAtual = fonteDaConversa(ctx.acervo, conversaId);
      if (fonteDaConversaAtual === undefined) {
        naoEncontrado(res);
        return;
      }
      const registro = abrirRegistro(ctx.dados);
      let resolucao;
      try {
        resolucao = resolverFiltroDeConfiguracao(
          registro, ctx.identidade.inquilinoId, configuracaoApelido, fonteDaConversaAtual,
        );
      } finally {
        registro.fechar();
      }
      if (!resolucao.ok) {
        json(res, 400, { erro: resolucao.erro });
        return;
      }
      configuracaoId = resolucao.configuracao.id;
      // A partir daqui, sabemos que a Conversa EXISTE (fonteDaConversa achou):
      // lista vazia por filtro de favorito e resposta legitima, 200 — nao 404.
    }

    // Ordem: valor EXPLICITO no query sempre vence, com ou sem cursor — o bug
    // era o ramo sem cursor so reconhecer 'cronologica' explicito e tratar
    // 'recentes' explicito como ausente. Sem `ordem` nenhum no query, o
    // default e assimetrico por DESENHO (nao regressao a corrigir): sem
    // cursor, cronologica (primeira pagina desta rota sempre foi assim); com
    // cursor, recentes (continuacao de paginacao ja assumia isso).
    const ordemParam = q.get('ordem');
    const ordemExplicita =
      ordemParam === 'cronologica' ? ('cronologica' as const)
        : ordemParam === 'recentes' ? ('recentes' as const)
          : undefined;
    const ordem = ordemExplicita ?? (cursor !== undefined ? 'recentes' : 'cronologica');

    const mensagens = lerMensagens(ctx.acervo, {
      conversaId,
      ...(filtroDe !== undefined ? { de: filtroDe } : {}),
      ...(filtroAte !== undefined ? { ate: filtroAte } : {}),
      ...(autor !== null ? { pessoaId: autor } : {}),
      ...(direcao !== null ? { direcao: direcao as 'enviada' | 'recebida' } : {}),
      ...(limite !== null ? { limite: Number(limite) } : {}),
      ...(favorito === 'true' ? { favorito: true, configuracaoId: configuracaoId! } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      ordem,
    });

    if (mensagens.length === 0 && favorito !== 'true') {
      // Conversa vazia e Conversa inexistente respondem igual — LIMITACAO
      // HERDADA, mantida para os filtros pre-existentes (desde/ate/autor).
      // Com favorito='true', a existencia ja foi confirmada acima
      // (fonteDaConversa achou) — lista vazia ali e 200, nunca cai aqui.
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

  if (partes.length === 1 && partes[0] === 'configuracoes') {
    const registro = abrirRegistro(ctx.dados);
    try {
      const configuracoes = listarConfiguracoes(registro, ctx.identidade.inquilinoId).map((c) => ({
        apelido: c.apelido,
        fonte: c.fonte,
      }));
      json(res, 200, { configuracoes });
    } finally {
      registro.fechar();
    }
    return;
  }

  if (partes.length === 2 && partes[0] === 'midia') {
    const anexoId = partes[1] as string;
    const anexo = lerAnexoPorId(ctx.acervo, anexoId);
    if (anexo === undefined || anexo.presenca !== 'presente' || anexo.caminho === null) {
      naoEncontrado(res);
      return;
    }
    if (anexo.tipo === 'video') {
      // Sinal DEDICADO, nao o 404 generico dos demais casos — aqui a posse
      // ja foi confirmada (o Anexo existe e e deste Inquilino), entao nomear
      // o tipo nao vaza nada que a posse ja nao tivesse revelado.
      json(res, 415, { erro: `tipo de Anexo nao suportado nesta rota: ${anexo.tipo}` });
      return;
    }

    const registro = abrirRegistro(ctx.dados);
    let destino;
    try {
      destino = lerDestinoDeMidia(registro, ctx.identidade.inquilinoId);
    } finally {
      registro.fechar();
    }
    if (destino === undefined) {
      naoEncontrado(res);
      return;
    }

    let bytes: Buffer;
    try {
      bytes = readFileSync(join(destino.endereco, anexo.caminho));
    } catch {
      // Presenca diz 'presente' e o arquivo nao esta la — disco perdeu o
      // dado sem o banco saber. Mesma classe "sem bytes disponiveis" dos
      // demais 404, nao um caso novo.
      naoEncontrado(res);
      return;
    }

    res.writeHead(200, {
      'content-type': CONTENT_TYPE_POR_TIPO[anexo.tipo] ?? 'application/octet-stream',
    });
    res.end(bytes);
    return;
  }

  naoEncontrado(res);
}
