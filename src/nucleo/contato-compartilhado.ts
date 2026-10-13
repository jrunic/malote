import { randomUUID } from 'node:crypto';
import type { Acervo } from './acervo.js';
import type { MensagemId } from './tipos.js';

/**
 * Contato Compartilhado (#1135): o contato que alguem ENVIA dentro de uma Mensagem.
 * Nao e Pessoa nem Cartao de Contato do catalogo. Pendura na Mensagem e e DERIVADO do
 * Conteudo Bruto, entao e refazivel: o nucleo nao sabe o que e vCard (isso e vocabulario
 * de Fonte e mora no adaptador), so recebe o cartao ja lido.
 */

export interface ValorDeContato {
  tipo: 'telefone' | 'email';
  /** Como a Fonte entregou. */
  texto: string;
  /**
   * So os digitos, para comparar e buscar por trecho. Vem pronto do adaptador, que e quem sabe
   * o que a Fonte declara (o `waid` do WhatsApp); o nucleo nunca infere codigo de pais.
   */
  digitos: string | null;
  rotulo: string | null;
}

export interface CartaoCompartilhado {
  nome: string;
  organizacao: string | null;
  nomeComercial: string | null;
  valores: ValorDeContato[];
}

export interface ContatoCompartilhadoLido extends CartaoCompartilhado {
  id: string;
  posicao: number;
}

/** Cartao sem nome nao entra: o adaptador recusa e conta antes de chegar aqui; esta e a rede. */
export class ContatoSemNomeError extends Error {
  constructor() {
    super('Contato Compartilhado exige nome');
    this.name = 'ContatoSemNomeError';
  }
}

interface LinhaDeContato {
  id: string;
  mensagem_id: string;
  posicao: number;
  nome: string;
  organizacao: string | null;
  nome_comercial: string | null;
}

interface LinhaDeValor {
  contato_id: string;
  tipo: 'telefone' | 'email';
  texto: string;
  digitos: string | null;
  rotulo: string | null;
}

/**
 * Os cartoes de VARIAS Mensagens em duas consultas (cartoes e valores), nunca uma por
 * Mensagem. Mensagem sem cartao nao entra no mapa. Ordem: a posicao no cartao, e a dos
 * valores, a de gravacao.
 */
export function lerContatosCompartilhados(
  acervo: Acervo,
  mensagemIds: readonly MensagemId[],
): Map<MensagemId, ContatoCompartilhadoLido[]> {
  const mapa = new Map<MensagemId, ContatoCompartilhadoLido[]>();
  if (mensagemIds.length === 0) return mapa;

  const ids = JSON.stringify(mensagemIds);
  const contatos = acervo
    .preparar(
      `SELECT id, mensagem_id, posicao, nome, organizacao, nome_comercial
         FROM contatos_compartilhados
        WHERE mensagem_id IN (SELECT value FROM json_each(?))
        ORDER BY mensagem_id, posicao`,
    )
    .all(ids) as LinhaDeContato[];
  if (contatos.length === 0) return mapa;

  const valores = acervo
    .preparar(
      `SELECT v.contato_id, v.tipo, v.texto, v.digitos, v.rotulo
         FROM valores_de_contato_compartilhado v
         JOIN contatos_compartilhados c ON c.id = v.contato_id
        WHERE c.mensagem_id IN (SELECT value FROM json_each(?))
        ORDER BY v.contato_id, v.rowid`,
    )
    .all(ids) as LinhaDeValor[];
  const porContato = new Map<string, ValorDeContato[]>();
  for (const v of valores) {
    const lista = porContato.get(v.contato_id) ?? [];
    lista.push({ tipo: v.tipo, texto: v.texto, digitos: v.digitos, rotulo: v.rotulo });
    porContato.set(v.contato_id, lista);
  }

  for (const c of contatos) {
    const lista = mapa.get(c.mensagem_id) ?? [];
    lista.push({
      id: c.id,
      posicao: c.posicao,
      nome: c.nome,
      organizacao: c.organizacao,
      nomeComercial: c.nome_comercial,
      valores: porContato.get(c.id) ?? [],
    });
    mapa.set(c.mensagem_id, lista);
  }
  return mapa;
}

