import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const ler = (...partes: string[]): string => readFileSync(join(RAIZ, ...partes), 'utf8');

// Regra do repo: implementacao que contradiz GLOSSARIO.md ou docs/dominio/ atualiza o doc no mesmo commit. A uniao da Conversa
// partida (#1440) desdiz quatro documentos que afirmavam "nao se unem Conversas": este teste fixa que eles mudaram juntos.

const entre = (texto: string, de: string, ate: string): string => {
  const i = texto.indexOf(de);
  assert.ok(i >= 0, `falta o trecho que comeca em ${de}`);
  const j = texto.indexOf(ate, i + de.length);
  return texto.slice(i, j < 0 ? undefined : j);
};
// O nome do comando (fixado no contrato) e "Contato Compartilhado" saem antes; o resto do texto diz "quem fala" ou "o outro lado".
const semContato = (trecho: string, onde: string): void => {
  const limpo = trecho.replace(/Contatos? Compartilhados?/g, '').replace(/unir-conversas-do-contato/g, '');
  assert.equal((limpo.match(/\bcontatos?\b/gi) ?? []).length, 0, `${onde} usa "contato", que o glossario manda evitar`);
};
const ADR_NOVA = ['docs', 'decisoes', '20261109-uniao-da-conversa-partida.md'] as const;
const ADR_ANTIGA = ['docs', 'decisoes', '20261108-par-da-conversa-direta-pelo-campo-do-companheiro.md'] as const;

test('o glossario estende a Conversa partida com a uniao, em verbete proprio e sem vocabulario de Adaptador', () => {
  const g = ler('GLOSSARIO.md');
  const v = entre(g, '**Conversa partida**:', '\n\n');
  assert.ok(g.indexOf('**Correspondência de endereço**:') < g.indexOf('**Conversa partida**:'), 'o verbete vem depois da Correspondencia');
  for (const termo of ['Operação própria', 'mesma Configuração', '**é promovida**', 'conflito', 'Chegada', '`desfazer`']) {
    assert.ok(v.includes(termo), `o verbete nao diz ${termo}`);
  }
  const corpo = v.split('\n*Evitar*')[0] as string;
  assert.ok(!/\b(jid|lid|senderPn|telefone)\b/i.test(corpo), 'o corpo do verbete usa vocabulario de Adaptador');
  assert.ok(!/\buni(ão|ao)\*\*:/i.test(g), 'nasceu um verbete "união" solto');
  semContato(v, 'o verbete');
  for (const linha of v.split('\n')) assert.ok(linha.length <= 100, `linha de ${linha.length} colunas no verbete`);
  const c = entre(g, '**Correspondência de endereço**:', '\n\n');
  assert.ok(!c.includes('Não une Conversas:'), 'a Correspondencia ainda diz que nada une as Conversas');
  assert.ok(c.includes('que só uma Operação própria une'), 'a Correspondencia nao aponta para a uniao');
});

test('o modelo de dominio tem a operacao da uniao e deixou de dizer que ela fica fora do modelo', () => {
  const d = ler('docs', 'dominio', 'malote.md');
  assert.ok(!d.includes('a união das duas fica fora deste modelo'), 'a frase antiga continua no modelo');
  assert.ok(d.includes('A recepção nunca une as duas'), 'falta a regra da recepcao');
  const op = entre(d, '### unir-conversas-do-contato', '\n## ');
  assert.ok(d.indexOf('### aprender-pares-da-conversa-direta') < d.indexOf('### unir-conversas-do-contato'), 'fora de ordem');
  for (const termo of ['**na mesma Configuração**', '**move**', '**promove**', '`alvo-ambiguo`', '`varias-opacas-para-o-numero`',
    '`por-efeito`', 'Nenhuma Chegada', 'não devolve o que chegou depois', 'Repetir o comando não move nada']) {
    assert.ok(op.includes(termo), `a operacao nao diz ${termo}`);
  }
  semContato(op, 'a operacao da uniao');
});

test('as invariantes de identidade dizem como a uniao move, promove, nomeia e desfaz', () => {
  const i = ler('docs', 'explicacoes', 'invariantes-de-identidade-nome-e-catalogo.md');
  assert.ok(!i.includes('Unir as Conversas partidas é outro'), 'a frase antiga continua nas invariantes');
  for (const frase of [
    '- **A união da Conversa partida move ou promove, e nunca apaga nem reescreve a história (#1440).**',
    '- **A Conversa promovida mostra o nome do Identificador exato do endereço novo, não o da Correspondência.**',
    '- **A união roda com o ouvinte no ar, uma Conversa por transação, e reclassifica sob o lock.**',
    '- **O `desfazer` da união é item a item e confere o valor atual, antes do ramo genérico da resolução retroativa.**',
  ]) {
    assert.ok(i.includes(frase), `falta: ${frase.slice(0, 60)}`);
  }
  semContato(entre(i, '- **A união da Conversa partida', '- **"Comparar dígitos'), 'as invariantes da uniao');
});

