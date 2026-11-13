import { chmodSync, existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { opcao, temBandeira } from './bandeiras.js';
import { pedirGet } from './cliente.js';
import { montarHtmlDoIndice, type LinhaDoIndice, type SituacaoDaMidia } from './indice-de-midia-html.js';
import { MENSAGEM_SEM_INQUILINO_NA_REDE } from './sem-inquilino-na-rede.js';
import { NumeradorDeMidia, diaValido, nomeDaConversaNoRotulo, rotuloDeMidia } from '../nucleo/rotulo-de-midia.js';
import type { LocalizacaoParaOIndice } from '../nucleo/midia-remota.js';

interface ItemDaPagina {
  anexoId: string;
  ocorridaEm: number;
  tipo: string;
  tamanho: number | null;
  presenca: string;
  localizacao?: LocalizacaoParaOIndice | null;
}

interface PaginaDoIndice {
  conversa: { id: string; nome: string | null; assunto: string | null; telefone: string | null };
  fuso: string;
  destinoRemoto: boolean;
  itens: ItemDaPagina[];
  proximo?: string;
  servico?: string;
}

const MAXIMO_DE_PAGINAS = 10_000;

function situacaoDe(item: ItemDaPagina, destinoRemoto: boolean): { situacao: SituacaoDaMidia; idNoRemoto: string | null } {
  if (item.presenca === 'descartado') return { situacao: 'descartado', idNoRemoto: null };
  if (item.presenca !== 'presente') return { situacao: 'nao-obtido', idNoRemoto: null };
  if (item.localizacao !== undefined && item.localizacao !== null) {
    return { situacao: item.localizacao.idNoRemoto === null ? 'no-remoto-sem-link' : 'no-remoto', idNoRemoto: item.localizacao.idNoRemoto };
  }
  return { situacao: destinoRemoto ? 'pendente-de-envio' : 'so-no-disco', idNoRemoto: null };
}

/**
 * `malote indice-de-midia --conversa <id> [--de AAAAMMDD] [--ate AAAAMMDD] [--tipo <tipo>] [--saida <arquivo>] [--sobrescrever]`:
 * monta no CLIENTE o HTML com um link por midia da Conversa. Roda so por rede. O `NN` do rotulo conta TODA midia da Conversa
 * no dia (o `--tipo` so esconde linhas), para o rotulo nao mudar com o filtro. Com Destino Remoto e sem as Localizacoes
 * (Servico fora do ar, ocupado), nao grava: um Indice sem link nao se passa por completo.
 */
export async function executarIndiceDeMidia(
  argumentos: string[],
  rede: { servidor: string; chave: string; escrever: (t: string) => void },
): Promise<number> {
  if (argumentos.includes('--inquilino')) {
    rede.escrever(MENSAGEM_SEM_INQUILINO_NA_REDE);
    return 2;
  }
  const conversa = opcao(argumentos, 'conversa');
  if (conversa === undefined) {
    rede.escrever('Informe --conversa <id>.');
    return 2;
  }
  for (const nome of ['de', 'ate']) {
    const v = opcao(argumentos, nome);
    if (v !== undefined && !diaValido(v)) {
      rede.escrever(`--${nome} precisa ser um dia que existe, no formato AAAAMMDD.`);
      return 2;
    }
  }
  const tipo = opcao(argumentos, 'tipo');
  /** A saida vale antes de baixar 94 paginas: pasta que nao existe e arquivo que ja existe sao erro de uso no comeco, nao no fim. */
  const conferirSaida = (saida: string): number | undefined => {
    if (!existsSync(dirname(saida)) || !statSync(dirname(saida)).isDirectory()) {
      rede.escrever(`A pasta de ${saida} nao existe.`);
      return 2;
    }
    if (existsSync(saida) && !temBandeira(argumentos, 'sobrescrever')) {
      rede.escrever(`${saida} ja existe. Use --sobrescrever, ou outro --saida.`);
      return 2;
    }
    return undefined;
  };
  const saidaDada = opcao(argumentos, 'saida');
  if (saidaDada !== undefined) {
    const recusa = conferirSaida(saidaDada);
    if (recusa !== undefined) return recusa;
  }
  const linhas: LinhaDoIndice[] = [];
  let numerador: NumeradorDeMidia | undefined;
  let nomeNoRotulo = '';
  let proximo: string | undefined;
  let primeira = true;
  for (let paginas = 0; paginas < MAXIMO_DE_PAGINAS; paginas += 1) {
    const qs = new URLSearchParams({ limite: '500' });
    if (proximo !== undefined) qs.set('proximo', proximo);
    for (const nome of ['de', 'ate']) {
      const v = opcao(argumentos, nome);
      if (v !== undefined) qs.set(nome, v);
    }
    let pagina: PaginaDoIndice;
    try {
      const r = await pedirGet(rede.servidor, rede.chave, `/conversas/${encodeURIComponent(conversa)}/indice-de-midia?${qs.toString()}`);
      pagina = JSON.parse(r.corpo) as PaginaDoIndice;
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        rede.escrever(`Conversa nao encontrada: ${conversa}`);
        return (e as { codigoDeSaida?: number }).codigoDeSaida ?? 6;
      }
      rede.escrever((e as Error).message);
      return (e as { codigoDeSaida?: number }).codigoDeSaida ?? 1;
    }
    if (primeira) {
      primeira = false;
      numerador = new NumeradorDeMidia(pagina.fuso);
      nomeNoRotulo = nomeDaConversaNoRotulo({ ...pagina.conversa, conversaId: pagina.conversa.id });
      if (saidaDada === undefined) {
        const recusa = conferirSaida(`indice-de-midia-${nomeNoRotulo}.html`);
        if (recusa !== undefined) return recusa;
      }
    }
    if (pagina.destinoRemoto && pagina.itens.length > 0 && pagina.servico !== 'ok') {
      rede.escrever(
        `O Servico de Armazenamento nao respondeu (${pagina.servico ?? 'sem resposta'}): nao da para montar os links agora, ` +
          'e um Indice sem link nao se passa por completo. Nada foi gravado. Repita daqui a pouco.',
      );
      return 5;
    }
    for (const item of pagina.itens) {
      const { data, nn } = (numerador as NumeradorDeMidia).proximo(item.ocorridaEm);
      if (tipo !== undefined && item.tipo !== tipo) continue;
      const { situacao, idNoRemoto } = situacaoDe(item, pagina.destinoRemoto);
      linhas.push({ rotulo: rotuloDeMidia(data, nn, nomeNoRotulo), tipo: item.tipo, tamanho: item.tamanho, situacao, idNoRemoto });
    }
    proximo = pagina.proximo;
    if (proximo === undefined) break;
  }
  if (proximo !== undefined) {
    // O laco acabou pelo teto e nao pelo fim da Conversa: um Indice incompleto nao se passa por completo.
    rede.escrever(`O Indice passou de ${MAXIMO_DE_PAGINAS} paginas e nao chegou ao fim da Conversa. Nada foi gravado.`);
    return 1;
  }
  const saida = saidaDada ?? `indice-de-midia-${nomeNoRotulo}.html`;
  try {
    // Dado pessoal (o nome da Conversa, os links): so o dono le, tambem quando se sobrescreve (o `mode` do `writeFileSync`
    // vale so na criacao). Grava num temporario 0600 na mesma pasta e o renomeia: o arquivo antigo nunca fica meio escrito.
    const parcial = `${saida}.parcial`;
    writeFileSync(parcial, montarHtmlDoIndice(nomeNoRotulo, linhas), { mode: 0o600 });
    chmodSync(parcial, 0o600);
    renameSync(parcial, saida);
  } catch (e) {
    rede.escrever(`Nao consegui gravar ${saida}: ${(e as Error).message}`);
    return 1;
  }
  const comLink = linhas.filter((l) => l.situacao === 'no-remoto' && l.idNoRemoto !== null).length;
  rede.escrever(`Indice gravado: ${saida} (${linhas.length} midia(s), ${comLink} com link).`);
  return 0;
}
