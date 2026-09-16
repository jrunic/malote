import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { relatarAcervo } from '../src/nucleo/relatorio-de-acervo.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-28T12:00:00.000Z');

/**
 * Material com uma idade por faixa, de propósito.
 *
 * A plausibilidade foi conferida em 28/08/2026: a janela do WhatsApp é
 * `2009-01-01 <= instante <= agora`, então nenhuma destas é rejeitada na
 * importação. Sem a conferência, o recorte de idade viria curto e o defeito
 * pareceria ser do relatório quando estaria na fixture.
 *
 * `tipo: 1` é obrigatório: o material falso usa `tipo ?? 0`, e 0 mapeia para
 * TEXTO. Sem ele o Anexo nasce com tipo 'text' e o recorte por tipo mede
 * outra coisa — foi assim que este teste falhou na primeira execução.
 */
function materialComIdades() {
  return backupFalso({
    conversas: [
      { pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 },
      { pk: 2, endereco: 'g@g.us', nome: 'Grupo', tipoDeSessao: 1 },
    ],
    mensagens: [
      {
        stanzaId: 'recente',
        chatSessionPk: 1,
        texto: null,
        tipo: 1,
        dataCoreData: paraCoreData('2026-08-20T12:00:00.000Z'),
        caminhoDeMidia: 'Media/a/1/r.jpg',
        tamanhoDeMidia: 1000,
      },
      {
        stanzaId: 'ano-passado',
        chatSessionPk: 1,
        texto: null,
        tipo: 1,
        dataCoreData: paraCoreData('2025-11-20T12:00:00.000Z'),
        caminhoDeMidia: 'Media/a/2/m.jpg',
        tamanhoDeMidia: 2000,
      },
      {
        stanzaId: 'tres-anos',
        chatSessionPk: 1,
        texto: null,
        tipo: 1,
        dataCoreData: paraCoreData('2024-03-20T12:00:00.000Z'),
        caminhoDeMidia: 'Media/a/3/t.jpg',
        tamanhoDeMidia: 3000,
      },
      {
        stanzaId: 'antigo',
        chatSessionPk: 2,
        texto: null,
        tipo: 2,
        dataCoreData: paraCoreData('2021-01-10T12:00:00.000Z'),
        caminhoDeMidia: 'Media/g/1/a.mp4',
        tamanhoDeMidia: 9000,
      },
    ],
  });
}

test('o relatório quebra o Acervo pelos quatro recortes', () => {
  const c = cenario();
  const b = materialComIdades();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });

    const r = relatarAcervo(acervo, { agora: AGORA });

    assert.equal(r.porFonte['whatsapp']?.anexos, 4, 'os quatro Anexos são de WhatsApp');
    assert.equal(r.porTipo['image']?.anexos, 3);
    assert.equal(r.porTipo['video']?.anexos, 1);
    assert.equal(r.porNaturezaDeConversa['direta']?.anexos, 3);
    assert.equal(r.porNaturezaDeConversa['coletiva']?.anexos, 1);
    assert.equal(r.porFaixaDeIdade['ate-30-dias']?.anexos, 1, 'o de agosto de 2026');
    // As faixas do meio precisam de caso proprio: sem elas, um erro de
    // fronteira entre `ate-1-ano` e `ate-3-anos` passaria verde para sempre.
    assert.equal(r.porFaixaDeIdade['ate-1-ano']?.anexos, 1, 'o de novembro de 2025');
    assert.equal(r.porFaixaDeIdade['ate-3-anos']?.anexos, 1, 'o de marco de 2024');
    assert.equal(r.porFaixaDeIdade['mais-de-3-anos']?.anexos, 1, 'o de 2021');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('o relatório separa bytes declarados de bytes presentes', () => {
  const c = cenario();
  const b = materialComIdades();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });

    const r = relatarAcervo(acervo, { agora: AGORA });
    // Nada foi trazido ainda: tudo declarado, nada presente.
    assert.equal(r.total.bytesDeclarados, 15_000, '1000 + 2000 + 3000 + 9000');
    assert.equal(r.total.bytesPresentes, 0);
    assert.equal(r.total.anexosPresentes, 0);
    assert.equal(r.total.anexosNuncaObtidos, 4);
    assert.equal(
      r.total.anexosSemTamanhoDeclarado,
      0,
      'os quatro têm tamanho declarado — é o caso do WhatsApp',
    );
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('Anexo sem tamanho declarado é contado à parte, e não como zero bytes', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'sem-tamanho',
        chatSessionPk: 1,
        texto: null,
        tipo: 1,
        dataCoreData: paraCoreData('2026-08-20T12:00:00.000Z'),
        caminhoDeMidia: 'Media/a/1/x.jpg',
      },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });

    const r = relatarAcervo(acervo, { agora: AGORA });
    assert.equal(r.total.anexos, 1);
    assert.equal(r.total.anexosSemTamanhoDeclarado, 1);
    assert.equal(
      r.total.bytesDeclarados,
      0,
      'zero bytes declarados e um Anexo sem declaração são coisas diferentes, ' +
        'e é a segunda contagem que distingue material que não declara de material não trazido',
    );
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('o consolidado roda sobre Acervo aberto só para leitura', () => {
  const c = cenario();
  const b = materialComIdades();
  try {
    const leia = c.novoInquilino('Leia Organa');
    importarMaterial(leia.acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
    leia.acervo.fechar();

    const somente = abrirAcervoSomenteLeitura(join(c.raiz, 'acervos'), leia.id);
    try {
      const r = relatarAcervo(somente, { agora: AGORA });
      assert.equal(r.total.anexos, 4, 'o relatório roda sobre Acervo aberto só para leitura');
      // A prova de que e so leitura: o SQLite recusa gravar.
      assert.throws(
        () => somente.db.prepare("UPDATE anexos SET presenca = 'descartado'").run(),
        /readonly/i,
      );
    } finally {
      somente.fechar();
    }
  } finally {
    b.limpar();
    c.limpar();
  }
});
