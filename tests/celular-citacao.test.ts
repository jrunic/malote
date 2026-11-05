import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { emOperacao } from '../src/nucleo/trilha.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { citacaoParaGravar, resolverCitacao } from '../src/adaptadores/whatsapp/citacao.js';

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';

function comAcervo(corpo: (acervo: Acervo, conversaId: string) => void): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    corpo(acervo, registrarConversa(acervo, { fonte: 'whatsapp', idExterno: GRUPO, coletiva: true }));
  } finally {
    c.limpar();
  }
}

const contar = (acervo: Acervo, sql: string, ...args: string[]): number =>
  (acervo.db.prepare(sql).get(...args) as { n: number }).n;

const pares = (acervo: Acervo): Array<{ alternativo: string; canonico: string }> =>
  acervo.db
    .prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo')
    .all() as Array<{ alternativo: string; canonico: string }>;

/** A Mensagem que responde a outra: o autor da citada vem no `contextInfo`, na forma que a plataforma entregou. */
const respondendoA = (autor: string): Record<string, unknown> => ({
  extendedTextMessage: { text: 'resposta', contextInfo: { stanzaId: 'CITADA1', participant: autor } },
});

test('o autor da citada, na forma alternativa de um Identificador gravado, e o mesmo Identificador', () => {
  comAcervo((acervo, conversaId) => {
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    const entrada = citacaoParaGravar(acervo, respondendoA(COM_NOVE), [], { conversaId });
    assert.equal(entrada?.autorId, id);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor IN (?, ?)', SEM_NOVE, COM_NOVE), 1);
    assert.deepEqual(pares(acervo), [{ alternativo: COM_NOVE, canonico: SEM_NOVE }]);
  });
});

test('`resolverCitacao`, que o ensaio usa, so le: nao aprende par', () => {
  comAcervo((acervo) => {
    const r = resolverCitacao(acervo, respondendoA(COM_NOVE), []);
    assert.equal(r?.enderecoDoAutor, COM_NOVE);
    assert.deepEqual(pares(acervo), []);
  });
});

test('dentro de uma Operacao por-efeito, o par aprendido pela Citacao sai no `desfazer`', () => {
  comAcervo((acervo, conversaId) => {
    const opId = emOperacao(acervo, { natureza: 'teste-de-citacao', reversibilidade: 'por-efeito' }, (op) => {
      citacaoParaGravar(acervo, respondendoA(COM_NOVE), [], { conversaId }, op);
      return op.id;
    });
    assert.deepEqual(pares(acervo), [{ alternativo: SEM_NOVE, canonico: COM_NOVE }]);

    const r = desfazerOperacao(acervo, opId);

    assert.equal(r.desfeitos, 1);
    assert.deepEqual(r.recusados, []);
    assert.deepEqual(pares(acervo), []);
  });
});
