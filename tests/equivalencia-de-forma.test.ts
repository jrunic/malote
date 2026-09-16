import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { criarAcervoNoPiso } from './ajuda/acervo-no-piso.js';
import { criarRegistroNoPiso } from './ajuda/registro-no-piso.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { lerForma } from './ajuda/forma.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('Acervo MIGRADO por passos tem a mesma forma do criado do zero', () => {
  const c = cenario();
  try {
    const doZero = c.novoInquilino('Padme').acervo;
    const formaDoZero = lerForma(doZero.db);
    doZero.fechar();

    const { id, acervo } = c.novoInquilino('Bail');
    acervo.fechar();
    criarAcervoNoPiso(c.raiz, id);

    const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
    try {
      // Comparacao por ESTRUTURA. O texto do CREATE difere de proposito: o
      // passo guarda a forma congelada, e o schema fresco tem IF NOT EXISTS.
      //
      // Este e o guardiao estrutural da maquina de migracao. Criacao nova vem
      // do schema fresco; base existente vem da cadeia de passos. As duas
      // podem divergir sem que nada mais acuse — e a divergencia aparece meses
      // depois, como coluna que existe numa instalacao e nao noutra.
      assert.deepEqual(lerForma(migrado.db), formaDoZero);
    } finally {
      migrado.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('Registro MIGRADO por passos tem a mesma forma do criado do zero', () => {
  const doZero = instalacaoTemporaria();
  const migradoRaiz = instalacaoTemporaria();
  try {
    const fresco = abrirRegistro(doZero.raiz);
    const formaDoZero = lerForma(fresco.db);
    fresco.fechar();

    criarRegistroNoPiso(migradoRaiz.raiz);
    const migrado = abrirRegistro(migradoRaiz.raiz);
    try {
      // Espelho do teste do Acervo, e pela mesma razao: as duas bases usam a
      // mesma maquina, entao as duas correm o mesmo risco de a cadeia de
      // passos divergir do schema fresco sem que nada acuse.
      assert.deepEqual(lerForma(migrado.db), formaDoZero);
    } finally {
      migrado.fechar();
    }
  } finally {
    doZero.limpar();
    migradoRaiz.limpar();
  }
});
