import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import {
  listarConversasDiretasComRecebidas,
  SQL_CONVERSAS_DIRETAS_POR_SUFIXO,
  SQL_RECEBIDAS_DA_CONVERSA,
} from '../src/nucleo/enderecos-do-acervo.js';

// #1439, Plano 2: a porta de LEITURA do estoque do par da Conversa direta. O sufixo e do Adaptador; o nucleo nao o conhece.

const SUFIXO = '@opaco.teste';
const OPACO_A = '100000000000011@opaco.teste';
const OPACO_B = '100000000000012@opaco.teste';
const TELEFONE = '556599991111@s.whatsapp.net';
const AGORA = 1_790_000_000_000;

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

function mensagem(
  acervo: Acervo,
  conversaId: string,
  idExterno: string,
  direcao: 'enviada' | 'recebida',
  ocorridaEm: number,
  bruto?: string,
): void {
  registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    direcao,
    conversaId,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm,
    agora: AGORA,
    ...(bruto === undefined ? {} : { bruto }),
  });
}

test('devolve so as Conversas diretas da Fonte com o sufixo, e de cada uma TODAS as recebidas em ordem de instante', () => {
  comAcervo((acervo) => {
    const a = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: OPACO_A, coletiva: false, configuracao: CFG_WHATSAPP });
    const b = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: OPACO_B, coletiva: false, configuracao: CFG_WHATSAPP_SEGUNDA });
    const tel = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: TELEFONE, coletiva: false, configuracao: CFG_WHATSAPP });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: `120363000000000001${SUFIXO}`, coletiva: true });
    registrarConversa(acervo, { fonte: 'instagram', idExterno: `fulano${SUFIXO}`, coletiva: false, configuracao: { id: 'cfg-ig', fonte: 'instagram' } });
    // Fora de ordem de insercao: a ordem que vale e a do instante.
    for (let i = 7; i >= 1; i--) mensagem(acervo, a, `a-r${i}`, 'recebida', AGORA - 1000 + i, `{"n":${i}}`);
    mensagem(acervo, a, 'a-e1', 'enviada', AGORA - 500, '{"enviada":true}');
    mensagem(acervo, b, 'b-e1', 'enviada', AGORA - 400);
    mensagem(acervo, tel, 't-r1', 'recebida', AGORA - 300, '{"tel":true}');

    const todas = listarConversasDiretasComRecebidas(acervo, 'whatsapp', SUFIXO, { depoisDe: '', limite: 10 });
    const porId = new Map(todas.map((c) => [c.idExterno, c]));
    assert.deepEqual([...porId.keys()].sort(), [OPACO_A, OPACO_B], 'nem a de telefone, nem a coletiva, nem a de outra Fonte');
    assert.deepEqual(porId.get(OPACO_A), {
      conversaId: a,
      configuracaoId: CFG_WHATSAPP.id,
      idExterno: OPACO_A,
      recebidas: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ ocorridaEm: AGORA - 1000 + i, bruto: `{"n":${i}}` })),
    });
    assert.deepEqual(porId.get(OPACO_B), { conversaId: b, configuracaoId: CFG_WHATSAPP_SEGUNDA.id, idExterno: OPACO_B, recebidas: [] });
  });
});

test('pagina por Conversa, pelo id, e a Mensagem sem bruto chega como nulo', () => {
  comAcervo((acervo) => {
    const ids = [OPACO_A, OPACO_B, `100000000000013${SUFIXO}`].map((idExterno) =>
      registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: false, configuracao: CFG_WHATSAPP }),
    );
    mensagem(acervo, ids[0]!, 'sem-bruto', 'recebida', AGORA - 10);
    const ordem = [...ids].sort();

    const primeira = listarConversasDiretasComRecebidas(acervo, 'whatsapp', SUFIXO, { depoisDe: '', limite: 2 });
    assert.deepEqual(primeira.map((c) => c.conversaId), ordem.slice(0, 2));
    const segunda = listarConversasDiretasComRecebidas(acervo, 'whatsapp', SUFIXO, { depoisDe: primeira[1]!.conversaId, limite: 2 });
    assert.deepEqual(segunda.map((c) => c.conversaId), ordem.slice(2));
    assert.deepEqual(listarConversasDiretasComRecebidas(acervo, 'whatsapp', SUFIXO, { depoisDe: segunda[0]!.conversaId, limite: 2 }), []);
    const comSemBruto = [...primeira, ...segunda].find((c) => c.conversaId === ids[0]);
    assert.deepEqual(comSemBruto?.recebidas, [{ ocorridaEm: AGORA - 10, bruto: null }]);
  });
});

test('a Mensagem migrada sem direcao nao conta como recebida', () => {
  comAcervo((acervo) => {
    const a = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: OPACO_A, coletiva: false, configuracao: CFG_WHATSAPP });
    mensagem(acervo, a, 'm1', 'recebida', AGORA - 10, '{}');
    acervo.db.prepare("UPDATE mensagens SET direcao = NULL WHERE id_externo = 'm1'").run();
    const [c] = listarConversasDiretasComRecebidas(acervo, 'whatsapp', SUFIXO, { depoisDe: '', limite: 10 });
    assert.deepEqual(c?.recebidas, []);
  });
});

test('as recebidas sao lidas pelo indice de Conversa, sem ordenar em tabela temporaria', () => {
  comAcervo((acervo) => {
    const plano = (acervo.db.prepare(`EXPLAIN QUERY PLAN ${SQL_RECEBIDAS_DA_CONVERSA}`).all('c') as Array<{ detail: string }>)
      .map((l) => l.detail)
      .join(' | ');
    assert.match(plano, /SEARCH mensagens USING INDEX idx_mensagens_conversa \(conversa_id=\?\)/);
    assert.doesNotMatch(plano, /TEMP B-TREE/);
    // As Conversas: so `conversas` (milhares de linhas no Acervo grande, ordenadas por id a cada pagina), nunca `mensagens`.
    const deConversas = (
      acervo.db.prepare(`EXPLAIN QUERY PLAN ${SQL_CONVERSAS_DIRETAS_POR_SUFIXO}`).all('whatsapp', '', SUFIXO.length, -SUFIXO.length, SUFIXO, 10) as Array<{
        detail: string;
      }>
    )
      .map((l) => l.detail)
      .join(' | ');
    assert.match(deConversas, /conversas/);
    assert.doesNotMatch(deConversas, /mensagens/);
  });
});

test('o limite precisa ser inteiro maior que zero', () => {
  comAcervo((acervo) => {
    for (const limite of [0, -1, 1.5]) {
      assert.throws(() => listarConversasDiretasComRecebidas(acervo, 'whatsapp', SUFIXO, { depoisDe: '', limite }), RangeError);
    }
  });
});

test('fronteira: a porta do nucleo nao nomeia o endereco opaco nem o campo do Adaptador', () => {
  const texto = readFileSync('src/nucleo/enderecos-do-acervo.ts', 'utf8');
  assert.doesNotMatch(texto, /@lid|\blid\b|senderPn|\bjid\b|whatsapp\.net/i);
});

test('identificadores existentes nao interferem: a porta so le Conversas e Mensagens', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: OPACO_A });
    assert.deepEqual(listarConversasDiretasComRecebidas(acervo, 'whatsapp', SUFIXO, { depoisDe: '', limite: 10 }), []);
  });
});
