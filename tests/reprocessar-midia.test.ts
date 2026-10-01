import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { reprocessarMidiaNuncaObtida } from '../src/adaptadores/whatsapp/reprocessar-midia.js';

const BRUTO_AO_VIVO_VIDEO = JSON.stringify({
  key: { remoteJid: '5511000000001@s.whatsapp.net', id: 'M1', fromMe: false },
  messageTimestamp: 1_700_000_000,
  message: { videoMessage: { mediaKey: 'AAAA', directPath: '/x' } },
});

const BRUTO_DE_BACKUP = JSON.stringify({ Z_PK: 1, ZMESSAGETYPE: 1 });

function anexoNuncaObtido(
  acervo: Acervo,
  opcoes: { idExterno: string; tipo: string; mensagemBruto: string },
): string {
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp', idExterno: `conversa-${opcoes.idExterno}`, coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
  const mensagemId = registrarMensagem(acervo, {
    conversaId, fonte: 'whatsapp', idExterno: opcoes.idExterno, ocorridaEm: 1_700_000_000_000,
    agora: Date.now(), direcao: 'recebida', bruto: opcoes.mensagemBruto,
  });
  return registrarAnexo(acervo, {
    mensagemId, tipo: opcoes.tipo, presenca: 'nunca-obtido', bruto: '{}',
  });
}

test('Anexo elegivel: baixa, grava, marca presente (#1084)', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const anexoId = anexoNuncaObtido(acervo, {
      idExterno: 'M1', tipo: 'video', mensagemBruto: BRUTO_AO_VIVO_VIDEO,
    });

    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => Promise.resolve(Buffer.from('bytes-de-verdade')),
    });

    assert.equal(r.recuperados, 1);
    assert.equal(r.bytesRecuperados, Buffer.from('bytes-de-verdade').length);
    assert.equal(r.falhas, 0);
    const linha = acervo.db.prepare('SELECT presenca, caminho FROM anexos WHERE id = ?').get(anexoId) as {
      presenca: string; caminho: string;
    };
    assert.equal(linha.presenca, 'presente');
    assert.ok(existsSync(join(d.raiz, linha.caminho)));
    assert.equal(readFileSync(join(d.raiz, linha.caminho), 'utf8'), 'bytes-de-verdade');
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('falha de download conta como falha, mantem nunca-obtido, NAO derruba os demais', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const falho = anexoNuncaObtido(acervo, {
      idExterno: 'M1', tipo: 'video', mensagemBruto: BRUTO_AO_VIVO_VIDEO,
    });
    const emOutraMensagem = JSON.stringify({
      key: { remoteJid: '5511000000002@s.whatsapp.net', id: 'M2', fromMe: false },
      messageTimestamp: 1_700_000_001,
      message: { imageMessage: { mediaKey: 'BBBB', directPath: '/y' } },
    });
    const recuperavel = anexoNuncaObtido(acervo, {
      idExterno: 'M2', tipo: 'image', mensagemBruto: emOutraMensagem,
    });

    let chamadas = 0;
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => {
        chamadas += 1;
        return chamadas === 1
          ? Promise.reject(new Error('bad decrypt'))
          : Promise.resolve(Buffer.from('ok'));
      },
    });

    assert.equal(r.falhas, 1);
    assert.equal(r.recuperados, 1);
    const linhaFalha = acervo.db.prepare('SELECT presenca FROM anexos WHERE id = ?').get(falho) as {
      presenca: string;
    };
    assert.equal(linhaFalha.presenca, 'nunca-obtido', 'a falha nao muda a Presenca');
    const linhaOk = acervo.db.prepare('SELECT presenca FROM anexos WHERE id = ?').get(recuperavel) as {
      presenca: string;
    };
    assert.equal(linhaOk.presenca, 'presente', 'o segundo Anexo nao foi derrubado pela falha do primeiro');
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('bruto de material IMPORTADO nunca e elegivel, e conta como nao-elegivel', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const anexoId = anexoNuncaObtido(acervo, {
      idExterno: 'M1', tipo: 'video', mensagemBruto: BRUTO_DE_BACKUP,
    });

    let chamouBaixar = false;
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => {
        chamouBaixar = true;
        return Promise.resolve(Buffer.from('nunca deveria chegar aqui'));
      },
    });

    assert.equal(chamouBaixar, false, 'nao tenta baixar o que nao e elegivel');
    assert.equal(r.naoElegiveis, 1);
    assert.equal(r.recuperados, 0);
    const linha = acervo.db.prepare('SELECT presenca FROM anexos WHERE id = ?').get(anexoId) as {
      presenca: string;
    };
    assert.equal(linha.presenca, 'nunca-obtido');
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('sem Anexo nunca-obtido nenhum, devolve relatorio zerado sem tentar nada', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    let chamouBaixar = false;
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => { chamouBaixar = true; return Promise.resolve(Buffer.from('x')); },
    });
    assert.equal(chamouBaixar, false);
    assert.deepEqual(r, { recuperados: 0, bytesRecuperados: 0, falhas: 0, naoElegiveis: 0 });
  } finally {
    c.limpar();
    d.limpar();
  }
});
