import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ler = (...partes: string[]): string => readFileSync(join(RAIZ, ...partes), 'utf8');

// Regra do repo: implementacao que contradiz GLOSSARIO.md ou docs/dominio/ atualiza o doc. O par da forma opaca na Conversa
// direta (#1439) muda o que `identificar` e `--remetente` alcancam e congela a Conversa opaca: os documentos tem de dizer.
test('o glossario tem o verbete da Correspondencia de endereco, com as duas formas e sem o vocabulario de Adaptador', () => {
  const texto = ler('GLOSSARIO.md');
  const ini = texto.indexOf('**Correspondência de endereço**:');
  assert.ok(ini >= 0, 'falta o verbete');
  const verbete = texto.slice(ini, texto.indexOf('\n\n', ini));
  for (const termo of ['**forma alternativa**', '**forma canônica**', 'endereço opaco', 'nono dígito', '**Conversa partida**']) {
    assert.ok(verbete.includes(termo), `o verbete nao diz ${termo}`);
  }
  const corpo = verbete.split('\n*Evitar*')[0] as string;
  assert.ok(!/\b(jid|lid|senderPn)\b/i.test(corpo), 'o corpo do verbete usa vocabulario de Adaptador');
  assert.ok(!/\btelefone\b/i.test(corpo), 'o corpo do verbete usa "telefone", que o glossario manda evitar');
});

test('o modelo de dominio diz que so a Mensagem recebida ensina e que a Conversa opaca congela', () => {
  const texto = ler('docs', 'dominio', 'malote.md');
  assert.ok(texto.includes('### aprender-pares-da-conversa-direta'), 'falta a operacao do estoque');
  assert.ok(texto.includes('e só pela Mensagem RECEBIDA (#1439)'), 'falta a regra da recepcao');
  assert.ok(texto.includes('**Conversa partida**'), 'falta a Conversa partida');
});

test('as invariantes de identidade dizem o que o desfazer do estoque nao cobre', () => {
  const texto = ler('docs', 'explicacoes', 'invariantes-de-identidade-nome-e-catalogo.md');
  assert.ok(texto.includes('o `desfazer` remove as duas, mas não é volta'), 'falta o limite do desfazer');
  assert.ok(texto.includes('Ao vivo, o par só abre Operação quando é novo.'), 'falta o pre-filtro');
});

test('as invariantes da recepcao dizem que a Edicao compara o endereco resolvido dos dois lados', () => {
  const texto = ler('docs', 'explicacoes', 'invariantes-da-recepcao-e-do-ouvinte.md');
  assert.ok(texto.includes('pelo endereço **resolvido** dos dois lados'), 'falta a frase nova da Edicao');
  assert.ok(!texto.includes('do envelope contra o gravado da original'), 'a frase antiga da Edicao continua la');
});

// "contato" esta no *Evitar* de Pessoa; o texto novo diz "quem fala" ou "o outro lado". "Contato Compartilhado" e outro termo,
// e o nome do comando da uniao (#1440, fixado no contrato dos planos) e identificador, nao prosa: os dois saem antes da busca.
const semContato = (trecho: string, onde: string): void => {
  const achados =
    trecho
      .replace(/Contatos? Compartilhados?/g, '')
      .replace(/unir-conversas-do-contato/g, '')
      .match(/\bcontatos?\b/gi) ?? [];
  assert.equal(achados.length, 0, `${onde} usa "contato", que o glossario manda evitar`);
};
const entre = (texto: string, de: string, ate: string): string => {
  const i = texto.indexOf(de);
  assert.ok(i >= 0, `falta o trecho que comeca em ${de}`);
  const j = texto.indexOf(ate, i + de.length);
  return texto.slice(i, j < 0 ? undefined : j);
};

test('os textos novos nao usam "contato" (#1439)', () => {
  const g = ler('GLOSSARIO.md');
  semContato(entre(g, '**Correspondência de endereço**:', '\n\n'), 'o verbete');
  const d = ler('docs', 'dominio', 'malote.md');
  semContato(entre(d, '- **A Conversa direta por endereço opaco aprende', '\n- '), 'a regra da recepcao');
  semContato(entre(d, '### aprender-pares-da-conversa-direta', '\n### '), 'a operacao do estoque');
  const i = ler('docs', 'explicacoes', 'invariantes-de-identidade-nome-e-catalogo.md');
  semContato(entre(i, '- **O par da forma opaca na Conversa direta', '- **"Comparar dígitos'), 'as invariantes');
  semContato(ler('docs', 'decisoes', '20261108-par-da-conversa-direta-pelo-campo-do-companheiro.md'), 'a ADR');
  const c = ler('CHANGELOG.md');
  semContato(entre(c, 'Quem fala por endereço opaco numa Conversa direta se acha', '\n## ['), 'o CHANGELOG');
});

test('o verbete quebra em linhas de ate ~100 colunas, como os vizinhos', () => {
  const g = ler('GLOSSARIO.md');
  const v = entre(g, '**Correspondência de endereço**:', '\n\n');
  for (const linha of v.split('\n')) assert.ok(linha.length <= 110, `linha de ${linha.length} colunas no verbete`);
});

test('as referencias de identificar e --remetente dizem que o numero alcanca o endereco opaco depois do par', () => {
  assert.ok(ler('docs', 'referencias', 'comandos-modo-cliente.md').includes('também se acha pelo número'));
  assert.ok(ler('docs', 'guias', 'cliente-e-agente.md').includes('se acha também pelo número'));
});
