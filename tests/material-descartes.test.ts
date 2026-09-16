import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerMaterial } from '../src/adaptadores/whatsapp/material.js';
import { gravarMaterialLido } from '../src/adaptadores/whatsapp/importar.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const EM_USO = '2021-06-15T10:00:00Z';
const TIPO_ADMINISTRATIVO = 6;

/**
 * O CRITERIO 18 diz que nada some sem registro. Ate 12/09/2026 o leitor
 * descartava com `continue` mudo: a linha nao chegava ao laco de importacao,
 * entao nao entrava em `mensagensLidas` nem em `rejeicoesPorMotivo` — ela
 * simplesmente nao existia para o relatorio. Medido contra os dois materiais
 * reais: 96 Mensagens num, 3 no outro, todas com `ZCHATSESSION` NULO.
 *
 * Os testes abaixo assertam o INVARIANTE (lidas = emitidas + descartadas), nao
 * um numero: contagem certa por soma errada passaria; invariante nao.
 */

test('Mensagem sem Conversa e DESCARTADA e CONTADA, com motivo', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'boa', chatSessionPk: 1, texto: 'entra', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'orfa-1', chatSessionPk: null, texto: 'some', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'orfa-2', chatSessionPk: null, texto: 'some', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    const emitidas = [...material.mensagens];

    assert.equal(emitidas.length, 1, 'so a que tem Conversa e emitida');
    assert.equal(emitidas[0]?.idExterno, 'boa');

    // O INVARIANTE: nada some sem registro.
    const descartadas = Object.values(material.descartes.mensagens).reduce((a, b) => a + b, 0);
    assert.equal(emitidas.length + descartadas, 3, 'emitidas + descartadas = linhas do material');
    assert.equal(material.descartes.mensagens['conversa ausente no material'], 2);

    material.fechar();
  } finally {
    b.limpar();
  }
});

/**
 * O CONTADOR E PREGUICOSO, e este teste existe por causa disso.
 *
 * `lerMaterial` devolve ANTES de o gerador de Mensagens rodar uma unica vez. Um
 * numero copiado para o objeto de retorno congelaria em zero para sempre. O que
 * o Material expoe tem de ser o objeto VIVO que o gerador muta enquanto corre.
 */
test('o contador de Mensagens so tem valor DEPOIS de consumir o iterador', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'orfa', chatSessionPk: null, texto: null, dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    assert.equal(
      material.descartes.mensagens['conversa ausente no material'],
      undefined,
      'antes de iterar nao ha o que contar — e o contador nao pode mentir dizendo zero visto',
    );

    assert.equal([...material.mensagens].length, 0, 'a orfa nao e emitida');

    assert.equal(
      material.descartes.mensagens['conversa ausente no material'],
      1,
      'depois de iterar, o MESMO objeto precisa ter o numero',
    );
    material.fechar();
  } finally {
    b.limpar();
  }
});

test('evento administrativo sem Conversa e sem membro sao contados SEPARADO', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: '120363000000000000@g.us', nome: 'G', tipoDeSessao: 1 }],
    membros: [{ pk: 7, endereco: '5511900000002@s.whatsapp.net', conversaPk: 1 }],
    mensagens: [
      {
        stanzaId: 'ev-bom',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData(EM_USO),
        tipo: TIPO_ADMINISTRATIVO,
        codigoDeEvento: 1,
        grupoMembroPk: 7,
      },
      {
        stanzaId: 'ev-sem-conversa',
        chatSessionPk: null,
        texto: null,
        dataCoreData: paraCoreData(EM_USO),
        tipo: TIPO_ADMINISTRATIVO,
        codigoDeEvento: 1,
        grupoMembroPk: 7,
      },
      {
        stanzaId: 'ev-sem-membro',
        chatSessionPk: 1,
        texto: null,
        dataCoreData: paraCoreData(EM_USO),
        tipo: TIPO_ADMINISTRATIVO,
        codigoDeEvento: 1,
        grupoMembroPk: 999,
      },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);

    assert.equal(material.eventos.length, 1);
    assert.equal(material.eventos[0]?.idExterno, 'ev-bom');

    // DOIS motivos distintos, e nao um balde so: sao defeitos diferentes do
    // material, e juntar os dois esconde qual deles esta acontecendo.
    assert.equal(material.descartes.eventos['conversa ausente no material'], 1);
    assert.equal(material.descartes.eventos['membro ausente no material'], 1);

    const descartados = Object.values(material.descartes.eventos).reduce((a, b) => a + b, 0);
    assert.equal(material.eventos.length + descartados, 3);

    material.fechar();
  } finally {
    b.limpar();
  }
});

test('material integro nao inventa descarte', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'a', chatSessionPk: 1, texto: 'um', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    assert.equal([...material.mensagens].length, 1);
    assert.deepEqual(material.descartes.mensagens, {});
    assert.deepEqual(material.descartes.eventos, {});
    material.fechar();
  } finally {
    b.limpar();
  }
});

test('o relatorio da importacao CARREGA os descartes do leitor, e separados das rejeicoes', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'boa', chatSessionPk: 1, texto: 'entra', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'orfa', chatSessionPk: null, texto: null, dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const material = lerMaterial(b.raiz);
    const r = gravarMaterialLido(acervo, material, {
      agora: Date.parse('2026-09-12T12:00:00Z'),
      configuracao: CFG_WHATSAPP,
    });
    material.fechar();

    // Contador que fica no Material e nao chega ao relatorio e o MESMO silencio,
    // um nivel acima: quem opera le o relatorio, nao o objeto do leitor.
    assert.equal(r.descartesDoLeitor['conversa ausente no material'], 1);

    // SEPARADOS de propósito: rejeicao e decisao da importacao sobre linha que
    // chegou; descarte e a leitura constatando material contraditorio.
    assert.deepEqual(r.rejeicoesPorMotivo, {});
    assert.equal(r.mensagensLidas, 1, 'a orfa nem chega a ser lida pela importacao');
  } finally {
    b.limpar();
    c.limpar();
  }
});

/**
 * O ACHADO-IRMAO da #817, medido em 07/09/2026: o material de abril repete 455
 * linhas por `ZSTANZAID`. Elas colapsam na restricao de unicidade do Acervo e
 * sao reportadas como "ja existentes" — entao quem le o relatorio conclui que
 * ja estavam la, quando na verdade eram repeticoes do PROPRIO material.
 *
 * Contado por CONSULTA, nunca retendo ids: medido contra o material real, 256 ms
 * por indice coberto e zero memoria no processo. Reter 1,2 milhao de ids
 * contrariaria a decisao de memoria que o ciclo 12 tomou.
 */
test('linha repetida no proprio material e contada, separada de "ja existente"', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'dupla', chatSessionPk: 1, texto: 'a', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'dupla', chatSessionPk: 1, texto: 'a', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'unica', chatSessionPk: 1, texto: 'b', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    assert.equal(material.linhasRepetidasNoMaterial, 1, '3 linhas, 2 identificadores');
    material.fechar();
  } finally {
    b.limpar();
  }
});

test('material sem repeticao conta zero — e zero e afirmacao, nao ausencia', () => {
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'x@s.whatsapp.net', nome: null, tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'a', chatSessionPk: 1, texto: 'um', dataCoreData: paraCoreData(EM_USO) },
      { stanzaId: 'b', chatSessionPk: 1, texto: 'dois', dataCoreData: paraCoreData(EM_USO) },
    ],
  });
  try {
    const material = lerMaterial(b.raiz);
    assert.equal(material.linhasRepetidasNoMaterial, 0);
    material.fechar();
  } finally {
    b.limpar();
  }
});
