import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import {
  proximoElegivel,
  marcarPendente,
  marcarConcluida,
  marcarFalhou,
  listarFalhas,
  reenfileirarFalhas,
  incluirEstoqueEmTranscricao,
  contarTranscricoesPorEstado,
} from '../src/nucleo/transcricao.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

function mensagemDeTeste(acervo: import('../src/nucleo/acervo.js').Acervo): string {
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: '111@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
  return registrarMensagem(acervo, {
    direcao: 'recebida',
    conversaId,
    fonte: 'whatsapp',
    idExterno: 'm1',
    ocorridaEm: Date.parse('2026-09-01T12:00:00Z'),
    agora: Date.now(),
  });
}

test('proximoElegivel acha audio presente sem linha em transcricoes', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const mensagemId = mensagemDeTeste(acervo);
    const anexoId = registrarAnexo(acervo, {
      mensagemId,
      tipo: 'audio',
      presenca: 'presente',
      caminho: '/x/a1.opus',
    });

    const elegivel = proximoElegivel(acervo);
    assert.equal(elegivel?.anexoId, anexoId);
    assert.equal(elegivel?.caminho, '/x/a1.opus');
  } finally {
    c.limpar();
  }
});

test('Anexo fora-de-escopo, nunca-obtido ou de outro tipo nunca sao elegiveis', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const mensagemId = mensagemDeTeste(acervo);
    const audioFora = registrarAnexo(acervo, {
      mensagemId,
      tipo: 'audio',
      presenca: 'presente',
      caminho: '/x/a1.opus',
    });
    acervo
      .preparar(`INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'fora-de-escopo')`)
      .run(audioFora);
    registrarAnexo(acervo, { mensagemId, tipo: 'audio', presenca: 'nunca-obtido' });
    registrarAnexo(acervo, { mensagemId, tipo: 'image', presenca: 'presente', caminho: '/x/a3.jpg' });

    assert.equal(proximoElegivel(acervo), undefined);
  } finally {
    c.limpar();
  }
});

test('proximoElegivel tambem alcanca Anexo pendente orfao (processo morto antes de concluir)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const mensagemId = mensagemDeTeste(acervo);
    const anexoId = registrarAnexo(acervo, {
      mensagemId,
      tipo: 'audio',
      presenca: 'presente',
      caminho: '/x/a1.opus',
    });
    marcarPendente(acervo, anexoId);

    // Sem isto, um Anexo que ficou 'pendente' porque o processo morreu entre
    // marcarPendente e marcarConcluida nunca mais seria escolhido — nem por
    // reenfileirarFalhas (ele so alcanca 'falhou').
    const elegivel = proximoElegivel(acervo);
    assert.equal(elegivel?.anexoId, anexoId);
  } finally {
    c.limpar();
  }
});

test('marcarPendente e idempotente, marcarConcluida e marcarFalhou transitam o estado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const mensagemId = mensagemDeTeste(acervo);
    const anexoId = registrarAnexo(acervo, {
      mensagemId,
      tipo: 'audio',
      presenca: 'presente',
      caminho: '/x/a1.opus',
    });

    marcarPendente(acervo, anexoId);
    marcarPendente(acervo, anexoId); // segunda chamada nao duplica nem lanca
    const linhaPendente = acervo.preparar('SELECT estado FROM transcricoes WHERE anexo_id = ?').get(anexoId) as {
      estado: string;
    };
    assert.equal(linhaPendente.estado, 'pendente');

    marcarConcluida(acervo, anexoId, 'texto transcrito', 'whisper.cpp', 'small');
    const linhaConcluida = acervo
      .preparar('SELECT estado, texto, motor, modelo FROM transcricoes WHERE anexo_id = ?')
      .get(anexoId) as { estado: string; texto: string; motor: string; modelo: string };
    assert.equal(linhaConcluida.estado, 'concluida');
    assert.equal(linhaConcluida.texto, 'texto transcrito');

    marcarFalhou(acervo, anexoId, 'ffmpeg saiu com codigo 1');
    const linhaFalhou = acervo
      .preparar('SELECT estado, motivo_falha FROM transcricoes WHERE anexo_id = ?')
      .get(anexoId) as { estado: string; motivo_falha: string };
    assert.equal(linhaFalhou.estado, 'falhou');
    assert.equal(linhaFalhou.motivo_falha, 'ffmpeg saiu com codigo 1');
  } finally {
    c.limpar();
  }
});

test('listarFalhas e reenfileirarFalhas, com Operacao gravada na trilha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const mensagemId = mensagemDeTeste(acervo);
    const anexoId = registrarAnexo(acervo, {
      mensagemId,
      tipo: 'audio',
      presenca: 'presente',
      caminho: '/x/a1.opus',
    });
    marcarPendente(acervo, anexoId);
    marcarFalhou(acervo, anexoId, 'motivo x');

    assert.deepEqual(listarFalhas(acervo), [{ anexoId, motivoFalha: 'motivo x' }]);

    const n = reenfileirarFalhas(acervo);
    assert.equal(n, 1);
    assert.deepEqual(listarFalhas(acervo), []);
    const linha = acervo.preparar('SELECT estado FROM transcricoes WHERE anexo_id = ?').get(anexoId) as {
      estado: string;
    };
    assert.equal(linha.estado, 'pendente');

    // reenfileirarFalhas e comando de decisao — grava Operacao, como
    // configurarDestinoDeMidia ja faz.
    const operacoes = acervo.db
      .prepare(`SELECT natureza FROM operacoes WHERE natureza = 'reprocessar-transcricao'`)
      .all() as { natureza: string }[];
    assert.equal(operacoes.length, 1);
    const efeitos = acervo.db
      .prepare(`SELECT tabela, chave, antes, depois FROM linhas_de_efeito WHERE tabela = 'transcricoes'`)
      .all();
    assert.deepEqual(efeitos, [{ tabela: 'transcricoes', chave: anexoId, antes: 'falhou', depois: 'pendente' }]);

    assert.equal(reenfileirarFalhas(acervo), 0); // nada a reenfileirar na segunda chamada
  } finally {
    c.limpar();
  }
});

