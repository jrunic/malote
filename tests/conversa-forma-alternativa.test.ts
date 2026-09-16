import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { conferirConversasEmFormaAlternativa } from '../src/nucleo/integridade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('conta Conversa cujo id externo esta na forma alternativa de um endereco conhecido', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular de Teste');
    // Ordem do defeito: a Conversa nasce antes de a correspondencia existir.
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'aaa@alt', coletiva: false, configuracao: CFG_WHATSAPP });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: 'bbb@canon', coletiva: false, configuracao: CFG_WHATSAPP });

    // Sem correspondencia, nao ha forma alternativa: um detector que so
    // contasse Conversas daria 2 aqui e passaria a segunda assercao por
    // acidente.
    assert.equal(conferirConversasEmFormaAlternativa(acervo), 0, 'contou sem correspondencia');

    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: 'aaa@alt',
      canonico: 'aaa@canon',
    });

    assert.equal(conferirConversasEmFormaAlternativa(acervo), 1);
  } finally {
    c.limpar();
  }
});
