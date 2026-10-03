import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registrarEnvio,
  proximoEnvioPendente,
  marcarEnvioEnviado,
  marcarEnvioFalhou,
  incrementarTentativaDeEnvio,
} from '../src/nucleo/envio.js';
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

test('proximoEnvioPendente acha o pendente da Configuracao, por ordem de solicitacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r1 = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'primeiro' },
    });
    registrarEnvio(acervo, {
      configuracaoId: 'outra-configuracao',
      destino: { enderecoCru: '222@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'de outra conta' },
    });

    const proximo = proximoEnvioPendente(acervo, CFG_WHATSAPP.id);
    assert.equal(proximo?.envioId, r1.envioId);
    assert.equal(proximo?.conteudo.tipo, 'texto');
    assert.equal(proximo?.conteudo.texto, 'primeiro');
  } finally {
    c.limpar();
  }
});

test('proximoEnvioPendente prioriza menos tentativas, para nao travar a fila', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r1 = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'tentou antes' },
    });
    const r2 = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '222@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'nunca tentou' },
    });
    incrementarTentativaDeEnvio(acervo, r1.envioId);

    const proximo = proximoEnvioPendente(acervo, CFG_WHATSAPP.id);
    assert.equal(proximo?.envioId, r2.envioId);
  } finally {
    c.limpar();
  }
});

test('proximoEnvioPendente devolve undefined quando a fila da Configuracao esta vazia', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    assert.equal(proximoEnvioPendente(acervo, CFG_WHATSAPP.id), undefined);
  } finally {
    c.limpar();
  }
});

test('marcarEnvioEnviado grava o estado final e o instante de conclusao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    marcarEnvioEnviado(acervo, r.envioId);

    const linha = acervo
      .preparar('SELECT estado, concluida_em FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; concluida_em: string | null };
    assert.equal(linha.estado, 'enviado');
    assert.ok(linha.concluida_em !== null);
  } finally {
    c.limpar();
  }
});

test('marcarEnvioFalhou grava o motivo e nao mexe em outro Envio', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    marcarEnvioFalhou(acervo, r.envioId, 'destinatario invalido');

    const linha = acervo
      .preparar('SELECT estado, motivo_falha FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; motivo_falha: string | null };
    assert.equal(linha.estado, 'falhou');
    assert.equal(linha.motivo_falha, 'destinatario invalido');
  } finally {
    c.limpar();
  }
});

test('incrementarTentativaDeEnvio soma uma tentativa, mantendo pendente', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    incrementarTentativaDeEnvio(acervo, r.envioId);
    incrementarTentativaDeEnvio(acervo, r.envioId);

    const linha = acervo
      .preparar('SELECT estado, tentativas FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; tentativas: number };
    assert.equal(linha.estado, 'pendente');
    assert.equal(linha.tentativas, 2);
  } finally {
    c.limpar();
  }
});
