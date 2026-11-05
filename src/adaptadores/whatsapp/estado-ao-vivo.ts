import type { Acervo } from '../../nucleo/acervo.js';
import { classificarEstado, itensDeConversa, type ClasseDeEstado } from './classificar-estado.js';
import {
  aprenderCorrespondencia,
  CorrespondenciaEmConflitoError,
  resolverEndereco,
} from '../../nucleo/correspondencia.js';
import { outraFormaDoCelular } from './celular-br.js';
import { resolverEnderecoDeWhatsapp } from './resolver-celular.js';
import {
  idDeConversaPorEndereco,
  idDeMensagemPorExterno,
  registrarIdentificador,
} from '../../nucleo/escrita.js';
import { registrarNome } from '../../nucleo/identidade.js';
import { nomeRepeteONumeroBrasileiro } from './nome-repete-numero-br.js';
import { pareceValorSentinela } from './nome-sentinela-de-contato.js';
import { emOperacao } from '../../nucleo/trilha.js';
import {
  desmarcarConversa,
  desmarcarMensagem,
  marcarConversa,
  marcarMensagem,
  reconciliarPorRetrato,
} from '../../nucleo/marca-do-titular.js';

export interface ResultadoDeEstado {
  classe: ClasseDeEstado;
  opacosPulados: number;
  favoritosSemMensagem: number;
}

const VAZIO: Pick<ResultadoDeEstado, 'opacosPulados' | 'favoritosSemMensagem'> = {
  opacosPulados: 0,
  favoritosSemMensagem: 0,
};

export function processarEstadoDeConversa(
  acervo: Acervo,
  e: {
    fluxo: string;
    dado: unknown;
    configuracaoId: string;
    observadaEm: number;
  },
): ResultadoDeEstado {
  if (e.fluxo === 'contacts.upsert') return processarContatos(acervo, e);
  if (e.fluxo === 'contacts.update') {
    return { classe: 'ignorar', ...VAZIO };
  }
  if (e.fluxo === 'messages.update' && temStarred(e.dado)) {
    return processarFavoritos(acervo, e);
  }

  const classe = classificarEstado(e.fluxo, e.dado);
  if (classe === 'ignorar') return { classe, ...VAZIO };

  const itens = itensDeConversa(e.fluxo, e.dado);
  const marcadas: string[] = [];
  const desmarcadas: string[] = [];
  let opacosPulados = 0;

  for (const cru of itens) {
    if (cru === null || typeof cru !== 'object') continue;
    const registro = cru as Record<string, unknown>;
    const id = registro['id'];
    if (typeof id !== 'string' || id.length === 0) continue;
    const resolvido = resolverEndereco(acervo, 'whatsapp', id);
    if (id.endsWith('@lid') && resolvido === id) {
      opacosPulados += 1;
      continue;
    }
    // Decide SO LENDO: o retrato traz TODAS as conversas da conta, e aprender par aqui abriria uma Operacao por numero sem
    // Conversa. Procura na forma resolvida e, se nao ha, na outra forma do celular DESSA forma (o `id` pode ser um LID).
    const procurar = (endereco: string): string | undefined =>
      idDeConversaPorEndereco(acervo, { fonte: 'whatsapp', idExterno: endereco, configuracaoId: e.configuracaoId });
    const outra = outraFormaDoCelular(resolvido);
    const conversaId =
      procurar(resolvido) ?? (outra === null ? undefined : procurar(resolverEndereco(acervo, 'whatsapp', outra)));
    if (conversaId === undefined) {
      opacosPulados += 1;
      continue;
    }
    // O baileys NAO emite boolean aqui — medido no campo em 15/09/2026 e lido
    // no chat-utils.js da 6.7.24: `pinned` e o TIMESTAMP da fixacao (numero)
    // quando fixa, e `null` quando desfixa. Item sem a chave `pinned` (so
    // `archived`, por exemplo) nao fala de fixacao: desmarcar por ele
    // desmarcaria o que o evento nao veio dizer (criterio 6 da spec).
    const pin = registro['pinned'];
    if (pin === null) desmarcadas.push(conversaId);
    else if (pin !== undefined) marcadas.push(conversaId);
  }

  if (classe === 'retrato') {
    reconciliarPorRetrato(acervo, {
      marca: 'fixada',
      configuracaoId: e.configuracaoId,
      marcadas,
      observadaEm: e.observadaEm,
    });
  } else {
    for (const conversaId of marcadas) {
      marcarConversa(acervo, {
        conversaId,
        marca: 'fixada',
        configuracaoId: e.configuracaoId,
        observadaEm: e.observadaEm,
      });
    }
    for (const conversaId of desmarcadas) {
      desmarcarConversa(acervo, {
        conversaId,
        marca: 'fixada',
        configuracaoId: e.configuracaoId,
        observadaEm: e.observadaEm,
      });
    }
  }

  return { classe, opacosPulados, favoritosSemMensagem: 0 };
}

function itensDeLista(dado: unknown): unknown[] {
  return Array.isArray(dado) ? dado : [];
}

function temStarred(dado: unknown): boolean {
  for (const cru of itensDeLista(dado)) {
    if (cru === null || typeof cru !== 'object') continue;
    const update = (cru as { update?: unknown }).update;
    if (update === null || typeof update !== 'object') continue;
    const starred = (update as { starred?: unknown }).starred;
    if (starred === true || starred === false) return true;
  }
  return false;
}

