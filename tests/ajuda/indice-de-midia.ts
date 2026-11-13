import { join } from 'node:path';
import { cenarioDeRede, type CenarioDeRede } from './rede.js';
import { abrirAcervo } from '../../src/nucleo/acervo.js';
import { registrarAnexo, registrarMensagem } from '../../src/nucleo/escrita.js';
import { configurarDestinoRemotoDeMidia, PADROES_DO_DESTINO_REMOTO } from '../../src/registro/destino-remoto.js';
import type { ConsultorDeLocalizacoes, ResultadoDasLocalizacoes } from '../../src/nucleo/midia-remota.js';

const T = (iso: string): number => Date.parse(iso);

/** Mensagens da Conversa de A com Anexos: tres no dia 01/09 (Cuiaba) e uma no dia 02/09, com um texto que NAO pode vazar. */
export function povoar(c: CenarioDeRede): string[] {
  const acervo = abrirAcervo(join(c.raiz, 'acervos'), c.inquilinoA);
  const ids: string[] = [];
  try {
    const m = (ext: string, em: number) =>
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao', direcao: 'recebida', conversaId: c.conversaDeA, fonte: 'whatsapp', idExterno: ext,
        conteudo: 'TEXTO-SECRETO-DA-MENSAGEM', ocorridaEm: em, agora: Date.now(),
      });
    const a = (mensagemId: string, tipo: string, presenca: 'presente' | 'nunca-obtido' | 'descartado') =>
      ids.push(registrarAnexo(acervo, { origemDaChegada: 'importacao', mensagemId, tipo, presenca, tamanho: 1500 }));
    a(m('i1', T('2026-09-01T15:00:00Z')), 'image', 'presente');
    a(m('i2', T('2026-09-01T16:00:00Z')), 'audio', 'presente');
    a(m('i3', T('2026-09-02T02:00:00Z')), 'image', 'nunca-obtido'); // 22h de 01/09 em Cuiaba
    a(m('i4', T('2026-09-02T12:00:00Z')), 'image', 'presente');
  } finally {
    acervo.fechar();
  }
  return ids;
}

export const consultorDe = (resultado: (anexoIds: string[]) => ResultadoDasLocalizacoes): ConsultorDeLocalizacoes => (p) => Promise.resolve(resultado(p.anexoIds));

export async function comCenario(
  opcoes: Parameters<typeof cenarioDeRede>[0],
  usar: (c: CenarioDeRede, ids: string[], rede: { servidor: string; chave: string; escrever: (t: string) => void }, saidas: string[]) => Promise<void>,
  remoto = true,
): Promise<void> {
  const c = await cenarioDeRede(opcoes);
  try {
    const ids = povoar(c);
    if (remoto) configurarDestinoRemotoDeMidia(c.registro, c.inquilinoA, { remoto: 'remoto_de_teste', ...PADROES_DO_DESTINO_REMOTO });
    const saidas: string[] = [];
    await usar(c, ids, { servidor: `http://${c.endereco}:${c.porta}`, chave: c.emitir(c.inquilinoA).valor, escrever: (t) => saidas.push(t) }, saidas);
  } finally {
    await c.parar();
  }
}

