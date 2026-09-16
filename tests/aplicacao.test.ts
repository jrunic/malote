import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { aplicarConjunto, desfazerAplicacao } from '../src/nucleo/aplicacao.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  lerVinculo,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import { familiaDe, mestreDe } from '../src/nucleo/familia.js';

const AGORA = Date.parse('2026-08-29T12:00:00Z');

test('conjunto todo solto: cria UMA Pessoa e vincula com procedência catalogo', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });

  const r = aplicarConjunto(acervo, [a, b], { quando: AGORA });
  assert.equal(r.pessoasCriadas.length, 1);
  assert.equal(r.vinculos.length, 2);
  assert.equal(r.mesclagens.length, 0);
  assert.equal(lerVinculo(acervo, a)?.procedencia, 'catalogo');
  assert.equal(mestreDe(acervo, r.pessoasCriadas[0] as string), r.pessoasCriadas[0]);
  c.limpar();
});

test('um lado já tem Pessoa: o outro entra nela, sem criar nada', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000001' });
  const p = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: p, procedencia: 'material' });

  const r = aplicarConjunto(acervo, [a, b], { quando: AGORA });
  assert.deepEqual(r.pessoasCriadas, []);
  assert.equal(r.vinculos.length, 1);
  assert.equal(lerVinculo(acervo, b)?.pessoaId, p);
  c.limpar();
});

test('Pessoas distintas de procedência automática: MESCLA, e o ato fica', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-b' });
  const pA = criarPessoa(acervo);
  const pB = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: pA, procedencia: 'material' });
  vincularIdentificador(acervo, { identificadorId: b, pessoaId: pB, procedencia: 'material' });

  const r = aplicarConjunto(acervo, [a, b], { quando: AGORA });
  assert.equal(r.mesclagens.length, 1);
  assert.equal(mestreDe(acervo, pA), mestreDe(acervo, pB));
  const atos = (
    acervo.db.prepare("SELECT COUNT(*) AS n FROM atos_de_mesclagem WHERE tipo = 'mesclagem'").get() as {
      n: number;
    }
  ).n;
  assert.equal(atos, 1);
  c.limpar();
});

test('vínculo humano separando as duas: RECUSA, e nada é escrito', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000001' });
  const pA = criarPessoa(acervo);
  const pB = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: pA, procedencia: 'humano' });
  vincularIdentificador(acervo, { identificadorId: b, pessoaId: pB, procedencia: 'catalogo' });

  const r = aplicarConjunto(acervo, [a, b], { quando: AGORA });
  assert.equal(r.preservadoPorProcedencia, 1);
  assert.equal(r.mesclagens.length, 0);
  assert.equal(r.vinculos.length, 0);
  assert.notEqual(mestreDe(acervo, pA), mestreDe(acervo, pB));
  assert.match(r.motivo ?? '', /humano/);
  c.limpar();
});

test('vínculo humano FORA do conjunto também recusa — a checagem é da família', () => {
  // O flanco que a checagem por membro deixaria passar: a Pessoa foi feita a
  // mao por I1 e ampliada por um lote anterior; a Proposta nova cita so I2.
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: i1 } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: i2 } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000002' });
  const { id: j } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-j' });
  const pHumana = criarPessoa(acervo);
  const pOutra = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: i1, pessoaId: pHumana, procedencia: 'humano' });
  vincularIdentificador(acervo, { identificadorId: i2, pessoaId: pHumana, procedencia: 'catalogo' });
  vincularIdentificador(acervo, { identificadorId: j, pessoaId: pOutra, procedencia: 'material' });

  // Nenhum MEMBRO da Proposta tem procedencia humano.
  const r = aplicarConjunto(acervo, [i2, j], { quando: AGORA });
  assert.equal(r.preservadoPorProcedencia, 1);
  assert.equal(r.mesclagens.length, 0);
  assert.notEqual(mestreDe(acervo, pHumana), mestreDe(acervo, pOutra));
  c.limpar();
});

test('vínculo humano numa Pessoa SÓ: não é conflito, o solto entra nela', () => {
  // Nada e rebaixado — o vinculo humano continua humano, e o endereco solto
  // ganha o dele com procedencia catalogo.
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000001' });
  const p = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: p, procedencia: 'humano' });

  const r = aplicarConjunto(acervo, [a, b], { quando: AGORA });
  assert.equal(r.preservadoPorProcedencia, 0);
  assert.equal(r.vinculos.length, 1);
  assert.equal(lerVinculo(acervo, a)?.procedencia, 'humano');
  assert.equal(lerVinculo(acervo, b)?.procedencia, 'catalogo');
  c.limpar();
});

