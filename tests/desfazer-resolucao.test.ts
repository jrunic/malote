import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG_CONTATOS } from './ajuda/configuracao.js';
import { cenario } from './ajuda/acervo.js';
import { fotografiaDeReferencias } from './ajuda/reconciliacao.js';
import { resolverRetroativamente } from '../src/nucleo/resolucao-retroativa.js';
import {
  registrarIdentificador,
  registrarConversa,
  registrarMensagem,
  registrarTransicao,
  registrarParticipacao,
  registrarCartaoDeCatalogo,
} from '../src/nucleo/escrita.js';
import { registrarNome } from '../src/nucleo/identidade.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const AGORA = 1_756_000_000_000;

/**
 * As cinco tabelas do inventario de uma vez, com colisao em todas as tres que
 * colidem — e o cenario que exercita repontar E fundir no mesmo desfazer.
 */
function montarCenarioCompleto(acervo: Acervo): void {
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'g9',
    coletiva: true,
  });
  const alt = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '999@alt' });
  const canon = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '999@canon' });

  registrarMensagem(acervo, {
      direcao: 'recebida',
    conversaId: conversa,
    fonte: 'whatsapp',
    idExterno: 'm9',
    autorId: alt.id,
    ocorridaEm: AGORA - 1_000,
    agora: AGORA,
  });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: alt.id, origem: 'material', nome: 'Fulano' });

  for (const quem of [alt.id, canon.id]) {
    registrarTransicao(acervo, {
      conversaId: conversa,
      identificadorId: quem,
      fonte: 'whatsapp',
      idExterno: 'ev9',
      natureza: 'entrou',
      codigoDaFonte: '27',
      ocorridaEm: AGORA - 5_000,
    });
    registrarParticipacao(acervo, {
      conversaId: conversa,
      identificadorId: quem,
      observadaEm: new Date(AGORA).toISOString(),
    });
    registrarCartaoDeCatalogo(
      acervo, quem, 'cartao-9', CFG_CONTATOS.id, new Date(AGORA).toISOString(),
    );
  }

  // TESTEMUNHA: um terceiro endereco que a correspondencia NAO menciona.
  // Sem ela, cada tabela tem uma linha so, e uma restauracao que escreve em
  // TODAS as linhas acerta a unica que existe — o teste passa e nao mede nada.
  // Medido: o mutante `WHERE 1 = 1 OR ...` sobrevivia sem esta parte.
  const outro = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '888@outro' });
  registrarMensagem(acervo, {
      direcao: 'recebida',
    conversaId: conversa,
    fonte: 'whatsapp',
    idExterno: 'm8',
    autorId: outro.id,
    ocorridaEm: AGORA - 2_000,
    agora: AGORA,
  });
  registrarNome(acervo, { autoridade: 'terceiro', identificadorId: outro.id, origem: 'material', nome: 'Sicrano' });
  registrarParticipacao(acervo, {
    conversaId: conversa,
    identificadorId: outro.id,
    observadaEm: new Date(AGORA).toISOString(),
  });

  // Uma Conversa em que SO o alternativo participa: aqui nao ha gemea, entao o
  // caminho exercitado e o de REPONTAR chave composta, e nao o de fundir.
  const soAlt = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'g8',
    coletiva: true,
  });
  registrarParticipacao(acervo, {
    conversaId: soAlt,
    identificadorId: alt.id,
    observadaEm: new Date(AGORA).toISOString(),
  });

  aprenderCorrespondencia(acervo, {
    fonte: 'whatsapp',
    alternativo: '999@alt',
    canonico: '999@canon',
  });
}

test('desfazer a resolucao devolve todas as referencias ao endereco alternativo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    montarCenarioCompleto(acervo);
    const antes = fotografiaDeReferencias(acervo);

    const r = resolverRetroativamente(acervo, { comEfeito: true });

    // Sem esta assercao, uma resolucao que nao faz NADA passa no teste de
    // reversibilidade: comparar o estado consigo mesmo sempre da igual.
    assert.notEqual(fotografiaDeReferencias(acervo), antes, 'a resolucao nao fez nada');
    assert.notEqual(r.operacaoId, null);

    const d = desfazerOperacao(acervo, r.operacaoId as string);

    assert.equal(d.recusados.length, 0, `recusas: ${JSON.stringify(d.recusados)}`);
    assert.equal(fotografiaDeReferencias(acervo), antes);
  } finally {
    c.limpar();
  }
});
