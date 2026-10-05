/**
 * A identidade da PROPRIA conta, como o vinculo a entrega, e a comparacao de
 * telefone que a conferencia precisa. Funcoes puras: nao abrem banco nem
 * biblioteca.
 *
 * Forma medida em campo (05/10/2026): o vinculo traz `id` e `lid` COM sufixo de
 * dispositivo (`<numero>:<dispositivo>@...`), e o Acervo grava o endereco na
 * forma canonica, SEM ele.
 *
 * Esta funcao mora no Adaptador de WhatsApp de proposito: o nono digito do
 * celular brasileiro e vocabulario de Fonte (CONTEXTO.md, restricao do nome
 * que repete o numero). O predicado e NOVO — o conhecimento brasileiro que o
 * Adaptador tinha comparava um NOME com um endereco, e as variantes de
 * telefone vivem no Adaptador de catalogo, que este nao pode importar.
 */

export interface IdentidadeBrutaDoVinculo {
  /** Na biblioteca, "ID em forma de LID ou de JID": pode ser qualquer das duas. */
  id?: string | undefined;
  jid?: string | undefined;
  lid?: string | undefined;
  name?: string | undefined;
}

export interface IdentidadeDaConta {
  /** So digitos, com codigo do pais. */
  telefone: string;
  /** `<telefone>@s.whatsapp.net`, sem sufixo de dispositivo. */
  jid: string;
  /** `<numero>@lid`, sem sufixo de dispositivo; nulo se o vinculo nao o traz. */
  lid: string | null;
}

const JID = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/;
const LID = /^(\d+)(?::\d+)?@lid$/;

/**
 * O primeiro dos candidatos que casa com o padrao. O tipo da biblioteca para a
 * identidade do socket traz `id` (em forma de LID OU de JID), `jid` e `lid`
 * proprios; a salva em disco foi medida so com `id` de telefone e `lid`.
 */
function primeiroQueCasa(candidatos: Array<string | undefined>, padrao: RegExp): RegExpExecArray | null {
  for (const c of candidatos) {
    if (c === undefined) continue;
    const m = padrao.exec(c);
    if (m !== null) return m;
  }
  return null;
}

/** `undefined` quando nenhum dos campos traz um JID de telefone legivel. */
export function identidadeDoVinculo(bruta: IdentidadeBrutaDoVinculo): IdentidadeDaConta | undefined {
  const casouJid = primeiroQueCasa([bruta.jid, bruta.id], JID);
  if (casouJid === null) return undefined;
  const telefone = casouJid[1] as string;
  const casouLid = primeiroQueCasa([bruta.lid, bruta.id], LID);
  return {
    telefone,
    jid: `${telefone}@s.whatsapp.net`,
    lid: casouLid === null ? null : `${casouLid[1] as string}@lid`,
  };
}

const DDI_BR = '55';

/**
 * Dois telefones sao o MESMO se forem iguais, ou se forem o mesmo celular
 * brasileiro com e sem o nono digito: `55 DD 9 XXXXXXXX` contra `55 DD XXXXXXXX`,
 * onde `XXXXXXXX` comeca em 6 a 9 (faixa de celular). Fixo (comeca em 2 a 5)
 * NAO ganha 9, outro DDD e outro pais nunca casam por terminacao.
 */
export function mesmoTelefone(a: string, b: string): boolean {
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
  if (a === b) return true;
  const [longo, curto] = a.length >= b.length ? [a, b] : [b, a];
  if (longo.length !== 13 || curto.length !== 12) return false;
  if (!longo.startsWith(DDI_BR) || !curto.startsWith(DDI_BR)) return false;
  if (longo.slice(2, 4) !== curto.slice(2, 4)) return false; // mesmo DDD
  if (longo[4] !== '9') return false; // o nono digito
  const semNono = longo.slice(5); // os 8 digitos
  if (!/^[6-9]/.test(semNono)) return false; // faixa de celular
  return semNono === curto.slice(4);
}
