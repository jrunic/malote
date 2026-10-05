import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { abrirRegistro } from '../registro/registro.js';
import { verificarChaveDeAcesso } from '../registro/chave-de-acesso.js';
import { abrirAcervoSomenteLeitura } from '../nucleo/acervo.js';
import { atorDeAcesso, comAtor } from '../nucleo/ator.js';
import { responder, type ContextoDaRequisicao } from './rotas.js';
import type { InquilinoId } from '../nucleo/tipos.js';
import { DespachanteDeLeituras, type ResultadoDoDespacho } from './despachante.js';
import type { InstrucaoDeTeste } from './contrato-da-leitura.js';

/**
 * A superficie de rede: leitura, autenticada por Chave de Acesso.
 *
 * O Inquilino vem da CREDENCIAL, e nunca do chamador. Nenhuma rota aceita o
 * Inquilino como parametro, e enviar um nao muda nada — e o que faz a Chave ser
 * autorizacao, e nao decoracao.
 *
 * CUSTO, medido em 03/09/2026: a derivacao de uma chave custa 23,68 ms, e abrir
 * as duas bases custa 0,79 ms — 3% dela. Por isso as bases sao abertas POR
 * REQUISICAO: e a forma mais simples de garantir que revogar valha na
 * requisicao seguinte, sem cache de credencial em lugar nenhum.
 *
 * A derivacao e cara de proposito — chave barata de conferir e chave barata de
 * adivinhar. Duas consequencias declaradas: recusa varre TODAS as ativas, entao
 * custa N x 23,68 ms; e o manipulador e sincrono, entao o teto e da ordem de 42
 * requisicoes por segundo. Aceito no v1, que escuta em loopback. Revisar quando
 * houver muitas chaves ativas ou exposicao alem do loopback — o caminho e
 * derivacao assincrona, que libera o laco sem mudar o desenho.
 */

/**
 * A recusa de credencial. UMA para os tres casos: ausente, invalida e revogada.
 *
 * Corpo vazio de proposito — qualquer texto aqui vira informacao sobre o que
 * existe do outro lado — e o mesmo codigo para os tres, porque distinguir "nao
 * e seu" de "nao existe" vaza a existencia de Inquilinos alheios.
 */
function recusar(res: ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end('');
}

export const TRABALHADORES_PADRAO = 4;
export const PRAZO_PADRAO_MS = 25_000;
const FILA_MAXIMA_PADRAO = 64;

/** O gancho de teste: o que ja existia, mais a decisao POR REQUISICAO do que o worker faz de estranho. */
export type GanchoDeTesteDoServidor = NonNullable<ContextoDaRequisicao['ganchoDeTeste']> & {
  instrucaoDoTrabalhador?: (url: string) => InstrucaoDeTeste | undefined;
};

export interface ServidorDeLeitura extends Server {
  /** Para de despachar, espera as leituras em andamento por `esperaMs` e termina os workers. */
  pararLeituras: (esperaMs: number) => Promise<void>;
  despachante: DespachanteDeLeituras;
}

export function responderDeResultado(res: ServerResponse, r: ResultadoDoDespacho): void {
  if (res.destroyed || res.headersSent) return;
  switch (r.tipo) {
    case 'resposta': {
      res.writeHead(r.resposta.status, r.resposta.cabecalhos);
      // Sem copia: o Buffer ENVOLVE o ArrayBuffer que chegou por transferencia (`Buffer.from(Uint8Array)` copiaria).
      const c = r.resposta.corpo;
      res.end(typeof c === 'string' ? c : Buffer.from(c.buffer, c.byteOffset, c.byteLength));
      return;
    }
    case 'prazo':
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end('');
      return;
    case 'fila-cheia':
      res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end('');
      return;
    case 'indisponivel':
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('');
      return;
    case 'erro':
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('');
      return;
    case 'abandonado':
      return; // o cliente ja foi embora
  }
}

function chaveApresentada(req: IncomingMessage): string | null {
  const cabecalho = req.headers['authorization'];
  if (typeof cabecalho !== 'string') return null;
  const [esquema, valor] = cabecalho.split(' ');
  if (esquema !== 'Bearer' || valor === undefined || valor === '') return null;
  return valor;
}

export interface OpcoesDoServidor {
  dados: string;
  porta: number;
  /** Workers de leitura (padrao 4, de 1 a 16). */
  trabalhadores?: number;
  /** Prazo de uma leitura desde a chegada, em ms (padrao 25.000). */
  prazoMs?: number;
  filaMaxima?: number;
  /** SO PARA TESTE: outro arquivo de worker, para provar que o `servir` recusa subir se ele nao carrega. */
  arquivoDoTrabalhador?: URL;
  /** SO PARA TESTE (ver `ContextoDaRequisicao` e `GanchoDeTesteDoServidor`). */
  ganchoDeTeste?: GanchoDeTesteDoServidor;
}

