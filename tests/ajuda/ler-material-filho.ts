/**
 * Lê um material de WhatsApp e imprime quantas Mensagens ele tem.
 *
 * Existe como arquivo próprio porque o teto de memória é do PROCESSO: só um
 * filho com `--max-old-space-size` fixado prova que a leitura não materializa o
 * material inteiro. Fixar o teto é obrigatório — o padrão do Node depende da
 * RAM da máquina, e sem fixá-lo o mesmo teste passaria aqui e reprovaria noutro
 * lugar.
 */
import { lerMaterial, dominioDaConta } from '../../src/adaptadores/whatsapp/material.js';

const raiz = process.argv[2];
if (raiz === undefined) {
  console.error('uso: ler-material-filho.ts <raiz do backup>');
  process.exit(2);
}

const material = lerMaterial(raiz, dominioDaConta('pessoal'));
let n = 0;
// Consome sem reter: é justamente o que um array não permite.
for (const _ of material.mensagens) n += 1;
material.fechar();
console.log(JSON.stringify({ mensagens: n }));
