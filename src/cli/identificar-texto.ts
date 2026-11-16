import type { Identificacao } from '../nucleo/identificar.js';

const quando = (ms: number | null): string => (ms === null ? '-' : new Date(ms).toISOString());

/** O resumo em texto de `identificar`, Identificador por Identificador. O --json devolve o corpo. */
export function formatarIdentificacao(r: Identificacao): string[] {
  const linhas: string[] = [];
  const onde = r.consultado.fonte === null ? '' : ` (fonte ${r.consultado.fonte})`;
  linhas.push(`Identificar ${r.consultado.valor}${onde}`);
  const { valor } = r.consultado;
  // O servidor de uma versao anterior (v0.45.0) nao manda `gravadas`: sem ela, a linha nao aparece, e o resto sai igual.
  const gravadas = (r.consultado as { gravadas?: string[] }).gravadas ?? [];
  if (gravadas.length > 0 && !gravadas.includes(valor)) {
    linhas.push(`  Pedido: ${valor}. O Acervo guarda: ${gravadas.join(', ')}.`);
  }
  if (r.identificadores.length === 0 && r.formas.length === 0) {
    linhas.push(
      '  O Acervo nunca viu este valor. Ele e comparado exato: use o valor do Identificador, com o sufixo da plataforma.',
    );
    return linhas;
  }
  for (const i of r.identificadores) {
    linhas.push('');
    linhas.push(`${i.fonte}  ${i.valor}  (${i.papel})`);
    linhas.push(
      i.pessoaId === null
        ? '  sem Pessoa'
        : `  Pessoa: ${i.pessoaId}${i.nomeDaPessoa === null ? '' : `  (${i.nomeDaPessoa})`}`,
    );
    linhas.push(i.nome === null ? '  nome: (sem nome gravado)' : `  nome: ${i.nome} (${i.origemDoNome})`);
    for (const n of i.nomes) {
      linhas.push(`    ${n.nome}  (${n.origem}${n.autoridade === null ? '' : `, ${n.autoridade}`}, ${n.atribuidoEm})`);
    }
    linhas.push(`  conversas: ${i.conversas}  mensagens: ${i.mensagens}`);
    linhas.push(`  primeira: ${quando(i.primeiraMensagemEm)}  ultima: ${quando(i.ultimaMensagemEm)}`);
    for (const e of i.etiquetas) {
      linhas.push(`  etiqueta em ${e.conversaId}: ${e.texto === null ? '(removida)' : e.texto}  (${quando(e.em)})`);
    }
  }
  // Os totais do endereco so quando ha mais de uma forma gravada; com uma so, repetiriam a linha acima. O servidor de uma
  // versao anterior (v0.50.1) nao manda `totais`: sem ele, a linha nao aparece.
  const totais = (r as { totais?: Identificacao['totais'] }).totais;
  if (totais !== undefined && r.identificadores.length > 1) {
    linhas.push('');
    linhas.push(`totais (formas somadas): conversas: ${totais.conversas}  mensagens: ${totais.mensagens}`);
    linhas.push(`  primeira: ${quando(totais.primeiraMensagemEm)}  ultima: ${quando(totais.ultimaMensagemEm)}`);
  }
  linhas.push('');
  linhas.push('Formas conhecidas:');
  for (const f of r.formas) {
    linhas.push(`  ${f.valor}  ${f.papel}${f.identificador === null ? '  (sem Identificador gravado)' : ''}`);
  }
  return linhas;
}
