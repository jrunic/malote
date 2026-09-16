import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { aplicarLote, desfazerLote } from '../src/adaptadores/contatos/lote.js';
import { listarIdentificadores } from '../src/nucleo/inventario.js';
import { propor } from '../src/adaptadores/contatos/propostas.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  lerVinculo,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import { mestreDe } from '../src/nucleo/familia.js';

const AGORA = Date.parse('2026-08-29T12:00:00Z');

function acervoComTresPares(acervo: Parameters<typeof listarIdentificadores>[0]): void {
  for (const n of ['5511900000001', '5511900000002', '5511900000003']) {
    registrarIdentificador(acervo, { fonte: 'contatos', valor: n });
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: n });
  }
}

test('o lote aplica todas as Propostas do produtor e relata', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  acervoComTresPares(acervo);

  const r = aplicarLote(acervo, propor(listarIdentificadores(acervo)), {
    produtor: 'telefone',
    quando: AGORA,
  });
  assert.equal(r.propostasVistas, 3);
  assert.equal(r.aplicadas, 3);
  assert.equal(r.vinculosCriados, 6);
  assert.equal(r.pessoasCriadas, 3);
  assert.equal(r.mesclagensFeitas, 0);
  c.limpar();
});

test('uma recusa NÃO aborta as demais — atômico por Proposta, não por lote', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  acervoComTresPares(acervo);
  // O par do meio fica separado por vinculo humano.
  const inv = listarIdentificadores(acervo);
  const doMeio = inv.filter((i) => i.valor === '5511900000002');
  const pA = criarPessoa(acervo);
  const pB = criarPessoa(acervo);
  vincularIdentificador(acervo, {
    identificadorId: doMeio[0]?.id as string,
    pessoaId: pA,
    procedencia: 'humano',
  });
  vincularIdentificador(acervo, {
    identificadorId: doMeio[1]?.id as string,
    pessoaId: pB,
    procedencia: 'catalogo',
  });

  const r = aplicarLote(acervo, propor(listarIdentificadores(acervo)), {
    produtor: 'telefone',
    quando: AGORA,
  });
  assert.equal(r.propostasVistas, 3);
  assert.equal(r.aplicadas, 2);
  assert.equal(r.preservadoPorProcedencia, 1);
  // Os outros dois pares entraram.
  assert.equal(r.vinculosCriados, 4);
  c.limpar();
});

test('desfazer o lote devolve as duas naturezas', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-b' });
  const { id: k } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000001' });
  const pA = criarPessoa(acervo);
  const pB = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: pA, procedencia: 'material' });
  vincularIdentificador(acervo, { identificadorId: b, pessoaId: pB, procedencia: 'material' });
  // O nome liga k a b pelo produtor de NOME; o telefone liga k a a. Sem estes
  // dois registrarNome, o produtor de nome nao emite e o lote so vincularia —
  // o teste diria "duas naturezas" verificando uma.
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: k, origem: 'contatos', nome: 'Ana Luisa' });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: b, origem: 'instagram', nome: 'Ana Luisa' });

  const r = aplicarLote(acervo, propor(listarIdentificadores(acervo)), { quando: AGORA });
  assert.ok(r.vinculosCriados >= 1, 'o lote precisa ter criado vinculo');
  assert.ok(r.mesclagensFeitas >= 1, 'e precisa ter mesclado');

  desfazerLote(acervo, r, { quando: AGORA + 1000 });

  assert.equal(lerVinculo(acervo, k), null);
  assert.notEqual(mestreDe(acervo, pA), mestreDe(acervo, pB));
  assert.equal(lerVinculo(acervo, a)?.pessoaId, pA);
  assert.equal(lerVinculo(acervo, b)?.pessoaId, pB);
  c.limpar();
});

test('o relatório separa vínculo de mesclagem, porque desfazer é diferente', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: k } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000001' });
  const pA = criarPessoa(acervo);
  const pK = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: pA, procedencia: 'material' });
  vincularIdentificador(acervo, { identificadorId: k, pessoaId: pK, procedencia: 'catalogo' });

  const r = aplicarLote(acervo, propor(listarIdentificadores(acervo)), { quando: AGORA });
  assert.equal(r.mesclagensFeitas, 1);
  assert.equal(r.vinculosCriados, 0);
  c.limpar();
});
