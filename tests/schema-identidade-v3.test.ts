import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cenario } from './ajuda/acervo.js';

test('Pessoa absorvida aponta para quem a absorveu, e as duas datas andam juntas', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const agora = new Date().toISOString();
    const viva = randomUUID();
    const absorvida = randomUUID();
    const inserir = acervo.db.prepare('INSERT INTO pessoas (id, criada_em) VALUES (?, ?)');
    inserir.run(viva, agora);
    inserir.run(absorvida, agora);

    // Marcar absorvida SEM a data e impossivel: as duas colunas existem
    // juntas ou nenhuma existe, do mesmo jeito que procedencia e vinculado_em.
    assert.throws(
      () => acervo.db.prepare('UPDATE pessoas SET absorvida_por = ? WHERE id = ?').run(viva, absorvida),
      /CHECK constraint failed/,
    );

    acervo.db
      .prepare('UPDATE pessoas SET absorvida_por = ?, absorvida_em = ? WHERE id = ?')
      .run(viva, agora, absorvida);
    const lida = acervo.db
      .prepare('SELECT absorvida_por FROM pessoas WHERE id = ?')
      .get(absorvida) as { absorvida_por: string };
    assert.equal(lida.absorvida_por, viva);
  } finally {
    c.limpar();
  }
});

test('Pessoa não pode ser absorvida por ela mesma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const agora = new Date().toISOString();
    const pessoa = randomUUID();
    acervo.db.prepare('INSERT INTO pessoas (id, criada_em) VALUES (?, ?)').run(pessoa, agora);

    assert.throws(
      () =>
        acervo.db
          .prepare('UPDATE pessoas SET absorvida_por = ?, absorvida_em = ? WHERE id = ?')
          .run(pessoa, agora, pessoa),
      /CHECK constraint failed/,
    );
  } finally {
    c.limpar();
  }
});

test('o desvínculo guarda o endereço que saiu, e não só o id', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const agora = new Date().toISOString();
    const pessoa = randomUUID();
    acervo.db.prepare('INSERT INTO pessoas (id, criada_em) VALUES (?, ?)').run(pessoa, agora);

    acervo.db
      .prepare(
        `INSERT INTO desvinculos (id, pessoa_id, identificador_id, fonte, valor, procedencia, desvinculado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), pessoa, randomUUID(), 'whatsapp', '5565900000001', 'humano', agora);

    const linha = acervo.db
      .prepare('SELECT valor FROM desvinculos WHERE pessoa_id = ?')
      .get(pessoa) as { valor: string };
    assert.equal(linha.valor, '5565900000001');
  } finally {
    c.limpar();
  }
});
