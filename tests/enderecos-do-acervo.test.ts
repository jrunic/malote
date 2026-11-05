import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import {
  contarMensagensDoEndereco,
  listarConversasDiretasDoEndereco,
  listarIdentificadoresPorSufixo,
  SQL_IDENTIFICADORES_POR_SUFIXO,
} from '../src/nucleo/enderecos-do-acervo.js';

// #1376, Plano 4: as portas de LEITURA do ensaio do estoque. So o nucleo toca em tabela; o adaptador usa estas.

const A = '556599991111@s.whatsapp.net';
const B = '5565999992222@s.whatsapp.net';
const C = '556599993333@s.whatsapp.net';
const LID = '100000000000001@lid';

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

test('listarIdentificadoresPorSufixo pagina por valor, e so traz a Fonte e o sufixo pedidos', () => {
  comAcervo((acervo) => {
    for (const valor of [B, LID, A, C]) registrarIdentificador(acervo, { fonte: 'whatsapp', valor });
    registrarIdentificador(acervo, { fonte: 'instagram', valor: 'fulano@s.whatsapp.net' });

    const primeira = listarIdentificadoresPorSufixo(acervo, 'whatsapp', '@s.whatsapp.net', '', 2);
    assert.deepEqual(primeira, [A, C]);
    const segunda = listarIdentificadoresPorSufixo(acervo, 'whatsapp', '@s.whatsapp.net', primeira[1]!, 2);
    assert.deepEqual(segunda, [B]);
    assert.deepEqual(listarIdentificadoresPorSufixo(acervo, 'whatsapp', '@s.whatsapp.net', segunda[0]!, 2), []);
  });
});

test('um Identificador inserido durante a varredura, com valor depois do cursor, entra na pagina seguinte', () => {
  comAcervo((acervo) => {
    for (const valor of [A, B]) registrarIdentificador(acervo, { fonte: 'whatsapp', valor });
    const primeira = listarIdentificadoresPorSufixo(acervo, 'whatsapp', '@s.whatsapp.net', '', 1);
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: C });
    const resto = listarIdentificadoresPorSufixo(acervo, 'whatsapp', '@s.whatsapp.net', primeira[0]!, 10);
    assert.deepEqual(resto, [C, B]);
  });
});

test('a pagina usa o indice (fonte, valor) e nao ordena em tabela temporaria', () => {
  comAcervo((acervo) => {
    const plano = (
      acervo.db.prepare(`EXPLAIN QUERY PLAN ${SQL_IDENTIFICADORES_POR_SUFIXO}`).all('whatsapp', '', 15, -15, '@s.whatsapp.net', 10) as Array<{
        detail: string;
      }>
    )
      .map((l) => l.detail)
      .join(' | ');
    assert.match(plano, /SEARCH identificadores USING (COVERING )?INDEX \S+ \(fonte=\? AND valor>\?\)/);
    assert.doesNotMatch(plano, /TEMP B-TREE/);
  });
});

test('contarMensagensDoEndereco conta so as Mensagens cujo autor tem aquele valor', () => {
  comAcervo((acervo) => {
    const a = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: A }).id;
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: B });
    const conversa = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: A, coletiva: false, configuracao: CFG_WHATSAPP });
    for (const idExterno of ['m1', 'm2']) {
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        direcao: 'recebida',
        conversaId: conversa,
        fonte: 'whatsapp',
        idExterno,
        autorId: a,
        ocorridaEm: 1_790_000_000_000,
        agora: 1_790_000_000_000,
      });
    }
    assert.equal(contarMensagensDoEndereco(acervo, 'whatsapp', A), 2);
    assert.equal(contarMensagensDoEndereco(acervo, 'whatsapp', B), 0);
    assert.equal(contarMensagensDoEndereco(acervo, 'whatsapp', C), 0, 'valor sem Identificador: zero');
  });
});

test('listarConversasDiretasDoEndereco devolve so as diretas daquele endereco, com a Configuracao', () => {
  comAcervo((acervo) => {
    const direta = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: A, coletiva: false, configuracao: CFG_WHATSAPP });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: B, coletiva: false, configuracao: CFG_WHATSAPP });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true });
    assert.deepEqual(listarConversasDiretasDoEndereco(acervo, 'whatsapp', A), [{ id: direta, configuracaoId: CFG_WHATSAPP.id }]);
    assert.deepEqual(listarConversasDiretasDoEndereco(acervo, 'whatsapp', C), []);
    assert.deepEqual(listarConversasDiretasDoEndereco(acervo, 'whatsapp', '120363000000000001@g.us'), []);
  });
});
