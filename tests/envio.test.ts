import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registrarEnvio,
  proximoEnvioPendente,
  marcarEnvioEnviado,
  marcarEnvioFalhou,
  incrementarTentativaDeEnvio,
  atualizarConversaDoEnvio,
  listarEnviosFalhos,
  reenfileirarEnviosFalhos,
  contarEnviosPorEstado,
  lerEnvio,
  examinarRepeticao,
  EnvioDivergenteError,
} from '../src/nucleo/envio.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
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

test('atualizarConversaDoEnvio grava a Conversa resolvida e apaga o destino cru', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '111@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });

    atualizarConversaDoEnvio(acervo, r.envioId, conversaId);

    const linha = acervo
      .preparar('SELECT conversa_id, destino_cru FROM envios WHERE id = ?')
      .get(r.envioId) as { conversa_id: string | null; destino_cru: string | null };
    assert.equal(linha.conversa_id, conversaId);
    assert.equal(linha.destino_cru, null);
  } finally {
    c.limpar();
  }
});

test('reenfileirarEnviosFalhos volta falhas para pendente, zera tentativas, e grava Operacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    incrementarTentativaDeEnvio(acervo, r.envioId);
    marcarEnvioFalhou(acervo, r.envioId, 'erro definitivo');

    const n = reenfileirarEnviosFalhos(acervo);
    assert.equal(n, 1);
    assert.deepEqual(listarEnviosFalhos(acervo), []);

    const linha = acervo
      .preparar('SELECT estado, tentativas FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; tentativas: number };
    assert.equal(linha.estado, 'pendente');
    assert.equal(linha.tentativas, 0);
  } finally {
    c.limpar();
  }
});

test('reenfileirarEnviosFalhos sem falha pendente devolve zero e nao grava Operacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const antes = (acervo.preparar('SELECT COUNT(*) AS n FROM operacoes').get() as { n: number }).n;
    assert.equal(reenfileirarEnviosFalhos(acervo), 0);
    const depois = (acervo.preparar('SELECT COUNT(*) AS n FROM operacoes').get() as { n: number }).n;
    assert.equal(depois, antes);
  } finally {
    c.limpar();
  }
});

test('contarEnviosPorEstado agrupa por estado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'a' },
    });
    const r2 = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '222@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'b' },
    });
    marcarEnvioFalhou(acervo, r2.envioId, 'x');

    const contagens = contarEnviosPorEstado(acervo);
    assert.deepEqual(
      contagens.sort((a, b) => a.estado.localeCompare(b.estado)),
      [
        { estado: 'enviado', n: 0 },
        { estado: 'falhou', n: 1 },
        { estado: 'pendente', n: 1 },
      ],
    );
  } finally {
    c.limpar();
  }
});

test('registrarEnvio com imagem grava caminho e mimetype, e a legenda em conteudo_texto', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: {
        tipo: 'imagem',
        caminhoArquivo: '/tmp/staging/x.jpg',
        mimetype: 'image/jpeg',
        legenda: 'uma legenda',
      },
    });

    const linha = acervo
      .preparar(
        `SELECT conteudo_tipo, conteudo_texto, conteudo_caminho_arquivo, conteudo_mimetype
           FROM envios WHERE id = ?`,
      )
      .get(r.envioId) as {
      conteudo_tipo: string;
      conteudo_texto: string | null;
      conteudo_caminho_arquivo: string | null;
      conteudo_mimetype: string | null;
    };
    assert.equal(linha.conteudo_tipo, 'imagem');
    assert.equal(linha.conteudo_texto, 'uma legenda');
    assert.equal(linha.conteudo_caminho_arquivo, '/tmp/staging/x.jpg');
    assert.equal(linha.conteudo_mimetype, 'image/jpeg');
  } finally {
    c.limpar();
  }
});

test('registrarEnvio com documento grava nome de arquivo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: {
        tipo: 'documento',
        caminhoArquivo: '/tmp/staging/doc.pdf',
        mimetype: 'application/pdf',
        nomeDeArquivo: 'relatorio.pdf',
      },
    });

    const linha = acervo
      .preparar(`SELECT conteudo_nome_arquivo FROM envios WHERE id = ?`)
      .get(r.envioId) as { conteudo_nome_arquivo: string | null };
    assert.equal(linha.conteudo_nome_arquivo, 'relatorio.pdf');
  } finally {
    c.limpar();
  }
});

test('proximoEnvioPendente devolve o conteudo de imagem com os campos certos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: {
        tipo: 'imagem',
        caminhoArquivo: '/tmp/staging/x.jpg',
        mimetype: 'image/jpeg',
      },
    });

    const proximo = proximoEnvioPendente(acervo, CFG_WHATSAPP.id);
    assert.equal(proximo?.conteudo.tipo, 'imagem');
    if (proximo?.conteudo.tipo === 'imagem') {
      assert.equal(proximo.conteudo.caminhoArquivo, '/tmp/staging/x.jpg');
      assert.equal(proximo.conteudo.mimetype, 'image/jpeg');
      assert.equal(proximo.conteudo.legenda, undefined);
    }
  } finally {
    c.limpar();
  }
});

const ID_FORNECIDO = '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f';
const PARA = '5511999990000@s.whatsapp.net';

function entradaDeTexto(texto: string, extra: object = {}) {
  return {
    configuracaoId: CFG_WHATSAPP.id,
    destino: { enderecoCru: PARA },
    conteudo: { tipo: 'texto' as const, texto },
    identificadorDeEnvio: ID_FORNECIDO,
    fonte: 'whatsapp' as const,
    ...extra,
  };
}

