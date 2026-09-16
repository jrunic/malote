import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cenario } from './ajuda/acervo.js';

test('vínculo sem procedência é impossível de gravar', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const pessoa = randomUUID();
    acervo.db
      .prepare('INSERT INTO pessoas (id, criada_em) VALUES (?, ?)')
      .run(pessoa, new Date().toISOString());

    assert.throws(
      () =>
        acervo.db
          .prepare(
            'INSERT INTO identificadores (id, fonte, valor, pessoa_id, visto_em) VALUES (?,?,?,?,?)',
          )
          .run(randomUUID(), 'whatsapp', '5565900000001', pessoa, new Date().toISOString()),
      /CHECK constraint failed/,
    );
  } finally {
    c.limpar();
  }
});

test('procedência fora do vocabulário é impossível de gravar', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const pessoa = randomUUID();
    const agora = new Date().toISOString();
    acervo.db.prepare('INSERT INTO pessoas (id, criada_em) VALUES (?, ?)').run(pessoa, agora);

    assert.throws(
      () =>
        acervo.db
          .prepare(
            `INSERT INTO identificadores (id, fonte, valor, pessoa_id, procedencia, vinculado_em, visto_em)
             VALUES (?,?,?,?,?,?,?)`,
          )
          .run(randomUUID(), 'whatsapp', '5565900000002', pessoa, 'palpite', agora, agora),
      /CHECK constraint failed/,
    );
  } finally {
    c.limpar();
  }
});

test('dois nomes da mesma origem convivem; o mesmo nome não duplica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const pessoa = randomUUID();
    const agora = new Date().toISOString();
    acervo.db.prepare('INSERT INTO pessoas (id, criada_em) VALUES (?, ?)').run(pessoa, agora);

    const inserir = acervo.db.prepare(
      `INSERT OR IGNORE INTO atribuicoes_de_nome
         (id, pessoa_id, origem, nome, atribuido_em, ultimo_avistamento)
       VALUES (?,?,?,?,?,?)`,
    );
    inserir.run(randomUUID(), pessoa, 'contatos', 'Leia O.', agora, agora);
    inserir.run(randomUUID(), pessoa, 'contatos', 'Leia Organa', agora, agora);
    inserir.run(randomUUID(), pessoa, 'contatos', 'Leia Organa', agora, agora);

    const linhas = acervo.db
      .prepare('SELECT nome FROM atribuicoes_de_nome WHERE pessoa_id = ?')
      .all(pessoa) as Array<{ nome: string }>;
    assert.equal(linhas.length, 2);
  } finally {
    c.limpar();
  }
});
