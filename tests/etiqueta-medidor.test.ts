import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { umaColetiva } from './ajuda/etiqueta.js';
import { registrarEtiqueta, registrarIdentificador } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { conferirEtiquetasRepetidas } from '../src/nucleo/integridade.js';

const T0 = Date.parse('2026-10-05T15:00:00Z');
const LID = '109876543210987@lid';
const TEL = '5565911110001@s.whatsapp.net';

function evento(conversaId: string, identificadorId: string, texto: string, idExterno: string) {
  return { conversaId, identificadorId, texto, ocorridaEm: T0, fonte: 'whatsapp' as const, idExterno };
}

test('o MESMO evento sob as duas formas do mesmo membro e contado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const lid = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: LID }).id;
    const tel = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: TEL }).id;
    registrarEtiqueta(acervo, evento(conversa, lid, 'Torre A', 'EV1'));
    registrarEtiqueta(acervo, evento(conversa, tel, 'Torre A', 'EV1'));
    // Sem o par conhecido o medidor nao tem como relacionar as duas formas: zero.
    assert.equal(conferirEtiquetasRepetidas(acervo), 0);
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: TEL });
    assert.equal(conferirEtiquetasRepetidas(acervo), 1);
  } finally {
    c.limpar();
  }
});

test('membros DISTINTOS com o mesmo texto no mesmo instante nao sao contados como repetidas', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const a = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110001@s.whatsapp.net' }).id;
    const b = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110002@s.whatsapp.net' }).id;
    // O caso normal: um admin coloca "Equipe" em dois membros no mesmo segundo.
    registrarEtiqueta(acervo, evento(conversa, a, 'Equipe', 'EV-A'));
    registrarEtiqueta(acervo, evento(conversa, b, 'Equipe', 'EV-B'));
    assert.equal(conferirEtiquetasRepetidas(acervo), 0);
  } finally {
    c.limpar();
  }
});
