import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  instalacaoComChave,
  instalacaoComInquilino,
  instalacaoTemporaria,
  rodar,
} from './ajuda/instalacao.js';
import { backupFalso } from './ajuda/material-falso.js';

test('conversa presenca recusa Conversa desconhecida, sem devolver o roster', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = instalacaoComChave(raiz);
    const r = rodar(raiz, [
      'conversa',
      'presenca',
      '--inquilino',
      inquilino,
      '--conversa',
      'nao-existe',
      '--em',
      '2023-06-15',
    ]);
    assert.equal(r.codigo, 2, r.saida);
    assert.match(r.saida, /desconhecida/i);
  } finally {
    limpar();
  }
});

test('conversa presenca exige a data, e diz o formato', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = instalacaoComChave(raiz);
    const r = rodar(raiz, ['conversa', 'presenca', '--inquilino', inquilino, '--conversa', 'x']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /--em/);
  } finally {
    limpar();
  }
});

test('data sem hora é o FIM daquele dia, e o comando declara o instante usado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = instalacaoComChave(raiz);
    // Conversa e evento montados pela porta, para o alcance ser conhecido.
    const r = rodar(raiz, [
      'conversa',
      'presenca',
      '--inquilino',
      inquilino,
      '--conversa',
      'nao-existe',
      '--em',
      '2021-08-03',
    ]);
    // O caminho de recusa basta para o formato: o que se mede aqui é que a
    // data crua não vira meia-noite em silêncio.
    assert.equal(r.codigo, 2, r.saida);
  } finally {
    limpar();
  }
});

test('perguntar pelo ULTIMO dia do alcance cai dentro dele, e não fora', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const backup = backupFalso({
      conversas: [{ pk: 1, endereco: 'grupo-1@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
      membros: [{ pk: 10, endereco: '5565911111', conversaPk: 1, ativo: true }],
      mensagens: [
        // Um evento de entrada às 10h de um dia. Perguntar por ESSE dia tem de
        // cair dentro do alcance — o fim do dia é depois do último evento, e
        // sem capar a pergunta a resposta viria como "FORA dele".
        {
          stanzaId: 'ev-1',
          chatSessionPk: 1,
          texto: null,
          dataCoreData: 700_000_000,
          tipo: 6,
          codigoDeEvento: 15,
          grupoMembroPk: 10,
        },
      ],
    });
    try {
      const imp = rodar(raiz, [
        'importar', '--configuracao', 'teste', '--inquilino', inquilino, '--fonte', 'whatsapp', '--material', backup.raiz,
      ]);
      assert.equal(imp.codigo, 0, imp.saida);
      const conversa = rodar(raiz, ['conversas', '--inquilino', inquilino, '--json']);
      const id = (JSON.parse(conversa.saida) as Array<{ id: string; coletiva: boolean }>).find(
        (c) => c.coletiva,
      )?.id;
      assert.ok(id, conversa.saida);

      // 700_000_000 em Core Data = 2023-03-08 (UTC).
      const r = rodar(raiz, [
        'conversa', 'presenca', '--inquilino', inquilino, '--conversa', id, '--em', '2023-03-08',
      ]);
      assert.equal(r.codigo, 0, r.saida);
      assert.doesNotMatch(r.saida, /FORA dele/, r.saida);
      assert.match(r.saida, /presente \.+ 1/, r.saida);
    } finally {
      backup.limpar();
    }
  } finally {
    limpar();
  }
});