test('a ADR nova refina a de 08/11, e a de 08/11 diz que foi refinada', () => {
  const nova = ler(...ADR_NOVA);
  assert.ok(nova.includes('**Refina** a [`20261108-par-da-conversa-direta-pelo-campo-do-companheiro.md`]'), 'a ADR nova nao diz que refina');
  for (const secao of ['## Status', '## Contexto', '## Decisão', '## Consequências e riscos', '## Alternativas consideradas', '## Como reverter']) {
    assert.ok(nova.includes(secao), `a ADR nova nao tem ${secao}`);
  }
  semContato(nova, 'a ADR nova');
  const antiga = ler(...ADR_ANTIGA);
  assert.ok(antiga.includes('**Refinada em 2026-11-09**'), 'a ADR de 08/11 nao diz que foi refinada');
  assert.ok(antiga.includes('~~**Não se unem Conversas.**~~'), 'a decisao 4 da ADR de 08/11 nao foi riscada');
  assert.ok(!antiga.includes('A união é decisão à parte.'), 'a ADR de 08/11 ainda deixa a uniao para depois');
});

// Repo publico: nada de caminho de maquina, numero longo (endereco, telefone) nem id de Inquilino nos textos novos. Nomes de pessoa,
// conta e host nao se listam aqui (o proprio teste os publicaria): a varredura deles e passo do plano, antes do commit.
const semRastroDeMaquina = (texto: string, onde: string): void => {
  const corpo = texto.replace(/^id: \d{12}$/m, '');
  assert.ok(!/\/home\/|\/Users\//.test(corpo), `${onde} tem caminho de maquina`);
  assert.ok(!/\d{10,}/.test(corpo), `${onde} tem numero de dez digitos ou mais`);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(corpo), `${onde} tem um UUID`);
};

test('a ADR nova e a entrada do CHANGELOG nao trazem caminho de maquina, numero longo nem UUID', () => {
  semRastroDeMaquina(ler(...ADR_NOVA), 'a ADR nova');
  const c = ler('CHANGELOG.md');
  const i = c.indexOf('une a Conversa partida');
  assert.ok(i >= 0, 'falta a entrada da uniao no CHANGELOG');
  const ini = c.lastIndexOf('\n## [', i);
  const fim = c.indexOf('\n## [', i);
  const entrada = c.slice(ini, fim);
  assert.ok(/^\n## \[(Não lançado|0\.49\.0)\]/.test(entrada), 'a uniao nao esta na entrada [Não lançado] nem na [0.49.0]');
  assert.ok(entrada.includes('Não muda a forma do Acervo (segue v32)'), 'a entrada nao diz que a forma do Acervo nao muda');
  assert.ok(entrada.includes('`identidade unir-conversas-do-contato`'), 'a entrada nao nomeia o comando');
  semRastroDeMaquina(entrada, 'a entrada do CHANGELOG');
  semContato(entrada, 'a entrada do CHANGELOG');
});

test('as referencias e o guia dizem que o operador une as duas, e o CONTEXTO tirou a pendencia sem codigo', () => {
  const s = ler('docs', 'referencias', 'comandos-modo-servidor.md');
  assert.ok(s.includes('| `identidade unir-conversas-do-contato --inquilino <id> [--limite <n>] [--com-efeito --confirmo] [--json]` |'), 'falta a linha da tabela');
  assert.ok(s.includes('`identidade unir-conversas-do-contato`,\n'), 'falta o item do Ensaio por padrao');
  assert.ok(!ler('docs', 'referencias', 'comandos-modo-cliente.md').includes('(as duas Conversas não são unidas)'), 'o cliente ainda diz que nao se unem');
  assert.ok(ler('docs', 'referencias', 'comandos-modo-cliente.md').includes('até o operador unir as duas'));
  assert.ok(ler('docs', 'guias', 'cliente-e-agente.md').includes('traz o histórico inteiro'));
  const ctx = ler('CONTEXTO.md');
  assert.ok(ctx.includes('**Conversa partida (#1439; união pela #1440).**'), 'falta a pendencia nova');
  assert.ok(!ctx.includes('Não há código que una as duas.'), 'o CONTEXTO ainda diz que nao ha codigo');
});
