import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { semearIdentidade, minuto, BRUNO_LID } from './ajuda/identidade.js';
import { semearMidia } from './ajuda/midia.js';
import {
  cursorDaProximaPagina,
  listarAnexosDaConversa,
  montarConsultaDeAnexos,
} from '../src/nucleo/anexos-da-conversa.js';
import { decodificarCursor, type CursorDePaginacao } from '../src/nucleo/cursor.js';
import { identificadoresDoRemetente } from '../src/nucleo/remetente.js';

function acervoDeMidia() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Titular');
  const s = semearIdentidade(acervo);
  const m = semearMidia(acervo, s);
  return { acervo, s, m, limpar: c.limpar };
}

test('lista os Anexos da Conversa em ordem cronologica, com a presenca de cada um, e nao os de outra Conversa (#1129)', () => {
  const { acervo, s, m, limpar } = acervoDeMidia();
  try {
    const todos = listarAnexosDaConversa(acervo, { conversaId: s.grupo });
    assert.equal(todos.length, 5);
    assert.ok(!todos.some((a) => a.id === m.imagemNaDireta));
    const pares = todos.map((a) => [a.ocorridaEm, a.id] as [number, string]);
    assert.deepEqual(
      pares,
      [...pares].sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1)),
      'ordem: instante da Mensagem, depois id do Anexo',
    );
    assert.deepEqual(
      new Set(todos.map((a) => a.presenca)),
      new Set(['presente', 'nunca-obtido', 'descartado']),
      'nunca-obtido e descartado aparecem: a presenca e dita, nunca omissao',
    );
    const doc = todos.find((a) => a.id === m.documentoDeBruno)!;
    assert.deepEqual(
      [doc.tipo, doc.nomeOriginal, doc.mensagemId.length > 0, doc.autorId],
      ['document', 'contrato.pdf', true, s.bruno],
    );
  } finally {
    limpar();
  }
});

test('tipo, presenca e periodo compoem por E (#1129)', () => {
  const { acervo, s, m, limpar } = acervoDeMidia();
  try {
    const ids = (f: object) =>
      listarAnexosDaConversa(acervo, { conversaId: s.grupo, ...f })
        .map((a) => a.id)
        .sort();
    assert.deepEqual(ids({ tipo: 'image' }), [m.imagemDeBruno, m.imagemSoltaDeBruno].sort());
    assert.deepEqual(ids({ presenca: 'presente' }), [m.imagemDeBruno, m.audioDeAna].sort());
    assert.deepEqual(ids({ tipo: 'image', presenca: 'presente' }), [m.imagemDeBruno]);
    assert.equal(ids({ ate: minuto(30) }).length, 3, 'tres Anexos no minuto 30');
    assert.equal(ids({ de: minuto(31) }).length, 2);
    assert.deepEqual(ids({ tipo: 'imagem' }), [], 'a consulta e exata: o apelido e da CLI');
  } finally {
    limpar();
  }
});

test('remetente por conjunto de ids; lista vazia nao devolve nada (#1129)', () => {
  const { acervo, s, m, limpar } = acervoDeMidia();
  try {
    const autorIds = identificadoresDoRemetente(acervo, { valor: BRUNO_LID });
    const deBruno = listarAnexosDaConversa(acervo, { conversaId: s.grupo, autorIds })
      .map((a) => a.id)
      .sort();
    assert.deepEqual(deBruno, [m.imagemDeBruno, m.documentoDeBruno, m.imagemSoltaDeBruno].sort());
    assert.deepEqual(listarAnexosDaConversa(acervo, { conversaId: s.grupo, autorIds: [] }), []);
  } finally {
    limpar();
  }
});

