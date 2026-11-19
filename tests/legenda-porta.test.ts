import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { buscarMensagens } from '../src/nucleo/consulta.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { emOperacao } from '../src/nucleo/trilha.js';
import { escreverTextoDeMensagem, indiceDeBuscaEstaIntegro, restaurarTextoDeMensagem } from '../src/nucleo/texto-da-mensagem.js';
import type { Acervo } from '../src/nucleo/acervo.js';

/**
 * A porta de escrita do texto de uma Mensagem que ja existe (#1530): ela refaz a entrada do indice de busca, que e de conteudo
 * externo e NAO tem gatilho de atualizacao. Texto SINTETICO.
 */
const AGORA = Date.parse('2026-11-18T12:00:00Z');
const CONTATO = '5511900000001@s.whatsapp.net';

function comMensagem(corpo: (acervo: Acervo, id: string) => void, conteudo?: string): void {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const conversa = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: CONTATO, coletiva: false, configuracao: { id: 'cfg-teste', fonte: 'whatsapp' } });
    const id = registrarMensagem(acervo, {
      origemDaChegada: 'importacao',
      conversaId: conversa,
      fonte: 'whatsapp',
      idExterno: 'P1',
      ocorridaEm: AGORA,
      agora: AGORA,
      direcao: 'recebida',
      ...(conteudo === undefined ? {} : { conteudo }),
    });
    corpo(acervo, id);
  } finally {
    c.limpar();
  }
}

test('a porta: escrever e restaurar deixam o indice integro, tambem com acento e emoji, e apagar a Mensagem depois nao quebra a busca', () => {
  comMensagem((acervo, id) => {
    const escrito = escreverTextoDeMensagem(acervo, id, 'Coração 👨‍👩‍👧 de teste');
    assert.deepEqual(escrito, { antes: null });
    assert.equal(escreverTextoDeMensagem(acervo, id, 'outra'), null, 'ja tem texto: nunca sobrescreve');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
    assert.equal(buscarMensagens(acervo, { texto: 'Coração' }).length, 1);
    assert.equal(restaurarTextoDeMensagem(acervo, id, 'texto que nao e o gravado', null), false);
    assert.equal(restaurarTextoDeMensagem(acervo, id, 'Coração 👨‍👩‍👧 de teste', null), true);
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
    assert.equal(buscarMensagens(acervo, { texto: 'Coração' }).length, 0);
    acervo.preparar('DELETE FROM mensagens WHERE id = ?').run(id);
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
    assert.throws(() => escreverTextoDeMensagem(acervo, id, ''), RangeError);
  });
});

test('a porta partindo de texto VAZIO: retira a entrada vazia, escreve, e o restaurar devolve o vazio', () => {
  comMensagem((acervo, id) => {
    assert.deepEqual(escreverTextoDeMensagem(acervo, id, 'texto novo'), { antes: '' });
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
    assert.equal(restaurarTextoDeMensagem(acervo, id, 'texto novo', ''), true);
    assert.equal((acervo.preparar('SELECT conteudo FROM mensagens WHERE id = ?').get(id) as { conteudo: string }).conteudo, '');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  }, '');
});

test('a verificacao COMPARA o indice com o conteudo: atualizar o texto sem refazer a entrada a reprova, e a forma simples nao a veria', () => {
  comMensagem((acervo, id) => {
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
    acervo.preparar('UPDATE mensagens SET conteudo = ? WHERE id = ?').run('texto sem entrada no indice', id);
    assert.doesNotThrow(() => acervo.preparar(`INSERT INTO mensagens_texto(mensagens_texto) VALUES ('integrity-check')`).run(), 'a forma simples diz ok');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), false);
    assert.equal(buscarMensagens(acervo, { texto: 'entrada' }).length, 0, 'e a busca nao acha a Mensagem');
  });
});

test('o desfazer de uma Operacao que gravou o texto devolve o de antes pela mesma porta (sem depender do comando de estoque)', () => {
  comMensagem((acervo, id) => {
    const operacaoId = emOperacao(acervo, { natureza: 'extrair-legenda-da-midia', reversibilidade: 'por-efeito' }, (op) => {
      const escrito = escreverTextoDeMensagem(acervo, id, 'texto de teste');
      op.valor({ tabela: 'mensagens', chave: id, campo: 'conteudo', antes: escrito!.antes, depois: 'texto de teste' });
      return op.id;
    });
    const d = desfazerOperacao(acervo, operacaoId);
    assert.equal(d.desfeitos, 1);
    assert.deepEqual(d.recusados, []);
    assert.equal((acervo.preparar('SELECT conteudo FROM mensagens WHERE id = ?').get(id) as { conteudo: string | null }).conteudo, null);
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true);
  });
});

test('a porta abre a propria transacao: uma falha entre retirar a entrada do indice e poe-la nao deixa o indice defasado', () => {
  comMensagem((acervo, id) => {
    const preparar = acervo.preparar.bind(acervo);
    (acervo as unknown as { preparar: unknown }).preparar = (sql: string) => {
      if (sql.includes('INSERT INTO mensagens_texto(rowid, conteudo)')) throw new Error('queda entre o delete e o insert do indice');
      return preparar(sql);
    };
    assert.throws(() => escreverTextoDeMensagem(acervo, id, 'texto novo'), /queda entre/);
    (acervo as unknown as { preparar: unknown }).preparar = preparar;
    assert.equal((acervo.preparar('SELECT conteudo FROM mensagens WHERE id = ?').get(id) as { conteudo: string | null }).conteudo, null, 'o UPDATE voltou');
    assert.equal(indiceDeBuscaEstaIntegro(acervo), true, 'e o indice segue de acordo com as Mensagens');
  });
});
