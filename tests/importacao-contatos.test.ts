import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG_CONTATOS } from './ajuda/configuracao.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { importarCatalogo } from '../src/adaptadores/contatos/importar.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { criarPessoa, vincularIdentificador } from '../src/nucleo/identidade.js';

const AGORA = Date.parse('2026-08-29T12:00:00Z');
let sequencia = 0;

function vcard(raiz: string, cartoes: string[]): string {
  const caminho = join(raiz, `catalogo-${(sequencia += 1)}.vcf`);
  writeFileSync(caminho, cartoes.join('\r\n'));
  return caminho;
}

const JOANA = ['BEGIN:VCARD', 'FN:Joana Prado', 'TEL;TYPE=cell:+55 (11) 91234-5678', 'END:VCARD'].join(
  '\r\n',
);
const SEM_ENDERECO = ['BEGIN:VCARD', 'FN:Empresa Sem Telefone', 'END:VCARD'].join('\r\n');
const SO_EMAIL = [
  'BEGIN:VCARD',
  'FN:Contato So Email',
  'EMAIL;TYPE=other:alguem@exemplo.test',
  'END:VCARD',
].join('\r\n');

function contar(acervo: Acervo, tabela: string): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

test('contribui Identificador e nome, e reimportar não duplica', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const caminho = vcard(c.raiz, [JOANA]);

  const r1 = importarCatalogo(acervo, caminho, { agora: AGORA, configuracaoId: CFG_CONTATOS.id });
  assert.equal(r1.identificadoresCriados, 1);
  assert.equal(r1.nomesCriados, 1);

  // `reprocessar` porque a Configuracao agora e OBRIGATORIA, e com ela o check
  // de material ja registrado passou a valer: sem isso a segunda passada
  // devolve `jaRegistrado` com relatorio vazio e este teste mediria o vazio.
  // Afrouxar a assercao seria o conserto errado — o que se mede aqui e a
  // idempotencia de REIMPORTAR, e so reprocessando ela volta a ser exercitada.
  const r2 = importarCatalogo(acervo, caminho, {
    agora: AGORA,
    configuracaoId: CFG_CONTATOS.id,
    reprocessar: true,
  });
  assert.equal(r2.identificadoresCriados, 0);
  assert.equal(r2.identificadoresJaExistentes, 1);
  assert.equal(r2.nomesCriados, 0);
  assert.equal(r2.nomesJaExistentes, 1);
  assert.equal(contar(acervo, 'identificadores'), 1);
  assert.equal(contar(acervo, 'atribuicoes_de_nome'), 1);
  c.limpar();
});

test('grava o endereço normalizado — dois formatos do mesmo número, uma linha', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const caminho = vcard(c.raiz, [
    ['BEGIN:VCARD', 'FN:Joana Prado', 'TEL:+55 (11) 91234-5678', 'END:VCARD'].join('\r\n'),
    ['BEGIN:VCARD', 'FN:Joana P', 'TEL:+5511912345678', 'END:VCARD'].join('\r\n'),
  ]);
  importarCatalogo(acervo, caminho, { agora: AGORA, configuracaoId: CFG_CONTATOS.id });
  const linhas = acervo.db
    .prepare("SELECT valor FROM identificadores WHERE fonte = 'contatos'")
    .all() as Array<{ valor: string }>;
  assert.deepEqual(
    linhas.map((l) => l.valor),
    ['5511912345678'],
  );
  // Dois nomes distintos no mesmo endereço: nenhum apaga o outro.
  assert.equal(contar(acervo, 'atribuicoes_de_nome'), 2);
  c.limpar();
});

test('NÃO cria Pessoa — nem uma', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  importarCatalogo(acervo, vcard(c.raiz, [JOANA, SEM_ENDERECO]), { agora: AGORA, configuracaoId: CFG_CONTATOS.id });
  assert.equal(contar(acervo, 'pessoas'), 0);
  c.limpar();
});

test('NÃO remove nada — contato ausente do catálogo continua no Acervo', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const { id: idw } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5511999990000' });
  const pessoa = criarPessoa(acervo);
  vincularIdentificador(acervo, { identificadorId: idw, pessoaId: pessoa, procedencia: 'humano' });
  const antes = {
    ids: contar(acervo, 'identificadores'),
    pessoas: contar(acervo, 'pessoas'),
    nomes: contar(acervo, 'atribuicoes_de_nome'),
  };

  // Catálogo que NÃO menciona aquele número.
  importarCatalogo(acervo, vcard(c.raiz, [JOANA]), { agora: AGORA, configuracaoId: CFG_CONTATOS.id });

  assert.equal(contar(acervo, 'pessoas'), antes.pessoas);
  assert.ok(contar(acervo, 'identificadores') > antes.ids);
  assert.ok(contar(acervo, 'atribuicoes_de_nome') > antes.nomes);
  const vinculo = acervo.db
    .prepare('SELECT pessoa_id, procedencia FROM identificadores WHERE id = ?')
    .get(idw) as { pessoa_id: string; procedencia: string };
  assert.equal(vinculo.pessoa_id, pessoa);
  assert.equal(vinculo.procedencia, 'humano');
  c.limpar();
});

