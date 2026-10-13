import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lerCartaoAoVivo,
  lerCartoesDoBackup,
  SEPARADOR_DE_CARTOES,
  SEPARADOR_DE_NOMES,
} from '../src/adaptadores/whatsapp/contato-compartilhado.js';

// Tudo sintetico: nomes, numeros e e-mails inventados. A forma (3.0, LF, `waid`, rotulos de
// grupo, nome vazio com organizacao, foto dobrada) e a medida no Acervo real em 13/10/2026.

const ANA = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:;Ana Souza;;;',
  'FN:Ana Souza',
  'ORG:Eletrica Souza;',
  'TEL;type=CELL;type=VOICE;waid=5565999991234:+55 65 99999-1234',
  'item1.TEL:+55 65 3333-4444',
  'item1.X-ABLabel:_$!<Work>!$_',
  'EMAIL;type=INTERNET:ana@exemplo.com',
  'END:VCARD',
].join('\n');

test('cartao completo: nome, organizacao, telefones com e sem waid, rotulo de grupo e e-mail', () => {
  const r = lerCartoesDoBackup(ANA, 'Ana Souza');
  assert.equal(r.recusados, 0);
  assert.equal(r.cartoes.length, 1);
  const c = r.cartoes[0]!;
  assert.equal(c.nome, 'Ana Souza');
  assert.equal(c.organizacao, 'Eletrica Souza');
  assert.equal(c.nomeComercial, null);
  assert.deepEqual(c.valores, [
    { tipo: 'telefone', texto: '+55 65 99999-1234', digitos: '5565999991234', rotulo: 'cell' },
    { tipo: 'telefone', texto: '+55 65 3333-4444', digitos: '556533334444', rotulo: 'work' },
    { tipo: 'email', texto: 'ana@exemplo.com', digitos: null, rotulo: null },
  ]);
  assert.deepEqual(r.nomesPorRecurso, { 'nome-de-exibicao': 1 });
});

test('o waid manda nos digitos mesmo quando o texto digitado e outro', () => {
  const v = 'BEGIN:VCARD\nVERSION:3.0\nFN:Beto\nTEL;waid=5511988887777:(11) 98888-7777\nEND:VCARD';
  const c = lerCartoesDoBackup(v, '').cartoes[0]!;
  assert.equal(c.valores[0]?.digitos, '5511988887777');
  assert.equal(c.valores[0]?.texto, '(11) 98888-7777');
});

test('sem waid, so os digitos que estao no texto: nenhum codigo de pais e inferido', () => {
  const v = 'BEGIN:VCARD\nVERSION:3.0\nFN:Beto\nTEL:(11) 98888-7777\nTEL:ramal\nEND:VCARD';
  const c = lerCartoesDoBackup(v, '').cartoes[0]!;
  assert.equal(c.valores[0]?.digitos, '11988887777');
  assert.equal(c.valores[1]?.texto, 'ramal');
  assert.equal(c.valores[1]?.digitos, null, 'texto sem digito nao inventa digitos');
});

test('cartao sem telefone e valido', () => {
  const v = 'BEGIN:VCARD\nVERSION:3.0\nFN:Sem Telefone\nEND:VCARD';
  const r = lerCartoesDoBackup(v, '');
  assert.equal(r.cartoes[0]?.nome, 'Sem Telefone');
  assert.deepEqual(r.cartoes[0]?.valores, []);
});

test('o backup guarda varios cartoes separados por um marcador, e cada um vira um cartao', () => {
  const dois = [ANA, 'BEGIN:VCARD\nVERSION:3.0\nFN:Beto\nTEL:11999990000\nEND:VCARD'].join(SEPARADOR_DE_CARTOES);
  const nomes = ['Ana Souza', 'Beto'].join(SEPARADOR_DE_NOMES);
  const r = lerCartoesDoBackup(dois, nomes);
  assert.deepEqual(r.cartoes.map((c) => c.nome), ['Ana Souza', 'Beto']);
  assert.equal(r.recusados, 0);
});

test('nome de exibicao vazio: usa a organizacao', () => {
  const v = 'BEGIN:VCARD\nVERSION:3.0\nN:;;;;\nFN:\nORG:Pizzaria do Ze;\nTEL:11999990000\nEND:VCARD';
  const r = lerCartoesDoBackup(v, '');
  assert.equal(r.cartoes[0]?.nome, 'Pizzaria do Ze');
  assert.equal(r.cartoes[0]?.organizacao, 'Pizzaria do Ze');
  assert.deepEqual(r.nomesPorRecurso, { organizacao: 1 });
});

test('sem nome de exibicao nem organizacao: usa o nome comercial do WhatsApp', () => {
  const v = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nX-WA-BIZ-NAME:Loja Azul\nTEL:11999990000\nEND:VCARD';
  const r = lerCartoesDoBackup(v, '');
  assert.equal(r.cartoes[0]?.nome, 'Loja Azul');
  assert.equal(r.cartoes[0]?.nomeComercial, 'Loja Azul');
  assert.deepEqual(r.nomesPorRecurso, { 'nome-comercial': 1 });
});

