import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-23T12:00:00Z');
const EM_USO = '2021-06-15T10:00:00Z';

test('importar material WhatsApp grava a Direcao a partir de daPropriaPessoa', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '5511900000001@s.whatsapp.net', nome: 'Leia', tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'm-enviada', chatSessionPk: 1, texto: 'oi', dataCoreData: paraCoreData(EM_USO), daPropriaPessoa: true },
      { stanzaId: 'm-recebida', chatSessionPk: 1, texto: 'ola', dataCoreData: paraCoreData(EM_USO), daPropriaPessoa: false },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP, reprocessar: true });

    const linhas = acervo
      .preparar('SELECT id_externo, direcao FROM mensagens ORDER BY id_externo')
      .all() as { id_externo: string; direcao: string }[];
    assert.deepEqual(linhas, [
      { id_externo: 'm-enviada', direcao: 'enviada' },
      { id_externo: 'm-recebida', direcao: 'recebida' },
    ]);
  } finally {
    b.limpar();
    c.limpar();
  }
});
