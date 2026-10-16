import type { DetalheDaConversa } from '../nucleo/detalhe-da-conversa.js';

const quando = (ms: number | null): string => (ms === null ? '-' : new Date(ms).toISOString());

/**
 * O resumo em texto de `detalhar` (#1203). O --json devolve o corpo. A descricao pode ter varias linhas: vai sob o
 * rotulo, recuada, para nao se confundir com os outros campos. Texto de conversa: so aqui, na saida pedida.
 */
export function formatarDetalhe(d: DetalheDaConversa): string[] {
  const linhas: string[] = [];
  linhas.push(`Conversa ${d.id}  (${d.coletiva ? 'coletiva' : 'direta'}, ${d.fonte})`);
  if (d.metadados !== undefined) {
    const m = d.metadados;
    linhas.push(`  assunto: ${m.assunto ?? '(sem assunto)'}`);
    if (m.descricao === null) {
      linhas.push('  descricao: (sem descricao)');
    } else {
      linhas.push('  descricao:');
      for (const l of m.descricao.split('\n')) linhas.push(`    ${l}`);
    }
    if (m.alteradoEm !== null || m.alteradoPor !== null) {
      linhas.push(`  alterado por ${m.alteradoPor ?? '(desconhecido)'} em ${m.alteradoEm ?? '-'}`);
    }
  } else {
    linhas.push(d.nome === null ? '  nome: (sem nome gravado)' : `  nome: ${d.nome} (${d.origemDoNome})`);
    if (d.configuracao !== null) linhas.push(`  configuracao: ${d.configuracao}`);
  }
  linhas.push(`  mensagens: ${d.mensagens}`);
  linhas.push(`  primeira: ${quando(d.primeiraMensagemEm)}  ultima: ${quando(d.ultimaMensagemEm)}`);
  return linhas;
}
