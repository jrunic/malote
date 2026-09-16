import { appendFileSync } from 'node:fs';

/**
 * Captura DIAGNOSTICA de app-state, com valor — e por isso ela nasce desligada.
 *
 * O log do servico grava FORMA e nunca valor, e essa propriedade nao se
 * negocia: log de servico e arquivo que sobrevive ao proposito que o criou.
 * Mas a Autoridade do nome que chega no Retrato de Estado nao se decide por
 * forma. Medido em 13/09/2026 contra 21.785 eventos de app-state do ouvinte de
 * producao: `name` so chega em `contacts.upsert`, e esse evento NAO traz
 * `notify` — o contador que compara os dois deu 0 em 9.625 itens, por
 * vacuidade, nao por igualdade. O unico oraculo possivel e comparar o VALOR com
 * o que ja esta gravado no Acervo.
 *
 * O que torna isto aceitavel num produto de privacidade nao e o risco ser
 * pequeno; e ser EXPLICITO:
 *   - so existe quando `MALOTE_CAPTURA_DE_RETRATO` aponta um caminho;
 *   - o caminho fica ao lado do vinculo, que e o diretorio mais privilegiado
 *     da instalacao;
 *   - e diagnostico com PRAZO — desligar e recolher e passo declarado, com
 *     dono, no plano que o criou.
 */
export type Capturar = (fluxo: string, dado: unknown) => void;

/**
 * O nada NOMEADO. Existe para o teste poder afirmar identidade: uma funcao
 * anonima que nao escreve e indistinguivel de uma que escreve no lugar errado.
 */
export const CAPTURA_DESLIGADA: Capturar = () => {};

/** Sem caminho, devolve o nada. E o default, e e o que roda em producao. */
export function abrirCaptura(caminho: string | undefined): Capturar {
  // Vazio conta como AUSENTE: `process.env.X` de variavel declarada e vazia
  // devolve '', nao undefined — mesma familia do defeito que a v0.13.0 pagou.
  if (caminho === undefined || caminho === '') return CAPTURA_DESLIGADA;

  // NENHUM trabalho de disco AQUI, e a razao foi medida no Linux em
  // 13/09/2026: `mkdirSync(dirname, { recursive: true })` sobre um caminho
  // patologico — /proc/<qualquer coisa> — NAO lanca e NAO volta. Pendura. O CI
  // ficou 30 minutos preso na suite, e no macOS o mesmo codigo falhava limpo
  // porque /proc nao existe la.
  //
  // Abrir a captura acontece no caminho de SUBIDA do ouvinte: um travamento
  // aqui e o ouvinte que nunca conecta, por causa de um diagnostico. A pasta
  // e pre-condicao do operador — a Acao Documentada aponta para o diretorio do
  // vinculo, que ja existe. Pasta ausente faz a escrita falhar com ENOENT,
  // engolido abaixo, e a verificacao da Acao (contar as linhas) mostra o
  // silencio.
  return (fluxo, dado) => {
    try {
      appendFileSync(caminho, JSON.stringify({ em: new Date().toISOString(), fluxo, dado }) + '\n');
    } catch {
      // Captura NUNCA custa Mensagem. Disco cheio, permissao, serializacao
      // circular: o diagnostico se perde e a recepcao segue.
    }
  };
}
