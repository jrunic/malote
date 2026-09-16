/**
 * Configurações de Adaptador sintéticas, para os testes que precisam declarar
 * sob qual conta a Conversa direta nasce.
 *
 * São VALORES, não linhas do Registro: a porta de escrita do Acervo só confere
 * a Fonte contra a da Conversa, e não há chave estrangeira — a Configuração
 * vive no outro arquivo. Teste que precise da linha de verdade usa o Registro.
 */
export const CFG_WHATSAPP = { id: 'cfg-teste-whatsapp', fonte: 'whatsapp' } as const;
export const CFG_INSTAGRAM = { id: 'cfg-teste-instagram', fonte: 'instagram' } as const;
/** Uma segunda conta de Instagram — o critério 10 do ciclo 16. */
export const CFG_INSTAGRAM_SEGUNDA = {
  id: 'cfg-teste-instagram-2',
  fonte: 'instagram',
} as const;

/** Catalogos de contatos. Duas bases, que e o caso que o ciclo 16 persegue. */
export const CFG_CONTATOS = { id: 'cfg-teste-contatos', fonte: 'contatos' } as const;
export const CFG_CONTATOS_SEGUNDA = { id: 'cfg-teste-contatos-2', fonte: 'contatos' } as const;

/** Uma segunda conta da MESMA Fonte — o caso que o ciclo inteiro existe para separar. */
export const CFG_WHATSAPP_SEGUNDA = { id: 'cfg-teste-whatsapp-2', fonte: 'whatsapp' } as const;

/**
 * A Configuração da Fonte dada. Existe porque há teste que itera as Fontes com
 * `fonte` numa variável — e a porta de escrita RECUSA par de Fontes diferentes,
 * então uma constante fixa reprovaria na metade das iterações. É a guarda
 * funcionando, não um obstáculo.
 */
export function cfgDaFonte(fonte: string): { id: string; fonte: 'whatsapp' | 'instagram' } {
  return fonte === 'instagram' ? CFG_INSTAGRAM : CFG_WHATSAPP;
}