export function criarServidor(opcoes: OpcoesDoServidor): ServidorDeLeitura {
  const despachante = new DespachanteDeLeituras({
    trabalhadores: opcoes.trabalhadores ?? TRABALHADORES_PADRAO,
    prazoMs: opcoes.prazoMs ?? PRAZO_PADRAO_MS,
    filaMaxima: opcoes.filaMaxima ?? FILA_MAXIMA_PADRAO,
    ...(opcoes.arquivoDoTrabalhador ? { arquivoDoTrabalhador: opcoes.arquivoDoTrabalhador } : {}),
    aoLogar: (linha) => process.stderr.write(`${linha}\n`),
  });
  const servidor = createServer((req, res) => {
    const valor = chaveApresentada(req);
    if (valor === null) {
      recusar(res);
      return;
    }

    // AUTENTICA PRIMEIRO, ABRE DEPOIS. Inverter deixaria a janela em que o
    // alcance existe antes de a autorizacao existir.
    //
    // A Chave de Operador NAO passa por aqui: ela administra e nao consulta.
    // Aceita-la daria a uma credencial de administracao o alcance de TODOS os
    // Inquilinos de uma vez.
    const registro = abrirRegistro(opcoes.dados);
    let identidade;
    try {
      identidade = verificarChaveDeAcesso(registro, valor);
    } finally {
      registro.fechar();
    }
    if (identidade === null) {
      recusar(res);
      return;
    }

    // LEITURA: roda num worker. A thread principal so autenticou (acima) e despacha — o worker recebe o
    // `chaveId` e o `inquilinoId` ja verificados, nunca a Chave. O cliente que desiste (`close` sem terminar
    // a escrita) mata a consulta dele.
    if (req.method === 'GET') {
      const abandono = new AbortController();
      // Mutante equivalente declarado (trocar `!res.writableFinished` por `true`): o `close` de uma resposta normal
      // tambem dispara, mas o despachante ja concluiu o pedido e tirou o ouvinte de `abort` (`concluir`), entao o
      // `abort` tardio nao faz nada. O teste do ABANDONO prova a parte que importa: o `close` ANTES da resposta.
      res.on('close', () => {
        if (!res.writableFinished) abandono.abort();
      });
      const instrucao = opcoes.ganchoDeTeste?.instrucaoDoTrabalhador?.(req.url ?? '/');
      void despachante
        .executar(
          {
            metodo: 'GET',
            url: req.url ?? '/',
            chaveId: identidade.chaveId,
            inquilinoId: identidade.inquilinoId,
            dados: opcoes.dados,
            ...(instrucao ? { instrucao } : {}),
          },
          abandono.signal,
        )
        .then((r) => responderDeResultado(res, r))
        .catch(() => responderDeResultado(res, { tipo: 'erro', mensagem: 'despacho' }));
      return;
    }

    // SOMENTE-LEITURA: abrir para escrita MIGRA a base, e um servidor que
    // atende requisicao de fora nao pode ter esse poder. A porta recusa forma
    // divergente, que e o certo — superficie de consulta nao conserta base,
    // avisa.
    //
    // A abertura pode lancar — Acervo ainda inexistente para um Inquilino com
    // Chave emitida, ou forma divergente — e excecao dentro do manipulador
    // derruba o PROCESSO, para todos os Inquilinos. Vira 503 de corpo vazio:
    // a Chave e valida, o que falta e do lado do servidor, e o corpo nao diz
    // nada sobre o que existe (#1115).
    let acervo;
    try {
      acervo = abrirAcervoSomenteLeitura(
        join(opcoes.dados, 'acervos'),
        identidade.inquilinoId as InquilinoId,
      );
    } catch (e) {
      process.stderr.write(
        `acervo indisponivel para a Chave ${identidade.chaveId}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('');
      return;
    }
    try {
      // O Ator escopa por REQUISICAO. Com estado global, a Operacao de uma
      // sairia com o Ator de outra.
      comAtor(atorDeAcesso(identidade.chaveId), () => {
        opcoes.ganchoDeTeste?.antesDeResponder?.(res);
        responder(req, res, {
          acervo,
          identidade,
          dados: opcoes.dados,
          ...(opcoes.ganchoDeTeste ? { ganchoDeTeste: opcoes.ganchoDeTeste } : {}),
        });
      });
    } catch (e) {
      // REDE DE SEGURANCA (#1131): excecao em QUALQUER rota derrubava o PROCESSO, para todos os
      // Inquilinos — o servidor e um so e atende todos. Vira 500 de corpo vazio (o corpo nao diz nada do
      // que aconteceu por dentro), e o processo segue. O log leva a mensagem e o caminho SEM a query, que
      // pode ter texto de conversa. Nao substitui tratar o erro na rota: um 500 e defeito, so nao e queda.
      const caminho = (req.url ?? '').split('?')[0];
      process.stderr.write(`erro na rota ${req.method ?? '?'} ${caminho}: ${e instanceof Error ? e.message : String(e)}\n`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end('');
    } finally {
      acervo.fechar();
    }
  }) as ServidorDeLeitura;
  servidor.despachante = despachante;
  servidor.pararLeituras = (esperaMs) => despachante.parar(esperaMs);
  servidor.on('close', () => void despachante.parar(0));
  return servidor;
}
