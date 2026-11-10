import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarNome } from '../src/nucleo/identidade.js';
import { marcarConversa } from '../src/nucleo/marca-do-titular.js';
import {
  identificadorDoEndereco,
  listarConversasDiretasComContagem,
  marcasDaConversa,
} from '../src/nucleo/uniao-de-conversas.js';

// #1440, Plano 1: as portas de LEITURA do ensaio da uniao. O sufixo e do Adaptador; o nucleo nao o conhece.

const SUFIXO = '@opaco.teste';
const OPACO_A = '300000000000001@opaco.teste';
const OPACO_B = '300000000000002@opaco.teste';
const NUMERO = '556500000001@numero.teste';
const AGORA = 1_790_000_000_000;

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

function mensagens(acervo: Acervo, conversaId: string, prefixo: string, n: number): void {
  for (let i = 1; i <= n; i++) {
    registrarMensagem(acervo, {
      origemDaChegada: 'importacao',
      direcao: i % 2 === 0 ? 'enviada' : 'recebida',
      conversaId,
      fonte: 'whatsapp',
      idExterno: `${prefixo}-${i}`,
      ocorridaEm: AGORA - 10_000 + i,
      agora: AGORA,
    });
  }
}

test('lista so as Conversas diretas da Fonte com o sufixo, com a Configuracao, o endereco e a contagem de Mensagens', () => {
  comAcervo((acervo) => {
    const a = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: OPACO_A, coletiva: false, configuracao: CFG_WHATSAPP });
    const b = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: OPACO_B, coletiva: false, configuracao: CFG_WHATSAPP_SEGUNDA });
    const n = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: NUMERO, coletiva: false, configuracao: CFG_WHATSAPP });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: `120363000000000009${SUFIXO}`, coletiva: true });
    registrarConversa(acervo, {
      fonte: 'instagram',
      idExterno: `alguem${SUFIXO}`,
      coletiva: false,
      configuracao: { id: 'cfg-ig', fonte: 'instagram' },
    });
    mensagens(acervo, a, 'a', 3);
    mensagens(acervo, n, 'n', 2);

    const lidas = listarConversasDiretasComContagem(acervo, 'whatsapp', SUFIXO, '', 100);

    const esperadas = [
      { id: a, configuracaoId: CFG_WHATSAPP.id, endereco: OPACO_A, mensagens: 3 },
      { id: b, configuracaoId: CFG_WHATSAPP_SEGUNDA.id, endereco: OPACO_B, mensagens: 0 },
    ].sort((x, y) => (x.id < y.id ? -1 : 1));
    assert.deepEqual(lidas, esperadas);
  });
});

test('pagina por id depois do cursor, e recusa limite que nao e inteiro positivo e sufixo vazio', () => {
  comAcervo((acervo) => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        registrarConversa(acervo, {
          fonte: 'whatsapp',
          idExterno: `30000000000001${i}${SUFIXO}`,
          coletiva: false,
          configuracao: CFG_WHATSAPP,
        }),
      );
    }
    ids.sort();
    const vistos: string[] = [];
    let cursor = '';
    // Teto de voltas: um cursor que nao avanca seria laco infinito, e o teste tem de falhar por asserção, nao por prazo.
    for (let volta = 0; ; volta++) {
      assert.ok(volta < 10, 'a paginacao nao avanca');
      const pagina = listarConversasDiretasComContagem(acervo, 'whatsapp', SUFIXO, cursor, 2);
      if (pagina.length === 0) break;
      assert.ok(pagina.length <= 2);
      for (const c of pagina) vistos.push(c.id);
      cursor = pagina[pagina.length - 1]!.id;
    }
    assert.deepEqual(vistos, ids);
    assert.throws(() => listarConversasDiretasComContagem(acervo, 'whatsapp', SUFIXO, '', 0), RangeError);
    assert.throws(() => listarConversasDiretasComContagem(acervo, 'whatsapp', SUFIXO, '', 1.5), RangeError);
    assert.throws(() => listarConversasDiretasComContagem(acervo, 'whatsapp', '', '', 10), RangeError);
  });
});

test('marcasDaConversa devolve as marcas da Conversa, por Configuracao, e nada da outra Conversa', () => {
  comAcervo((acervo) => {
    const a = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: OPACO_A, coletiva: false, configuracao: CFG_WHATSAPP });
    const n = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: NUMERO, coletiva: false, configuracao: CFG_WHATSAPP });
    assert.deepEqual(marcasDaConversa(acervo, a), []);
    marcarConversa(acervo, { conversaId: a, marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: AGORA });
    assert.deepEqual(marcasDaConversa(acervo, a), [{ marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }]);
    assert.deepEqual(marcasDaConversa(acervo, n), []);
  });
});

test('identificadorDoEndereco: null sem Identificador; comNome so com Atribuicao de Nome; a Fonte distingue', () => {
  comAcervo((acervo) => {
    assert.equal(identificadorDoEndereco(acervo, 'whatsapp', NUMERO), null);
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: NUMERO });
    assert.deepEqual(identificadorDoEndereco(acervo, 'whatsapp', NUMERO), { id, comNome: false });
    assert.equal(identificadorDoEndereco(acervo, 'instagram', NUMERO), null);
    registrarNome(acervo, { identificadorId: id, origem: 'whatsapp', nome: 'Nome Sintetico', autoridade: 'terceiro' });
    assert.deepEqual(identificadorDoEndereco(acervo, 'whatsapp', NUMERO), { id, comNome: true });
  });
});