function semId(c: ContatoCompartilhadoLido | CartaoCompartilhado): CartaoCompartilhado {
  return { nome: c.nome, organizacao: c.organizacao, nomeComercial: c.nomeComercial, valores: c.valores };
}

export interface ResultadoDoRegistro {
  /** Houve escrita. Conjunto igual ao gravado, ou lista vazia, devolve `false`. */
  mudou: boolean;
  /** Os ids dos cartoes que NASCERAM nesta chamada, na ordem da posicao. */
  criados: string[];
}

/**
 * Registra o conjunto de cartoes de uma Mensagem. O conjunto SUBSTITUI o anterior da Mensagem
 * inteira, porque a posicao so e estavel assim; igual ao gravado, nao escreve nada. Lista vazia
 * e "a Fonte nao disse nada" e nunca apaga (mesma regra dos Metadados de Coletiva).
 */
export function registrarContatosCompartilhados(
  acervo: Acervo,
  mensagemId: MensagemId,
  cartoes: readonly CartaoCompartilhado[],
): ResultadoDoRegistro {
  for (const c of cartoes) {
    if (c.nome.trim() === '') throw new ContatoSemNomeError();
  }
  if (cartoes.length === 0) return { mudou: false, criados: [] };

  const gravados = lerContatosCompartilhados(acervo, [mensagemId]).get(mensagemId) ?? [];
  if (JSON.stringify(gravados.map(semId)) === JSON.stringify(cartoes.map(semId))) {
    return { mudou: false, criados: [] };
  }

  const criados: string[] = [];
  acervo.db.transaction(() => {
    // Apagar o cartao leva os valores (ON DELETE CASCADE) e a linha da busca (gatilho).
    acervo.preparar('DELETE FROM contatos_compartilhados WHERE mensagem_id = ?').run(mensagemId);
    cartoes.forEach((c, posicao) => {
      const id = randomUUID();
      acervo
        .preparar(
          `INSERT INTO contatos_compartilhados (id, mensagem_id, posicao, nome, organizacao, nome_comercial)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, mensagemId, posicao, c.nome, c.organizacao, c.nomeComercial);
      for (const v of c.valores) {
        acervo
          .preparar(
            `INSERT INTO valores_de_contato_compartilhado (id, contato_id, tipo, texto, digitos, rotulo)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(randomUUID(), id, v.tipo, v.texto, v.digitos, v.rotulo);
      }
      criados.push(id);
    });
  })();
  return { mudou: true, criados };
}

export interface MensagemComOrigemDeCartao {
  mensagemId: MensagemId;
  /** O Conteudo Bruto de onde o cartao sai: o do Anexo `contact` (backup) ou o do evento (ao vivo). */
  bruto: string;
}

/**
 * As Mensagens que podem ter cartao no Conteudo Bruto e ainda NAO tem nenhum gravado, por origem.
 * E o estoque do preenchimento: depois dele, a lista volta vazia. Do lado ao vivo o filtro de texto
 * e so um pre-corte barato; quem decide se o `contactMessage` esta no TOPO do evento (e nao numa
 * citacao) e o adaptador, lendo o JSON.
 */
export function listarMensagensSemCartao(acervo: Acervo): {
  doBackup: MensagemComOrigemDeCartao[];
  aoVivo: MensagemComOrigemDeCartao[];
} {
  const doBackup = acervo
    .preparar(
      `SELECT a.mensagem_id AS mensagemId, a.bruto AS bruto
         FROM anexos a
        WHERE a.tipo = 'contact' AND a.bruto IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM contatos_compartilhados c WHERE c.mensagem_id = a.mensagem_id)`,
    )
    .all() as MensagemComOrigemDeCartao[];
  const aoVivo = acervo
    .preparar(
      `SELECT m.id AS mensagemId, m.bruto AS bruto
         FROM mensagens m
        WHERE m.fonte = 'whatsapp' AND m.bruto IS NOT NULL AND instr(m.bruto, '"contactMessage"') > 0
          AND NOT EXISTS (SELECT 1 FROM contatos_compartilhados c WHERE c.mensagem_id = m.id)`,
    )
    .all() as MensagemComOrigemDeCartao[];
  return { doBackup, aoVivo };
}
