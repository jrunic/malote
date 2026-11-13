/**
 * Os digitos do telefone de um endereco da Fonte, quando o endereco e um numero (`<digitos>@s.whatsapp.net`, com ou sem o
 * sufixo de dispositivo). O endereco opaco (`@lid`) nao e telefone e devolve `null`. Vive no adaptador porque o nucleo nao
 * nomeia a Fonte; quem monta o rotulo do Indice de Midia o chama de `src/rede`.
 */
export function telefoneDoEndereco(endereco: string): string | null {
  const m = /^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$/.exec(endereco);
  return m === null ? null : (m[1] as string);
}
