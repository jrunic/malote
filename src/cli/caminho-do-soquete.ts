import { join } from 'node:path';

/** O soquete do Servico de Armazenamento, na pasta de estado dele: quem serve e quem pede sabem o mesmo lugar. */
export function caminhoDoSoquete(estado: string): string {
  return join(estado, 'armazenamento', 'servico.sock');
}