/** O contato com nome utilizavel: o nome e o endereco (o `jid`, ou o `id`); `undefined` quando o contato nao traz nome utilizavel. */
function contatoNomeado(r: Record<string, unknown>): { name: string; bruto: string } | undefined {
  const name = r['name'];
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (pareceValorSentinela(name)) return undefined;
  const jid = r['jid'];
  const id = r['id'];
  const bruto = typeof jid === 'string' && jid.length > 0 ? jid : typeof id === 'string' ? id : '';
  return bruto.length === 0 ? undefined : { name, bruto };
}

function processarContatos(
  acervo: Acervo,
  e: { dado: unknown },
): ResultadoDeEstado {
  const itens = itensDeLista(e.dado);
  const pares: Array<{ lid: string; jid: string }> = [];
  for (const cru of itens) {
    if (cru === null || typeof cru !== 'object') continue;
    const r = cru as Record<string, unknown>;
    const jid = r['jid'];
    const lid = r['lid'];
    if (typeof jid !== 'string' || jid.length === 0) continue;
    if (typeof lid !== 'string' || lid.length === 0) continue;
    if (jid === lid) continue;
    pares.push({ lid, jid });
  }

  const novos = pares.filter((p) => resolverEndereco(acervo, 'whatsapp', p.lid) === p.lid);
  if (novos.length > 0) {
    emOperacao(
      acervo,
      {
        natureza: 'aprender-endereco-ao-vivo',
        reversibilidade: 'irreversivel',
        registraEfeito: false,
      },
      () => {
        for (const p of novos) {
          try {
            aprenderCorrespondencia(acervo, {
              fonte: 'whatsapp',
              alternativo: p.lid,
              // O JID ja resolvido: o par LID aponta para a forma canonica do celular, nunca para a crua.
              canonico: resolverEnderecoDeWhatsapp(acervo, p.jid),
            });
          } catch (erro) {
            if (!(erro instanceof CorrespondenciaEmConflitoError)) throw erro;
          }
        }
      },
    );
  }

  // O par dos celulares dos contatos nomeados e aprendido num envelope por LOTE, e SO quando ha o que aprender: a agenda chega
  // inteira na subida do ouvinte e a cada reconexao, e um envelope por contato (ou um vazio por evento) encheria a trilha. So
  // entra o celular cujo par ainda nao existe, e nao entra o contato que a leitura abaixo descarta por o nome repetir o numero.
  const celulares: string[] = [];
  for (const cru of itens) {
    if (cru === null || typeof cru !== 'object') continue;
    const contato = contatoNomeado(cru as Record<string, unknown>);
    if (contato === undefined || nomeRepeteONumeroBrasileiro(contato.name, contato.bruto)) continue;
    const outra = outraFormaDoCelular(contato.bruto);
    if (
      outra !== null &&
      resolverEndereco(acervo, 'whatsapp', contato.bruto) === contato.bruto &&
      resolverEndereco(acervo, 'whatsapp', outra) === outra
    ) {
      celulares.push(contato.bruto);
    }
  }
  if (celulares.length > 0) {
    emOperacao(
      acervo,
      { natureza: 'aprender-endereco-ao-vivo', reversibilidade: 'irreversivel', registraEfeito: false },
      () => {
        for (const bruto of celulares) resolverEnderecoDeWhatsapp(acervo, bruto);
      },
    );
  }

  for (const cru of itens) {
    if (cru === null || typeof cru !== 'object') continue;
    const contato = contatoNomeado(cru as Record<string, unknown>);
    if (contato === undefined) continue;
    const { name, bruto } = contato;
    const canonico = resolverEndereco(acervo, 'whatsapp', bruto);
    if (nomeRepeteONumeroBrasileiro(name, canonico)) continue;
    const { id: identificadorId } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: canonico,
    });
    registrarNome(acervo, {
      identificadorId,
      origem: 'whatsapp',
      nome: name,
      autoridade: 'titular',
    });
  }

  return { classe: 'ignorar', ...VAZIO };
}

function processarFavoritos(
  acervo: Acervo,
  e: { dado: unknown; configuracaoId: string; observadaEm: number },
): ResultadoDeEstado {
  let favoritosSemMensagem = 0;
  for (const cru of itensDeLista(e.dado)) {
    if (cru === null || typeof cru !== 'object') continue;
    const r = cru as { key?: { id?: unknown }; update?: { starred?: unknown } };
    const starred = r.update?.starred;
    if (starred !== true && starred !== false) continue;
    const idExterno = r.key?.id;
    if (typeof idExterno !== 'string' || idExterno.length === 0) continue;
    const mensagemId = idDeMensagemPorExterno(acervo, { fonte: 'whatsapp', idExterno });
    if (mensagemId === undefined) {
      favoritosSemMensagem += 1;
      continue;
    }
    const corpo = {
      mensagemId,
      marca: 'favorito' as const,
      configuracaoId: e.configuracaoId,
      observadaEm: e.observadaEm,
    };
    if (starred) marcarMensagem(acervo, corpo);
    else desmarcarMensagem(acervo, corpo);
  }
  return { classe: 'ignorar', opacosPulados: 0, favoritosSemMensagem };
}
