import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarEnvio } from '../src/nucleo/envio.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('registrarEnvio grava um pedido pendente com destino cru', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    assert.ok(r.identificadorDeEnvio.length > 0);

    const linha = acervo
      .preparar('SELECT estado, destino_cru, conversa_id, conteudo_texto, tentativas FROM envios WHERE id = ?')
      .get(r.envioId) as {
      estado: string;
      destino_cru: string | null;
      conversa_id: string | null;
      conteudo_texto: string | null;
      tentativas: number;
    };
    assert.equal(linha.estado, 'pendente');
    assert.equal(linha.destino_cru, '5511999990000@s.whatsapp.net');
    assert.equal(linha.conversa_id, null);
    assert.equal(linha.conteudo_texto, 'oi');
    assert.equal(linha.tentativas, 0);
  } finally {
    c.limpar();
  }
});

test('registrarEnvio com Conversa ja existente grava conversa_id, sem destino_cru', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5511999990000@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });

    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { conversaId },
      conteudo: { tipo: 'texto', texto: 'oi de novo' },
    });

    const linha = acervo
      .preparar('SELECT conversa_id, destino_cru FROM envios WHERE id = ?')
      .get(r.envioId) as { conversa_id: string | null; destino_cru: string | null };
    assert.equal(linha.conversa_id, conversaId);
    assert.equal(linha.destino_cru, null);
  } finally {
    c.limpar();
  }
});
