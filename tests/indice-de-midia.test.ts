import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import {
  codificarCursorDoIndice,
  cursorDaProximaPaginaDoIndice,
  decodificarCursorDoIndice,
  paginaDoIndiceDeMidia,
} from '../src/nucleo/indice-de-midia.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

function conversaComMidias() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Leia Organa');
  const conversaId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'x@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP });
  const outra = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'y@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP });
  const t0 = Date.parse('2026-09-01T12:00:00Z');
  const mensagem = (conv: typeof conversaId, ext: string, em: number) =>
    registrarMensagem(acervo, { origemDaChegada: 'importacao', direcao: 'recebida', conversaId: conv, fonte: 'whatsapp', idExterno: ext, ocorridaEm: em, agora: Date.now() });
  // duas Mensagens NO MESMO instante, a segunda com dois Anexos, e uma depois; mais uma de outra Conversa
  const m1 = mensagem(conversaId, 'm1', t0);
  const m2 = mensagem(conversaId, 'm2', t0);
  const m3 = mensagem(conversaId, 'm3', t0 + 1000);
  const m4 = mensagem(outra, 'm4', t0);
  const anexos = [m1, m2, m2, m3, m4].map((m, i) =>
    registrarAnexo(acervo, { origemDaChegada: 'importacao', mensagemId: m, tipo: i === 1 ? 'audio' : 'image', presenca: 'nunca-obtido' }),
  );
  return { c, acervo, conversaId, ids: { m1, m2, m3, m4 }, anexos };
}

test('a pagina vem por instante, id da Mensagem e id do Anexo, so da Conversa pedida', () => {
  const x = conversaComMidias();
  try {
    const itens = paginaDoIndiceDeMidia(x.acervo, { conversaId: x.conversaId, limite: 50 });
    assert.equal(itens.length, 4, 'o Anexo da outra Conversa nao entra');
    const esperada = [...itens].sort(
      (a, b) => a.ocorridaEm - b.ocorridaEm || (a.mensagemId < b.mensagemId ? -1 : a.mensagemId > b.mensagemId ? 1 : 0) || (a.anexoId < b.anexoId ? -1 : 1),
    );
    assert.deepEqual(itens.map((i) => i.anexoId), esperada.map((i) => i.anexoId));
    assert.deepEqual(Object.keys(itens[0] as object).sort(), ['anexoId', 'mensagemId', 'ocorridaEm', 'presenca', 'tamanho', 'tipo']);
  } finally {
    x.c.limpar();
  }
});

test('o cursor pagina sem repetir nem pular, inclusive entre Mensagens do mesmo instante', () => {
  const x = conversaComMidias();
  try {
    const todos = paginaDoIndiceDeMidia(x.acervo, { conversaId: x.conversaId, limite: 50 }).map((i) => i.anexoId);
    for (const limite of [1, 2, 3]) {
      const lidos: string[] = [];
      let cursor;
      let paginas = 0;
      for (let guarda = 0; guarda < 10; guarda += 1) {
        paginas += 1;
        const pagina = paginaDoIndiceDeMidia(x.acervo, { conversaId: x.conversaId, limite, ...(cursor ? { cursor } : {}) });
        lidos.push(...pagina.map((i) => i.anexoId));
        const token = cursorDaProximaPaginaDoIndice(pagina, limite);
        if (token === undefined) break;
        cursor = decodificarCursorDoIndice(token);
        assert.ok(cursor);
      }
      assert.deepEqual(lidos, todos, `limite ${limite}`);
      // Pagina menor que o limite e a ultima (sem `proximo`); so a divisao exata custa uma pagina vazia a mais.
      assert.equal(paginas, Math.floor(todos.length / limite) + 1, `paginas com limite ${limite}`);
    }
  } finally {
    x.c.limpar();
  }
});

test('o periodo recorta por instante e o cursor invalido e recusado', () => {
  const x = conversaComMidias();
  try {
    const t0 = Date.parse('2026-09-01T12:00:00Z');
    assert.equal(paginaDoIndiceDeMidia(x.acervo, { conversaId: x.conversaId, limite: 50, de: t0 + 500 }).length, 1);
    assert.equal(paginaDoIndiceDeMidia(x.acervo, { conversaId: x.conversaId, limite: 50, ate: t0 }).length, 3);
    assert.throws(() => paginaDoIndiceDeMidia(x.acervo, { conversaId: x.conversaId, limite: 0 }), /limite invalido/);
    assert.equal(decodificarCursorDoIndice('nao-e-um-cursor'), undefined);
    assert.equal(decodificarCursorDoIndice(Buffer.from('[1,2]').toString('base64url')), undefined);
    assert.deepEqual(decodificarCursorDoIndice(codificarCursorDoIndice({ ocorridaEm: 5, mensagemId: 'a', anexoId: 'b' })), { ocorridaEm: 5, mensagemId: 'a', anexoId: 'b' });
  } finally {
    x.c.limpar();
  }
});