test('cursor composto: tres Anexos no mesmo instante, dois da mesma Mensagem, limite 2, sem pular nem repetir (#1129)', () => {
  const { acervo, s, limpar } = acervoDeMidia();
  try {
    const inteira = listarAnexosDaConversa(acervo, { conversaId: s.grupo }).map((a) => a.id);
    const vistos: string[] = [];
    let cursor: CursorDePaginacao | undefined;
    const tamanhos: number[] = [];
    for (let pagina = 0; pagina < 10; pagina += 1) {
      const lote = listarAnexosDaConversa(acervo, {
        conversaId: s.grupo,
        limite: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      tamanhos.push(lote.length);
      vistos.push(...lote.map((a) => a.id));
      const proximo = cursorDaProximaPagina(lote, 2);
      if (proximo === undefined) break;
      cursor = decodificarCursor(proximo);
      assert.ok(cursor, 'o cursor devolvido e valido');
    }
    assert.deepEqual(tamanhos, [2, 2, 1], 'a fronteira da primeira pagina cai dentro do minuto 30');
    assert.deepEqual(vistos, inteira, 'as paginas, juntas, sao a lista inteira, na ordem');
    assert.equal(new Set(vistos).size, vistos.length, 'nenhuma repeticao');
  } finally {
    limpar();
  }
});

test('cursorDaProximaPagina so existe quando a pagina veio cheia (#1129)', () => {
  const { acervo, s, limpar } = acervoDeMidia();
  try {
    const duas = listarAnexosDaConversa(acervo, { conversaId: s.grupo, limite: 2 });
    assert.ok(cursorDaProximaPagina(duas, 2));
    assert.equal(cursorDaProximaPagina(duas, undefined), undefined);
    assert.equal(cursorDaProximaPagina(duas, 3), undefined);
    assert.equal(cursorDaProximaPagina([], 2), undefined);
  } finally {
    limpar();
  }
});

test('limite invalido e erro de quem chama (#1129)', () => {
  const { acervo, s, limpar } = acervoDeMidia();
  try {
    assert.throws(() => listarAnexosDaConversa(acervo, { conversaId: s.grupo, limite: 0 }), /limite/);
    assert.throws(() => listarAnexosDaConversa(acervo, { conversaId: s.grupo, limite: 1.5 }), /limite/);
  } finally {
    limpar();
  }
});

test('o plano parte das Mensagens da Conversa pelo indice e entra nos Anexos pela Mensagem (#1129)', () => {
  const { acervo, s, limpar } = acervoDeMidia();
  try {
    const { sql, valores } = montarConsultaDeAnexos({ conversaId: s.grupo, tipo: 'image' });
    const plano = (acervo.preparar(`EXPLAIN QUERY PLAN ${sql}`).all(...valores) as Array<{ detail: string }>)
      .map((l) => l.detail)
      .join(' | ');
    assert.match(plano, /idx_mensagens_conversa/, plano);
    assert.match(plano, /idx_anexos_mensagem/, plano);
    assert.doesNotMatch(plano, /SCAN (anexos|a)\b/, `a listagem nao varre a tabela de Anexos: ${plano}`);
  } finally {
    limpar();
  }
});

test('nenhum filtro faz o plano entrar em Anexos por idx_anexos_presenca: o laço aninhado varreria todos os Anexos daquela presenca por Mensagem (#1129)', () => {
  const { acervo, s, limpar } = acervoDeMidia();
  try {
    const combinacoes: Array<[string, Parameters<typeof montarConsultaDeAnexos>[0]]> = [
      ['presenca=presente', { conversaId: s.grupo, presenca: 'presente' }],
      ['presenca=nunca-obtido', { conversaId: s.grupo, presenca: 'nunca-obtido' }],
      ['presenca=descartado', { conversaId: s.grupo, presenca: 'descartado' }],
      ['presenca + tipo', { conversaId: s.grupo, presenca: 'presente', tipo: 'image' }],
      ['presenca + periodo + remetente', { conversaId: s.grupo, presenca: 'presente', de: 1, ate: 9e15, autorIds: [s.bruno] }],
    ];
    for (const [nome, f] of combinacoes) {
      const { sql, valores } = montarConsultaDeAnexos({ ...f, limite: 500 });
      const plano = (acervo.preparar(`EXPLAIN QUERY PLAN ${sql}`).all(...valores) as Array<{ detail: string }>)
        .map((l) => l.detail)
        .join(' | ');
      assert.doesNotMatch(plano, /idx_anexos_presenca/, `${nome}: ${plano}`);
      assert.match(plano, /SEARCH a USING INDEX idx_anexos_mensagem/, `${nome}: ${plano}`);
    }
  } finally {
    limpar();
  }
});
