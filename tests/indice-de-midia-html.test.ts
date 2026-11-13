import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escaparHtml, linkDoDrive, montarHtmlDoIndice, tamanhoLegivel, type LinhaDoIndice } from '../src/cli/indice-de-midia-html.js';

const base: LinhaDoIndice = { rotulo: '20260901-001-ana', tipo: 'image', tamanho: 2048, situacao: 'no-remoto', idNoRemoto: '1AbCdEfGhIjKlMnOp' };

test('o link e o endereco de visualizacao do Drive pelo id, com rel de seguranca', () => {
  const html = montarHtmlDoIndice('ana', [base]);
  assert.match(html, /<a href="https:\/\/drive\.google\.com\/file\/d\/1AbCdEfGhIjKlMnOp\/view" rel="noopener noreferrer">abrir<\/a>/);
  assert.match(html, /<td>20260901-001-ana<\/td><td>image<\/td><td>2\.0 KiB<\/td>/);
});

test('id que nao tem a forma de um id nunca vira URL; o texto e escapado', () => {
  assert.equal(linkDoDrive('x" onclick="alert(1)'), undefined);
  assert.equal(linkDoDrive('curto'), undefined);
  const html = montarHtmlDoIndice('<b>&"\'', [{ ...base, rotulo: '<script>alert(1)</script>', tipo: '"><img src=x>', idNoRemoto: 'javascript:alert(1)' }]);
  assert.ok(!html.includes('<script>'), 'o rotulo e escapado');
  assert.ok(!html.includes('<img'), 'o tipo e escapado');
  assert.ok(!/href="javascript/.test(html), 'o id estranho nao vira link');
  assert.equal(escaparHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

test('cada situacao sem link diz o que e, e o HTML nao leva instante de geracao, script nem imagem', () => {
  const situacoes = ['pendente-de-envio', 'so-no-disco', 'nao-obtido', 'descartado', 'no-remoto-sem-link'] as const;
  const html = montarHtmlDoIndice('x', situacoes.map((s) => ({ ...base, situacao: s, idNoRemoto: null })));
  for (const t of ['pendente de envio', 'so no disco', 'nao obtido', 'descartado', 'sem link']) assert.ok(html.includes(t), t);
  assert.ok(!/<script|<img|<link /i.test(html));
  assert.equal(montarHtmlDoIndice('x', [base]), montarHtmlDoIndice('x', [base]), 'determinista');
  assert.match(html, /dado pessoal/);
});

test('tamanho legivel nao depende de locale', () => {
  assert.deepEqual([0, 1023, 1024, 1536, 5 * 1024 * 1024, null].map(tamanhoLegivel), ['0 B', '1023 B', '1.0 KiB', '1.5 KiB', '5.0 MiB', '']);
});
