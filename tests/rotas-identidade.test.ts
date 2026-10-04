import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subirCenaDeIdentidade, ANA, BRUNO, BRUNO_LID } from './ajuda/identidade.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const j = (corpo: string): any => JSON.parse(corpo);

test('GET /identificadores devolve o Identificador sem Pessoa, os nomes com origem e as formas (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const r = await cena.pedir(`/identificadores?valor=${encodeURIComponent(BRUNO_LID)}`, cena.chave.valor);
    assert.equal(r.status, 200);
    const corpo = j(r.corpo);
    assert.equal(corpo.identificadores.length, 1);
    assert.equal(corpo.identificadores[0].valor, BRUNO);
    assert.equal(corpo.identificadores[0].pessoaId, null);
    assert.equal(corpo.identificadores[0].nome, 'Bruno Contato');
    assert.equal(corpo.identificadores[0].origemDoNome, 'contatos');
    assert.deepEqual(
      corpo.formas.map((f: { valor: string; identificador: string | null }) => [f.valor, f.identificador === null]).sort(),
      [
        [BRUNO, false],
        [BRUNO_LID, true],
      ].sort(),
    );
  } finally {
    cena.encerrar();
  }
});

test('valor desconhecido e 200 com listas vazias; sem valor e 400; fonte invalida e 400 (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const nunca = await cena.pedir('/identificadores?valor=000%40lid', cena.chave.valor);
    assert.equal(nunca.status, 200);
    assert.deepEqual(j(nunca.corpo).identificadores, []);
    assert.equal((await cena.pedir('/identificadores', cena.chave.valor)).status, 400);
    assert.equal((await cena.pedir('/identificadores?valor=', cena.chave.valor)).status, 400);
    assert.equal((await cena.pedir('/identificadores?valor=x&fonte=nao-existe', cena.chave.valor)).status, 400);
    assert.equal((await cena.pedir(`/identificadores?valor=${encodeURIComponent(ANA)}`)).status, 401);
  } finally {
    cena.encerrar();
  }
});

test('o Inquilino vem da Chave: o mesmo valor em dois Inquilinos devolve, a cada chave, so o dele (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const dele = j((await cena.pedir(`/identificadores?valor=${encodeURIComponent(BRUNO)}`, cena.chaveDoOutro.valor)).corpo);
    assert.equal(dele.identificadores[0].nome, 'Intruso');
    const nosso = j((await cena.pedir(`/identificadores?valor=${encodeURIComponent(BRUNO)}`, cena.chave.valor)).corpo);
    assert.equal(nosso.identificadores[0].nome, 'Bruno Contato');
    assert.ok(!JSON.stringify(nosso).includes('Intruso'));
    // `?inquilino=` nao muda nada: o alcance e o da credencial.
    const tentativa = j(
      (
        await cena.pedir(
          `/identificadores?valor=${encodeURIComponent(BRUNO)}&inquilino=${cena.inquilinoId}`,
          cena.chaveDoOutro.valor,
        )
      ).corpo,
    );
    assert.equal(tentativa.identificadores[0].nome, 'Intruso');
  } finally {
    cena.encerrar();
  }
});

test('participantes traz valor, nome, origemDoNome e pessoaId, e o envoltorio de antes (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const r = await cena.pedir(`/conversas/${cena.s.grupo}/participantes`, cena.chave.valor);
    assert.equal(r.status, 200);
    const p = j(r.corpo).presenca;
    assert.equal(p.conversaId, cena.s.grupo);
    assert.ok(p.ressalva.semInformacaoNaoEAusencia);
    const todos = [...p.presentes, ...p.sairamAntes, ...p.aindaNaoEntraram, ...p.semInformacao];
    assert.equal(todos.length, 3, 'a fixture produz os tres participantes');
    const ana = todos.find((x: { valor: string }) => x.valor === ANA);
    assert.deepEqual([ana.nome, ana.origemDoNome, ana.pessoaId], ['Ana WhatsApp', 'whatsapp', cena.s.pessoaDeAna]);
    assert.ok(ana.identificadorId, 'o campo antigo segue presente');
    assert.ok(ana.situacao);
  } finally {
    cena.encerrar();
  }
});

test('conversas traz nome e origemDoNome nas diretas; --busca acha pelo nome; sem busca o conjunto e o mesmo (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const todas = j((await cena.pedir('/conversas', cena.chave.valor)).corpo).conversas;
    assert.equal(todas.length, 4, 'a fixture produz as quatro Conversas');
    const bruno = todas.find((c: { id: string }) => c.id === cena.s.diretaDeBruno);
    assert.deepEqual([bruno.nome, bruno.origemDoNome], ['Bruno Contato', 'contatos']);
    assert.ok('assunto' in bruno && 'mensagens' in bruno && 'configuracao' in bruno, 'campos antigos');
    const grupo = todas.find((c: { id: string }) => c.id === cena.s.grupo);
    assert.deepEqual([grupo.nome, grupo.origemDoNome], [null, null]);
    const achadas = j((await cena.pedir('/conversas?busca=silva', cena.chave.valor)).corpo).conversas;
    assert.deepEqual(
      achadas.map((c: { id: string }) => c.id),
      [cena.s.diretaDeBruno],
    );
  } finally {
    cena.encerrar();
  }
});

test('as tres leituras nao gravam Operacao (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const antes = cena.operacoes();
    await cena.pedir(`/identificadores?valor=${encodeURIComponent(BRUNO)}`, cena.chave.valor);
    await cena.pedir(`/conversas/${cena.s.grupo}/participantes`, cena.chave.valor);
    await cena.pedir('/conversas?busca=bruno', cena.chave.valor);
    assert.equal(cena.operacoes(), antes);
  } finally {
    cena.encerrar();
  }
});

test('--fonte restringe a busca por rede, e uma Fonte sem o valor devolve vazio (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const valor = encodeURIComponent(BRUNO);
    const certa = j((await cena.pedir(`/identificadores?valor=${valor}&fonte=whatsapp`, cena.chave.valor)).corpo);
    assert.equal(certa.identificadores.length, 1);
    assert.equal(certa.consultado.fonte, 'whatsapp');
    const outra = j((await cena.pedir(`/identificadores?valor=${valor}&fonte=instagram`, cena.chave.valor)).corpo);
    assert.deepEqual(outra.identificadores, []);
    assert.deepEqual(outra.formas, []);
  } finally {
    cena.encerrar();
  }
});