test('backup: sem nome no cartao, o nome separado serve SO quando alinha com os cartoes', () => {
  const sem = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nTEL:11999990000\nEND:VCARD';
  const alinhado = lerCartoesDoBackup(sem, 'Fulano de Tal');
  assert.equal(alinhado.cartoes[0]?.nome, 'Fulano de Tal');
  assert.deepEqual(alinhado.nomesPorRecurso, { 'nome-separado-do-backup': 1 });

  // Dois nomes para um cartao: desalinhado, e a posicao pode ser de OUTRO cartao.
  const desalinhado = lerCartoesDoBackup(sem, ['Fulano', 'Sicrano'].join(SEPARADOR_DE_NOMES));
  assert.equal(desalinhado.cartoes.length, 0);
  assert.equal(desalinhado.recusados, 1);
});

test('sem nome por caminho nenhum, o cartao e recusado e contado', () => {
  const sem = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nTEL:11999990000\nEND:VCARD';
  const r = lerCartoesDoBackup(sem, '');
  assert.deepEqual(r.cartoes, []);
  assert.equal(r.recusados, 1);
});

test('ao vivo: o nome de exibicao do evento e o ultimo recurso, de cartao unico', () => {
  const sem = 'BEGIN:VCARD\nVERSION:3.0\nFN:\nTEL:11999990000\nEND:VCARD';
  const r = lerCartaoAoVivo(sem, 'Nome do Evento');
  assert.equal(r.cartoes[0]?.nome, 'Nome do Evento');
  assert.deepEqual(r.nomesPorRecurso, { 'nome-do-evento': 1 });
  assert.equal(lerCartaoAoVivo(sem, undefined).recusados, 1);
});

test('ao vivo: o FN do cartao vence o nome de exibicao do evento', () => {
  const r = lerCartaoAoVivo(ANA, 'Outro Nome');
  assert.equal(r.cartoes[0]?.nome, 'Ana Souza');
});

test('foto embutida e linha dobrada nao viram valor nem derrubam a leitura', () => {
  const v = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Com Foto',
    'PHOTO;BASE64:/9j/4AAQSkZJRgABAQ',
    ' EAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '  AAAAAAAAAAAA',
    'TEL:11999990000',
    'NOTE:linha longa que foi',
    '  dobrada pelo exportador',
    'END:VCARD',
  ].join('\n');
  const r = lerCartoesDoBackup(v, '');
  assert.equal(r.cartoes[0]?.nome, 'Com Foto');
  assert.equal(r.cartoes[0]?.valores.length, 1);
  assert.equal(JSON.stringify(r.cartoes[0]).includes('9j/4AAQ'), false, 'a foto nao pode vazar para a tabela');
});

test('escapes do vCard: virgula, ponto e virgula e barra voltam ao texto', () => {
  const v = 'BEGIN:VCARD\nVERSION:3.0\nFN:Souza\\, Ana\nORG:Casa\\; Cia;Depto\nTEL:11999990000\nEND:VCARD';
  const c = lerCartoesDoBackup(v, '').cartoes[0]!;
  assert.equal(c.nome, 'Souza, Ana');
  assert.equal(c.organizacao, 'Casa; Cia', 'a organizacao e o primeiro componente');
});

test('fim de linha CRLF e aceito', () => {
  const v = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Com CRLF\r\nTEL:11999990000\r\nEND:VCARD\r\n';
  assert.equal(lerCartoesDoBackup(v, '').cartoes[0]?.nome, 'Com CRLF');
});

test('vCard 2.1 com parametro solto e aceito', () => {
  const v = 'BEGIN:VCARD\nVERSION:2.1\nFN:Antigo\nTEL;CELL;PREF:11999990000\nEND:VCARD';
  assert.equal(lerCartoesDoBackup(v, '').cartoes[0]?.valores[0]?.rotulo, 'cell');
});

test('texto ilegivel ou truncado e recusado e contado, e a leitura nunca lanca', () => {
  for (const ruim of ['nao e vcard', 'BEGIN:VCARD\nFN:Truncado\nTEL:1199999', '', '   ']) {
    const r = lerCartoesDoBackup(ruim, '');
    assert.deepEqual(r.cartoes, [], ruim);
    assert.equal(r.recusados, ruim.trim() === '' ? 0 : 1, ruim);
  }
  assert.doesNotThrow(() => lerCartaoAoVivo(undefined as unknown as string, undefined));
});

test('linha dobrada no meio de um telefone volta a ser uma linha so', () => {
  const v = 'BEGIN:VCARD\nVERSION:3.0\nFN:Dobrado\nTEL;waid=5511999990000:+55 11 99999\n -0000\nEND:VCARD';
  const c = lerCartoesDoBackup(v, '').cartoes[0]!;
  assert.equal(c.valores[0]?.texto, '+55 11 99999-0000');
  assert.equal(c.valores[0]?.digitos, '5511999990000');
});
