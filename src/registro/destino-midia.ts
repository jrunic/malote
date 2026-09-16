import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InquilinoId } from '../nucleo/tipos.js';
import type { Registro } from './registro.js';
import { emOperacao } from '../nucleo/trilha.js';

export interface DestinoDeMidia {
  natureza: 'local';
  endereco: string;
}

/**
 * Verifica que o Destino é alcançável e gravável, gravando e apagando uma
 * sonda. Falha alto: Destino inalcançável nunca é aceito em silêncio, porque
 * o custo de descobrir isso no primeiro arquivo é uma importação pela metade.
 */
function verificarAlcance(endereco: string): void {
  const sonda = join(endereco, `.malote-sonda-${randomUUID()}`);
  try {
    mkdirSync(endereco, { recursive: true });
    writeFileSync(sonda, '');
  } catch (causa) {
    throw new Error(
      `Destino de Midia inalcancavel ou nao-gravavel: ${endereco}. ` +
        `Verifique o caminho e as permissoes. Causa: ${(causa as Error).message}`,
      { cause: causa },
    );
  } finally {
    rmSync(sonda, { force: true });
  }
}

/**
 * O Destino está lá e aceita escrita, AGORA.
 *
 * Diferente de `verificarAlcance`, que é do `configurar` e CRIA a pasta que
 * falta: aqui criar seria o oposto de detectar. Um Destino desmontado tem o
 * ponto de montagem vazio ou ausente — materializá-lo faria o descarte com
 * efeito ler "o arquivo já não existe" para todo Anexo e transitar a Presença
 * sem apagar nada. Ao remontar, sobraria órfão eterno com o banco mentindo.
 *
 * Não usa `access`: permissão declarada e escrita que funciona são coisas
 * diferentes em volume montado por rede. A sonda mede o que importa.
 */
export function destinoAcessivel(endereco: string): boolean {
  if (!existsSync(endereco)) return false;
  const sonda = join(endereco, `.malote-sonda-${randomUUID()}`);
  try {
    writeFileSync(sonda, '');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(sonda, { force: true });
  }
}

/**
 * Aponta onde os arquivos de Anexo de um Inquilino ficam.
 * O Destino diz onde a RAIZ fica; o layout dentro dela é decidido pelo núcleo.
 * Configurar não move arquivo — trocar o Destino de um Inquilino com Acervo
 * existente exige migração explícita, que é operação à parte.
 */
export function configurarDestinoDeMidia(
  registro: Registro,
  inquilinoId: InquilinoId,
  destino: DestinoDeMidia,
): void {
  const existe = registro.preparar('SELECT 1 AS ok FROM inquilinos WHERE id = ?').get(inquilinoId) as
    | { ok: number }
    | undefined;
  if (existe === undefined) {
    throw new Error(`Inquilino desconhecido: ${inquilinoId}`);
  }

  verificarAlcance(destino.endereco);

  const antes = registro.preparar('SELECT natureza, endereco FROM destinos_de_midia WHERE inquilino_id = ?')
    .get(inquilinoId) as { natureza: string; endereco: string } | undefined;

  emOperacao(
    registro,
    { natureza: 'configurar-destino', reversibilidade: 'por-efeito', inquilinoId },
    (op) => {
      registro.preparar(
          `INSERT INTO destinos_de_midia (inquilino_id, natureza, endereco, configurado_em)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (inquilino_id) DO UPDATE SET
             natureza = excluded.natureza,
             endereco = excluded.endereco,
             configurado_em = excluded.configurado_em`,
        )
        .run(inquilinoId, destino.natureza, destino.endereco, new Date().toISOString());

      for (const [campo, de, para] of [
        ['natureza', antes?.natureza ?? null, destino.natureza],
        ['endereco', antes?.endereco ?? null, destino.endereco],
      ] as const) {
        if (de === para) continue;
        op.valor({
          tabela: 'destinos_de_midia',
          chave: inquilinoId,
          campo,
          antes: de,
          depois: para,
        });
      }
    },
  );
}

export function lerDestinoDeMidia(
  registro: Registro,
  inquilinoId: InquilinoId,
): DestinoDeMidia | undefined {
  const linha = registro.preparar('SELECT natureza, endereco FROM destinos_de_midia WHERE inquilino_id = ?')
    .get(inquilinoId) as { natureza: 'local'; endereco: string } | undefined;
  return linha === undefined ? undefined : { natureza: linha.natureza, endereco: linha.endereco };
}
