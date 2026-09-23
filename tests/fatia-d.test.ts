import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  registrarConversa,
  registrarMensagem,
  registrarIdentificador,
  registrarTransicao,
} from '../src/nucleo/escrita.js';
import { criarPessoa, vincularIdentificador, registrarNome } from '../src/nucleo/identidade.js';
import { contarPorFonte, procurarPessoas } from '../src/nucleo/consulta.js';
import { quemEstavaEm } from '../src/nucleo/presenca.js';

function fixture() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Ahsoka');
  const id1 = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001@s.whatsapp.net' }).id;
  const pessoaId = criarPessoa(acervo);
  vincularIdentificador(acervo, {
    identificadorId: id1,
    pessoaId,
    procedencia: 'material',
  });
  registrarNome(acervo, {
    identificadorId: id1,
    nome: 'Bail Organa',
    origem: 'whatsapp',
    autoridade: 'terceiro',
  });
  const p1 = pessoaId;
  const c1 = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '1@g.us',
    coletiva: true,
    metadadosDeColetiva: { assunto: 'Grupo de trabalho' },
  });
  registrarTransicao(acervo, {
    conversaId: c1,
    identificadorId: id1,
    natureza: 'entrou',
    ocorridaEm: Date.parse('2026-01-01T00:00:00Z'),
    fonte: 'whatsapp',
    idExterno: 'stanza-1',
    codigoDaFonte: '15',
  });
  registrarMensagem(acervo, {
      direcao: 'recebida',
    conversaId: c1,
    fonte: 'whatsapp',
    idExterno: 'm1',
    ocorridaEm: Date.parse('2026-02-10T12:00:00Z'),
    agora: Date.parse('2026-02-11T00:00:00Z'),
    conteudo: 'bom dia grupo',
  });
  return { c, acervo, p1, c1 };
}

test('procurarPessoas acha por nome e por endereco, literal', () => {
  const { c, acervo, p1 } = fixture();
  try {
    const porNome = procurarPessoas(acervo, { texto: 'organa' });
    assert.equal(porNome.length, 1);
    assert.equal(porNome[0]!.id, p1);
    const porEndereco = procurarPessoas(acervo, { texto: '5565900000001' });
    assert.equal(porEndereco.length, 1);
    assert.equal(procurarPessoas(acervo, { texto: 'ninguem-distinto' }).length, 0);
  } finally {
    c.limpar();
  }
});

test('participantes: quem estava na conversa na data', () => {
  const { c, acervo, c1 } = fixture();
  try {
    // A COLISAO DE BORDA que o CONTEXTO manda testar: o Alcance aqui comeca e
    // termina no MESMO instante (a unica transicao) — as duas bordas colidem.
    // `em` no instante exato: o limite e inclusivo dos dois lados.
    const r = quemEstavaEm(acervo, {
      conversaId: c1,
      em: Date.parse('2026-01-01T00:00:00Z'),
    });
    assert.equal(r.dentroDoAlcance, true);
    assert.equal(r.presentes.length, 1);
  } finally {
    c.limpar();
  }
});

test('contarPorFonte separa direta/coletiva e por fonte', () => {
  const { c, acervo } = fixture();
  try {
    const r = contarPorFonte(acervo);
    assert.equal(r.conversas.porFonte['whatsapp']?.coletiva, 1);
    assert.equal(r.conversas.porFonte['whatsapp']?.direta, 0);
    assert.equal(r.mensagens.porFonte['whatsapp'], 1);
    assert.equal(r.conversas.total, 1);
    assert.equal(r.mensagens.total, 1);
  } finally {
    c.limpar();
  }
});