test('a preferência de catálogo escolhe a mestre — a regra do ciclo 6, enfim exercida', () => {
  // O ciclo 6 embarcou `preferencia-de-catalogo` consultando fonte='contatos',
  // uma Fonte que so passou a existir no ciclo 7. Aqui ela roda pela primeira
  // vez contra dado real, e a ordem dos argumentos NAO pode decidir.
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: doWhats } = registrarIdentificador(acervo, {
    fonte: 'whatsapp',
    valor: '5511900000001',
  });
  const { id: doCat } = registrarIdentificador(acervo, {
    fonte: 'contatos',
    valor: '5511900000002',
  });
  const pWhats = criarPessoa(acervo);
  const pCat = criarPessoa(acervo);
  vincularIdentificador(acervo, {
    identificadorId: doWhats,
    pessoaId: pWhats,
    procedencia: 'material',
  });
  vincularIdentificador(acervo, {
    identificadorId: doCat,
    pessoaId: pCat,
    procedencia: 'catalogo',
  });

  const r = aplicarConjunto(acervo, [doWhats, doCat], { quando: AGORA });
  assert.equal(r.mesclagens[0]?.regra, 'preferencia-de-catalogo');
  assert.equal(r.mesclagens[0]?.mestreId, pCat);
  assert.equal(mestreDe(acervo, pWhats), pCat);
  c.limpar();
});

test('a ordem dos argumentos NÃO decide a mestre quando há catálogo', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: doWhats } = registrarIdentificador(acervo, {
    fonte: 'whatsapp',
    valor: '5511900000001',
  });
  const { id: doCat } = registrarIdentificador(acervo, {
    fonte: 'contatos',
    valor: '5511900000002',
  });
  const pWhats = criarPessoa(acervo);
  const pCat = criarPessoa(acervo);
  vincularIdentificador(acervo, {
    identificadorId: doWhats,
    pessoaId: pWhats,
    procedencia: 'material',
  });
  vincularIdentificador(acervo, {
    identificadorId: doCat,
    pessoaId: pCat,
    procedencia: 'catalogo',
  });

  // Ordem invertida em relacao ao teste anterior.
  const r = aplicarConjunto(acervo, [doCat, doWhats], { quando: AGORA });
  assert.equal(r.mesclagens[0]?.mestreId, pCat);
  c.limpar();
});

test('a mestre alcança as Mensagens das duas — família de um salto', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-b' });
  const pA = criarPessoa(acervo);
  const pB = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: pA, procedencia: 'material' });
  vincularIdentificador(acervo, { identificadorId: b, pessoaId: pB, procedencia: 'material' });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: a, origem: 'whatsapp', nome: 'A' });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: b, origem: 'instagram', nome: 'B' });

  aplicarConjunto(acervo, [a, b], { quando: AGORA });
  const mestre = mestreDe(acervo, pA) as string;
  assert.equal(familiaDe(acervo, mestre).length, 2);
  c.limpar();
});

test('desfazer devolve vínculos e mesclagens, e a trilha só cresce', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'perfil-b' });
  const { id: solto } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000001' });
  const pA = criarPessoa(acervo);
  const pB = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: a, pessoaId: pA, procedencia: 'material' });
  vincularIdentificador(acervo, { identificadorId: b, pessoaId: pB, procedencia: 'material' });

  const r = aplicarConjunto(acervo, [a, b, solto], { quando: AGORA });
  assert.equal(r.mesclagens.length, 1);
  assert.equal(r.vinculos.length, 1);

  desfazerAplicacao(acervo, r, { quando: AGORA + 1000 });

  // Vinculo devolvido, mesclagem desfeita.
  assert.equal(lerVinculo(acervo, solto), null);
  assert.notEqual(mestreDe(acervo, pA), mestreDe(acervo, pB));
  // A Pessoa nao perdeu o que tinha.
  assert.equal(lerVinculo(acervo, a)?.pessoaId, pA);
  assert.equal(lerVinculo(acervo, b)?.pessoaId, pB);
  // A trilha CRESCEU: dois atos, um de mesclagem e um de desfazer.
  const atos = (
    acervo.db.prepare('SELECT COUNT(*) AS n FROM atos_de_mesclagem').get() as { n: number }
  ).n;
  assert.equal(atos, 2);
  // E o desvinculo ficou registrado.
  const desv = (
    acervo.db.prepare('SELECT COUNT(*) AS n FROM desvinculos').get() as { n: number }
  ).n;
  assert.equal(desv, 1);
  c.limpar();
});

test('a Pessoa criada pelo lote PERMANECE depois de desfazer — é desenho', () => {
  // `desvincularIdentificador` documenta: a Pessoa permanece, porque e ela
  // que guarda o historico e o registro do que foi desfeito. O criterio 19
  // da spec dizia "volta a contagem de Pessoas"; volta a de VINCULOS.
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: a } = registrarIdentificador(acervo, { fonte: 'contatos', valor: '5511900000001' });
  const { id: b } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511900000001' });

  const r = aplicarConjunto(acervo, [a, b], { quando: AGORA });
  desfazerAplicacao(acervo, r, { quando: AGORA + 1000 });

  const pessoas = (
    acervo.db.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number }
  ).n;
  assert.equal(pessoas, 1);
  const vinculados = (
    acervo.db
      .prepare('SELECT COUNT(*) AS n FROM identificadores WHERE pessoa_id IS NOT NULL')
      .get() as { n: number }
  ).n;
  assert.equal(vinculados, 0);
  c.limpar();
});
