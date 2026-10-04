import type { Identificacao } from '../nucleo/identificar.js';

const quando = (ms: number | null): string => (ms === null ? '-' : new Date(ms).toISOString());

/** O resumo em texto de `identificar`, Identificador por Identificador. O --json devolve o corpo. */
export function formatarIdentificacao(r: Identificacao): string[] {
  const linhas: string[] = [];
  const onde = r.consultado.fonte === null ? '' : ` (fonte ${r.consultado.fonte})`;
  linhas.push(`Identificar ${r.consultado.valor}${onde}`);
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
  }
  linhas.push('');
  linhas.push('Formas conhecidas:');
  for (const f of r.formas) {
    linhas.push(`  ${f.valor}  ${f.papel}${f.identificador === null ? '  (sem Identificador gravado)' : ''}`);
  }
  return linhas;
}