test('cartão sem telefone ENTRA pelo e-mail; só descarta quem não tem nada', () => {
  // MUDOU EM 12/09/2026, e a medicao e a mesma de sempre, lida ao contrario:
  // 1.210 cartoes reais nao tem telefone, e 869 DELES tem e-mail. Ate aqui os
  // 1.210 eram descartados inteiros e a base que so tem e-mails nao entrava.
  //
  // As duas contagens sobrevivem e passam a responder perguntas diferentes:
  // `cartoesSemTelefone` continua medindo quem nao tem telefone — util para
  // saber quanto do acervo o produtor por telefone nao alcanca —, e o descarte
  // passa a ser so `cartoesSemContatoAlgum`, os 341 que nao tem nada.
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const r = importarCatalogo(acervo, vcard(c.raiz, [JOANA, SEM_ENDERECO, SO_EMAIL]), {
    agora: AGORA,
    configuracaoId: CFG_CONTATOS.id,
  });
  assert.equal(r.cartoesLidos, 3);
  assert.equal(r.cartoesSemTelefone, 2, 'SEM_ENDERECO e SO_EMAIL nao tem telefone');
  assert.equal(r.cartoesSemContatoAlgum, 1, 'so SEM_ENDERECO nao tem nada');
  assert.equal(contar(acervo, 'identificadores'), 2, 'o telefone da JOANA e o e-mail do SO_EMAIL');
  c.limpar();
});

test('o nome entra com origem contatos, pendurado no Identificador', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  importarCatalogo(acervo, vcard(c.raiz, [JOANA]), { agora: AGORA, configuracaoId: CFG_CONTATOS.id });
  const n = acervo.db
    .prepare('SELECT origem, nome, pessoa_id, identificador_id FROM atribuicoes_de_nome')
    .get() as {
    origem: string;
    nome: string;
    pessoa_id: string | null;
    identificador_id: string | null;
  };
  assert.equal(n.origem, 'contatos');
  assert.equal(n.nome, 'Joana Prado');
  assert.equal(n.pessoa_id, null);
  assert.notEqual(n.identificador_id, null);
  c.limpar();
});

test('nenhum dado do catálogo atravessa Inquilino', () => {
  const c = cenario();
  const a = c.novoInquilino('Titular A');
  const b = c.novoInquilino('Titular B');
  importarCatalogo(a.acervo, vcard(c.raiz, [JOANA]), { agora: AGORA, configuracaoId: CFG_CONTATOS.id });
  assert.equal(contar(a.acervo, 'identificadores'), 1);
  assert.equal(contar(b.acervo, 'identificadores'), 0);
  assert.equal(contar(b.acervo, 'atribuicoes_de_nome'), 0);
  c.limpar();
});

test('grava o laço de cartão, e cartões homônimos ficam separados', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const caminho = vcard(c.raiz, [
    ['BEGIN:VCARD', 'FN:Carlos', 'TEL:+5511900000001', 'TEL:+5511900000002', 'END:VCARD'].join(
      '\r\n',
    ),
    ['BEGIN:VCARD', 'FN:Carlos', 'TEL:+5511900000003', 'END:VCARD'].join('\r\n'),
  ]);
  importarCatalogo(acervo, caminho, { agora: AGORA, configuracaoId: CFG_CONTATOS.id });

  const linhas = acervo.db
    .prepare(
      'SELECT i.valor, c.cartao FROM identificadores i ' +
        'JOIN cartoes_de_catalogo c ON c.identificador_id = i.id ORDER BY i.valor',
    )
    .all() as Array<{ valor: string; cartao: string }>;
  assert.equal(linhas.length, 3);
  // Os dois do primeiro cartao compartilham o laco.
  assert.equal(linhas[0]?.cartao, linhas[1]?.cartao);
  // O homonimo tem laco proprio — a guarda que motivou o schema 7.
  assert.notEqual(linhas[2]?.cartao, linhas[0]?.cartao);
  c.limpar();
});

test('o laço não muda quando só o nome do contato muda', () => {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const antes = vcard(c.raiz, [
    ['BEGIN:VCARD', 'FN:Bruno', 'TEL:+5511900000001', 'TEL:+5511900000002', 'END:VCARD'].join(
      '\r\n',
    ),
  ]);
  importarCatalogo(acervo, antes, { agora: AGORA, configuracaoId: CFG_CONTATOS.id });
  const primeiro = (
    acervo.db.prepare('SELECT DISTINCT cartao FROM cartoes_de_catalogo').all() as Array<{
      cartao: string;
    }>
  ).map((l) => l.cartao);

  const depois = vcard(c.raiz, [
    ['BEGIN:VCARD', 'FN:Bruno Salles', 'TEL:+5511900000001', 'TEL:+5511900000002', 'END:VCARD'].join(
      '\r\n',
    ),
  ]);
  importarCatalogo(acervo, depois, { agora: AGORA, configuracaoId: CFG_CONTATOS.id });
  const segundo = (
    acervo.db.prepare('SELECT DISTINCT cartao FROM cartoes_de_catalogo').all() as Array<{
      cartao: string;
    }>
  ).map((l) => l.cartao);
  assert.deepEqual(segundo, primeiro);
  c.limpar();
});
