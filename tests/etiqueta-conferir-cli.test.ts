import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarEtiqueta, registrarIdentificador } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { umaColetiva } from './ajuda/etiqueta.js';

test('pessoa conferir MEDE a etiqueta do mesmo evento sob duas formas, e a medicao nao muda o codigo de saida', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const id = criarInquilino(registro, { titularNome: 'Padme' });
    registro.fechar();
    const acervo = abrirAcervo(join(raiz, 'acervos'), id);
    try {
      const conversa = umaColetiva(acervo);
      const lid = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '109876543210987@lid' }).id;
      const tel = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' }).id;
      for (const quem of [lid, tel]) {
        registrarEtiqueta(acervo, {
          conversaId: conversa, identificadorId: quem, texto: 'Torre A',
          ocorridaEm: Date.parse('2026-10-05T15:00:00Z'), fonte: 'whatsapp', idExterno: 'EV1',
        });
      }
      aprenderCorrespondencia(acervo, {
        fonte: 'whatsapp', alternativo: '109876543210987@lid', canonico: '5565911110001@s.whatsapp.net',
      });
    } finally {
      acervo.fechar();
    }
    const r = rodar(raiz, ['pessoa', 'conferir', '--inquilino', id]);
    assert.equal(r.codigo, 0, 'medicao de consequencia conhecida nao reprova o gate');
    assert.match(r.saida, /Etiquetas do mesmo evento sob duas formas de endereco: 1/);
  } finally {
    limpar();
  }
});
