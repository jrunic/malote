import { join } from 'node:path';
import { instalacaoTemporaria } from './instalacao.js';
import { abrirRegistro, criarInquilino } from '../../src/registro/registro.js';
import { resolverConfiguracao } from '../../src/registro/configuracao-adaptador.js';
import { abrirAcervo, type Acervo } from '../../src/nucleo/acervo.js';
import { caminhosDaConta } from '../../src/cli/ouvir.js';

/**
 * Instalacao pronta para exercitar a drenagem chamando `drenar` DIRETO.
 *
 * O manipulador de eventos e sincrono — `receberEvento` sucede,
 * `marcarUltimoEvento`, `drenar`, tudo na mesma pilha —, entao nao existe ponto
 * em que um teste pela biblioteca falsa adquira a trava ENTRE o sucesso e a
 * drenagem. Disputa DURANTE a drenagem so e alcancavel por aqui.
 *
 * Mora em `ajuda/` porque dois arquivos de teste precisam dela: o da drenagem
 * (#842) e o da vigilancia de correspondencia (#775), que mede o que acontece
 * com a serie quando um lote derrama e depois drena.
 */
export async function paraDrenar(): Promise<{
  raiz: string;
  id: string;
  acervo: Acervo;
  caminho: string;
  cfg: { id: string; fonte: 'whatsapp' };
  limpar: () => void;
}> {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Chirrut' });
  const cfg = resolverConfiguracao(registro, id, 'whatsapp', 'teste');
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), id);
  return {
    raiz,
    id,
    acervo,
    caminho: caminhosDaConta(raiz, 'drena').derrame,
    cfg: { id: cfg.id, fonte: 'whatsapp' },
    limpar: (): void => {
      acervo.fechar();
      limpar();
    },
  };
}