function contar(acervo: { preparar: (s: string) => { get: () => unknown } }, tabela: string): number {
  return (acervo.preparar(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

test('identificador fornecido e gravado como veio, e o registro nao e repeticao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, entradaDeTexto('oi'));
    assert.equal(r.identificadorDeEnvio, ID_FORNECIDO);
    assert.equal(r.repetido, false);
    assert.equal(lerEnvio(acervo, ID_FORNECIDO)?.envioId, r.envioId);
  } finally {
    c.limpar();
  }
});

test('o mesmo identificador e o mesmo pedido: devolve o existente, sem linha e sem Operacao novas', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const primeiro = registrarEnvio(acervo, entradaDeTexto('oi'));
    const operacoes = contar(acervo, 'operacoes');
    const segundo = registrarEnvio(acervo, entradaDeTexto('oi'));
    assert.equal(segundo.repetido, true);
    assert.equal(segundo.envioId, primeiro.envioId);
    assert.equal(contar(acervo, 'envios'), 1);
    assert.equal(contar(acervo, 'operacoes'), operacoes, 'a repeticao nao grava Operacao');
  } finally {
    c.limpar();
  }
});

test('o mesmo identificador com conteudo ou destino diferentes: diverge, e nada muda', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    registrarEnvio(acervo, entradaDeTexto('oi'));
    const operacoes = contar(acervo, 'operacoes');
    assert.throws(() => registrarEnvio(acervo, entradaDeTexto('outro texto')), EnvioDivergenteError);
    assert.throws(
      () => registrarEnvio(acervo, entradaDeTexto('oi', { destino: { enderecoCru: '5511888880000@s.whatsapp.net' } })),
      EnvioDivergenteError,
    );
    assert.throws(
      () => registrarEnvio(acervo, entradaDeTexto('oi', { configuracaoId: 'outra-configuracao' })),
      EnvioDivergenteError,
    );
    assert.equal(contar(acervo, 'envios'), 1);
    assert.equal(contar(acervo, 'operacoes'), operacoes);
  } finally {
    c.limpar();
  }
});

test('repeticao DEPOIS do processamento: o destino ja virou Conversa e continua sendo o mesmo pedido', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const primeiro = registrarEnvio(acervo, entradaDeTexto('oi'));
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: PARA,
      coletiva: false,
      configuracao: CFG_WHATSAPP,
      bruto: '{}',
    });
    atualizarConversaDoEnvio(acervo, primeiro.envioId, conversaId);
    marcarEnvioEnviado(acervo, primeiro.envioId);
    const repetido = registrarEnvio(acervo, entradaDeTexto('oi'));
    assert.equal(repetido.repetido, true, 'o destino cru ja foi zerado, e o endereco da Conversa e o mesmo');
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: '999@lid', canonico: PARA });
    const pelaFormaAlternativa = registrarEnvio(acervo, entradaDeTexto('oi', { destino: { enderecoCru: '999@lid' } }));
    assert.equal(pelaFormaAlternativa.repetido, true, 'a forma alternativa resolve para o mesmo endereco');
    assert.throws(
      () => registrarEnvio(acervo, entradaDeTexto('oi', { destino: { enderecoCru: '5511888880000@s.whatsapp.net' } })),
      EnvioDivergenteError,
    );
  } finally {
    c.limpar();
  }
});

test('identificador fornecido exige a Fonte, para comparar o endereco', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const { fonte: _fonte, ...semFonte } = entradaDeTexto('oi');
    assert.throws(() => registrarEnvio(acervo, semFonte), /fonte/);
  } finally {
    c.limpar();
  }
});

test('examinarRepeticao distingue nova, repetido e divergente sem escrever nada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    assert.deepEqual(examinarRepeticao(acervo, entradaDeTexto('oi')), { resultado: 'nova' });
    const r = registrarEnvio(acervo, entradaDeTexto('oi'));
    assert.deepEqual(examinarRepeticao(acervo, entradaDeTexto('oi')), { resultado: 'repetido', envioId: r.envioId });
    assert.deepEqual(examinarRepeticao(acervo, entradaDeTexto('x')), { resultado: 'divergente' });
    assert.equal(contar(acervo, 'envios'), 1);
  } finally {
    c.limpar();
  }
});

test('lerEnvio acha por id ou por identificador, e devolve undefined para o que nao existe', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, entradaDeTexto('oi'));
    const porId = lerEnvio(acervo, r.envioId);
    assert.equal(porId?.identificadorDeEnvio, ID_FORNECIDO);
    assert.equal(porId?.estado, 'pendente');
    assert.equal(porId?.tentativas, 0);
    assert.equal(porId?.tipo, 'texto');
    assert.equal(porId?.motivoFalha, null);
    assert.equal(porId?.concluidaEm, null);
    assert.equal(lerEnvio(acervo, 'nao-existe'), undefined);
    marcarEnvioFalhou(acervo, r.envioId, 'destino invalido');
    assert.equal(lerEnvio(acervo, ID_FORNECIDO)?.motivoFalha, 'destino invalido');
  } finally {
    c.limpar();
  }
});

test('contarEnviosPorEstado devolve os tres estados, com zero quando nao ha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    assert.deepEqual(contarEnviosPorEstado(acervo), [
      { estado: 'enviado', n: 0 },
      { estado: 'falhou', n: 0 },
      { estado: 'pendente', n: 0 },
    ]);
    registrarEnvio(acervo, entradaDeTexto('oi'));
    const pendente = contarEnviosPorEstado(acervo).find((x) => x.estado === 'pendente');
    assert.equal(pendente?.n, 1);
  } finally {
    c.limpar();
  }
});