test('incluirEstoqueEmTranscricao promove só o elegível, respeita o limite, e é idempotente', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');

    // mensagemDeTeste(acervo) é chamado de novo para cada Anexo abaixo —
    // idempotente de propósito (idExterno fixo em 'm1'/'111@s.whatsapp.net'):
    // as cinco chamadas devolvem a MESMA Mensagem, e só os Anexos distintos
    // importam para este teste.
    // Três fora-de-escopo elegíveis (presente, com caminho).
    const elegivel1 = registrarAnexo(acervo, {
      mensagemId: mensagemDeTeste(acervo), tipo: 'audio', presenca: 'presente', caminho: '/x/a1.opus',
    });
    acervo.preparar(`INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'fora-de-escopo')`).run(elegivel1);
    const elegivel2 = registrarAnexo(acervo, {
      mensagemId: mensagemDeTeste(acervo), tipo: 'audio', presenca: 'presente', caminho: '/x/a2.opus',
    });
    acervo.preparar(`INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'fora-de-escopo')`).run(elegivel2);
    const elegivel3 = registrarAnexo(acervo, {
      mensagemId: mensagemDeTeste(acervo), tipo: 'audio', presenca: 'presente', caminho: '/x/a3.opus',
    });
    acervo.preparar(`INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'fora-de-escopo')`).run(elegivel3);

    // Fora-de-escopo SEM arquivo presente — não pode ser promovido (critério 6 da spec).
    // `caminho` é omitido de propósito: EntradaAnexo.caminho é opcional
    // (string | undefined), nunca aceita null — 'nunca-obtido' é o caso
    // natural de "sem arquivo" (mesmo padrão de tests/escrita.test.ts).
    const semArquivo = registrarAnexo(acervo, {
      mensagemId: mensagemDeTeste(acervo), tipo: 'audio', presenca: 'nunca-obtido',
    });
    acervo.preparar(`INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'fora-de-escopo')`).run(semArquivo);

    // Já pendente — não é fora-de-escopo, não entra na contagem.
    const jaPendente = registrarAnexo(acervo, {
      mensagemId: mensagemDeTeste(acervo), tipo: 'audio', presenca: 'presente', caminho: '/x/a5.opus',
    });
    acervo.preparar(`INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'pendente')`).run(jaPendente);

    const estado = (id: string) =>
      (acervo.preparar('SELECT estado FROM transcricoes WHERE anexo_id = ?').get(id) as { estado: string })
        .estado;

    // Limite 2: promove só 2 dos 3 elegíveis, na ordem de id.
    const primeiraChamada = incluirEstoqueEmTranscricao(acervo, 2);
    assert.equal(primeiraChamada.promovidos, 2);
    assert.equal(estado(semArquivo), 'fora-de-escopo', 'sem arquivo presente, nunca promovido');
    assert.equal(estado(jaPendente), 'pendente', 'não mexe em quem já não é fora-de-escopo');

    // Segunda chamada: promove o terceiro elegível que sobrou.
    const segundaChamada = incluirEstoqueEmTranscricao(acervo, 10);
    assert.equal(segundaChamada.promovidos, 1);
    assert.equal(estado(elegivel1), 'pendente');
    assert.equal(estado(elegivel2), 'pendente');
    assert.equal(estado(elegivel3), 'pendente');

    // Terceira chamada: nada mais a promover — idempotente.
    const terceiraChamada = incluirEstoqueEmTranscricao(acervo, 10);
    assert.equal(terceiraChamada.promovidos, 0);
    assert.equal(estado(semArquivo), 'fora-de-escopo', 'continua intocado');

    // Duas Operações gravadas (uma por chamada com efeito) — não uma por Anexo.
    const operacoes = acervo.db
      .prepare(`SELECT natureza FROM operacoes WHERE natureza = 'incluir-estoque-em-transcricao'`)
      .all() as { natureza: string }[];
    assert.equal(operacoes.length, 2, 'a terceira chamada, sem efeito, não abre Operação nova');
  } finally {
    c.limpar();
  }
});

test('contarTranscricoesPorEstado agrupa por estado — o sinal proprio do criterio 4', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const mensagemId = mensagemDeTeste(acervo);
    const a1 = registrarAnexo(acervo, { mensagemId, tipo: 'audio', presenca: 'presente', caminho: '/x/a1.opus' });
    const a2 = registrarAnexo(acervo, { mensagemId, tipo: 'audio', presenca: 'presente', caminho: '/x/a2.opus' });
    marcarPendente(acervo, a1);
    marcarPendente(acervo, a2);
    marcarConcluida(acervo, a2, 'texto', 'whisper.cpp', 'small');

    assert.deepEqual(contarTranscricoesPorEstado(acervo), [
      { estado: 'concluida', n: 1 },
      { estado: 'pendente', n: 1 },
    ]);
  } finally {
    c.limpar();
  }
});
