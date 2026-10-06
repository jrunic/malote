import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { declararEnderecosDaConta } from '../src/nucleo/endereco-da-conta.js';
import { resolverEndereco, aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';

const JID = '5511900000001@s.whatsapp.net';
const LID = '100000000000001@lid';

function contar(acervo: { db: { prepare: (sql: string) => { get: () => unknown } } }, tabela: string): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

test('declarar cria o Identificador canonico e a correspondencia, e o alternativo passa a resolver', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID, alternativo: LID });
    assert.deepEqual(r, { identificadorCriado: true, correspondenciaAprendida: true, conflito: false });
    assert.equal(contar(acervo, 'identificadores'), 1);
    assert.equal(resolverEndereco(acervo, 'whatsapp', LID), JID);
  } finally {
    c.limpar();
  }
});

test('a segunda declaracao NAO escreve linha nem abre Operacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID, alternativo: LID });
    const identificadores = contar(acervo, 'identificadores');
    const operacoes = contar(acervo, 'operacoes');
    const r = declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID, alternativo: LID });
    assert.deepEqual(r, { identificadorCriado: false, correspondenciaAprendida: false, conflito: false });
    assert.equal(contar(acervo, 'identificadores'), identificadores);
    assert.equal(contar(acervo, 'operacoes'), operacoes);
  } finally {
    c.limpar();
  }
});

test('sem alternativo, so o Identificador nasce', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID });
    assert.deepEqual(r, { identificadorCriado: true, correspondenciaAprendida: false, conflito: false });
    assert.equal(contar(acervo, 'correspondencias_de_endereco'), 0);
  } finally {
    c.limpar();
  }
});

test('Identificador que ja existia e correspondencia nova: so a correspondencia e aprendida', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID });
    const r = declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID, alternativo: LID });
    assert.deepEqual(r, { identificadorCriado: false, correspondenciaAprendida: true, conflito: false });
  } finally {
    c.limpar();
  }
});

test('correspondencia que JA existia para o mesmo canonico (Identificador ausente): so o Identificador nasce, nada e "aprendido"', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: JID });
    const r = declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID, alternativo: LID });
    assert.deepEqual(r, { identificadorCriado: true, correspondenciaAprendida: false, conflito: false });
  } finally {
    c.limpar();
  }
});

test('o MESMO conflito repetido nao abre Operacao nenhuma (relata, sem escrever)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: '5511900000009@s.whatsapp.net' });
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID, alternativo: LID }); // cria o Identificador
    const operacoes = contar(acervo, 'operacoes');
    const r = declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID, alternativo: LID });
    assert.deepEqual(r, { identificadorCriado: false, correspondenciaAprendida: false, conflito: true });
    assert.equal(contar(acervo, 'operacoes'), operacoes, 'o conflito repetido nao pode abrir Operacao vazia');
  } finally {
    c.limpar();
  }
});

test('alternativo ja mapeado para OUTRO canonico: conflito relatado, o anterior fica, o Identificador nasce', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: '5511900000009@s.whatsapp.net' });
    const r = declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID, alternativo: LID });
    assert.equal(r.conflito, true);
    assert.equal(r.identificadorCriado, true);
    assert.equal(resolverEndereco(acervo, 'whatsapp', LID), '5511900000009@s.whatsapp.net', 'a primeira correspondencia permanece');
  } finally {
    c.limpar();
  }
});
