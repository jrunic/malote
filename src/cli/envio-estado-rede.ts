import { pedirGet, type CodigoDeFalha } from './cliente.js';
import { resolverChaveEm } from './chave-em.js';

export interface RedeDeEstado {
  servidor: string;
  chave: string | undefined;
  env: Record<string, string | undefined>;
  escrever: (texto: string) => void;
}

/**
 * `malote envio estado` no MODO REDE. Sem identificador: a contagem por estado do Inquilino da
 * chave. Com identificador (posicional, o do pedido): o estado daquele Envio. So leitura.
 * O Inquilino vem so da Chave de Acesso — por isso `--inquilino` e RECUSADO, nao ignorado.
 */
export async function executarEnvioEstadoRede(argumentos: string[], rede: RedeDeEstado): Promise<number> {
  if (argumentos.includes('--inquilino')) {
    rede.escrever(
      '--inquilino nao existe no modo rede: o Inquilino vem da Chave de Acesso. ' +
        'Para consultar a instalacao local, rode com `env -u MALOTE_SERVIDOR`.',
    );
    return 2;
  }
  const resolvida = resolverChaveEm(argumentos, rede.env, rede.chave);
  if ('erro' in resolvida) {
    rede.escrever(resolvida.erro);
    return 2;
  }
  const chave = resolvida.chave;
  if (chave === undefined || chave.trim() === '') {
    rede.escrever(
      'Informe MALOTE_CHAVE_DE_ACESSO ou --chave-em <VARIAVEL>: ' +
        'a Chave de Acesso e a identidade da consulta por rede.',
    );
    return 2;
  }

  // O identificador e o primeiro argumento depois de `envio estado` que nao e opcao nem valor de
  // opcao: `--json` e bandeira (sem valor); qualquer outra `--opcao` leva um valor, que se pula.
  const resto = argumentos.slice(2);
  let identificador: string | undefined;
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i] as string;
    if (a === '--json') continue;
    if (a.startsWith('--')) {
      i += 1;
      continue;
    }
    identificador = a;
    break;
  }
  const json = argumentos.includes('--json');

  try {
    if (identificador === undefined) {
      const r = await pedirGet(rede.servidor, chave, '/envios/contagem');
      if (json) {
        rede.escrever(r.corpo);
      } else {
        const c = JSON.parse(r.corpo) as Record<string, number>;
        for (const estado of ['enviado', 'falhou', 'pendente']) rede.escrever(`  ${estado}: ${c[estado] ?? 0}`);
      }
      return 0;
    }
    const r = await pedirGet(rede.servidor, chave, `/envios/${encodeURIComponent(identificador)}`);
    if (json) {
      rede.escrever(r.corpo);
      return 0;
    }
    const e = JSON.parse(r.corpo) as {
      envioId: string;
      identificadorDeEnvio: string;
      configuracao: string | null;
      estado: string;
      tentativas: number;
      motivoFalha: string | null;
      tipo: string;
      solicitadaEm: string;
      concluidaEm: string | null;
    };
    rede.escrever(`Envio ${e.envioId} (identificador ${e.identificadorDeEnvio})`);
    rede.escrever(`  estado: ${e.estado}`);
    rede.escrever(`  tipo: ${e.tipo}`);
    rede.escrever(`  configuracao: ${e.configuracao ?? '-'}`);
    rede.escrever(`  tentativas: ${e.tentativas}`);
    rede.escrever(`  solicitado em: ${e.solicitadaEm}`);
    rede.escrever(`  concluido em: ${e.concluidaEm ?? '-'}`);
    if (e.motivoFalha !== null) rede.escrever(`  motivo da falha: ${e.motivoFalha}`);
    return 0;
  } catch (e) {
    const falha = e as CodigoDeFalha;
    if (typeof falha.codigoDeSaida !== 'number') throw e;
    if (falha.classe === 'uso' && falha.status === 404) {
      rede.escrever(
        `O Envio ${identificador ?? ''} nao existe neste Inquilino, ou a chave nao o alcanca ` +
          '(o servidor nao distingue as duas; para o Envio da Hera use --chave-em com a chave dela).',
      );
    } else {
      rede.escrever(falha.message);
    }
    return falha.codigoDeSaida;
  }
}
