import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { abrirRegistro } from '../registro/registro.js';
import { verificarChaveDeAcesso } from '../registro/chave-de-acesso.js';
import { abrirAcervoSomenteLeitura } from '../nucleo/acervo.js';
import { atorDeAcesso, comAtor } from '../nucleo/ator.js';
import { responder } from './rotas.js';
import type { InquilinoId } from '../nucleo/tipos.js';

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
}

export function criarServidor(opcoes: OpcoesDoServidor): Server {
  return createServer((req, res) => {
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

    // SOMENTE-LEITURA: abrir para escrita MIGRA a base, e um servidor que
    // atende requisicao de fora nao pode ter esse poder. A porta recusa forma
    // divergente, que e o certo — superficie de consulta nao conserta base,
    // avisa.
    const acervo = abrirAcervoSomenteLeitura(
      join(opcoes.dados, 'acervos'),
      identidade.inquilinoId as InquilinoId,
    );
    try {
      // O Ator escopa por REQUISICAO. Com estado global, a Operacao de uma
      // sairia com o Ator de outra.
      comAtor(atorDeAcesso(identidade.chaveId), () =>
        responder(req, res, { acervo, identidade, dados: opcoes.dados }),
      );
    } finally {
      acervo.fechar();
    }
  });
}
