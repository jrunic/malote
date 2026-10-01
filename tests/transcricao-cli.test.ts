import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem, registrarAnexo } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

function instalacaoComAnexoDeAudio(estado: 'pendente' | 'concluida' | 'falhou' | 'fora-de-escopo'): {
  raiz: string;
  id: string;
  limpar: () => void;
} {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Cassian' });
  registro.fechar();

  const acervo = abrirAcervo(`${raiz}/acervos`, id);
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp', idExterno: '111@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
  });
  const mensagemId = registrarMensagem(acervo, {
    direcao: 'recebida', conversaId, fonte: 'whatsapp', idExterno: 'm1',
    ocorridaEm: Date.parse('2026-09-01T12:00:00Z'), agora: Date.now(),
  });
  const anexoId = registrarAnexo(acervo, {
    mensagemId, tipo: 'audio', presenca: 'presente', caminho: '/x/a1.opus',
  });
  if (estado === 'pendente') {
    acervo.preparar(`INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'pendente')`).run(anexoId);
  } else if (estado === 'concluida') {
    acervo
      .preparar(`INSERT INTO transcricoes (anexo_id, estado, texto) VALUES (?, 'concluida', 'ola')`)
      .run(anexoId);
  } else if (estado === 'fora-de-escopo') {
    acervo.preparar(`INSERT INTO transcricoes (anexo_id, estado) VALUES (?, 'fora-de-escopo')`).run(anexoId);
  } else {
    acervo
      .preparar(`INSERT INTO transcricoes (anexo_id, estado, motivo_falha) VALUES (?, 'falhou', 'erro x')`)
      .run(anexoId);
  }
  acervo.fechar();

  return { raiz, id, limpar };
}

test('malote transcricao reprocessar volta falhas para pendente e conta quantas', () => {
  const { raiz, id, limpar } = instalacaoComAnexoDeAudio('falhou');
  try {
    const linhas: string[] = [];
    const codigo = executar(
      ['transcricao', 'reprocessar', '--inquilino', id, '--json'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) },
    );
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.deepEqual(JSON.parse(linhas.join('\n')), { reenfileiradas: 1 });

    const acervo = abrirAcervo(`${raiz}/acervos`, id);
    const linha = acervo.preparar('SELECT estado FROM transcricoes').get() as { estado: string };
    assert.equal(linha.estado, 'pendente');
    acervo.fechar();
  } finally {
    limpar();
  }
});

test('malote transcricao reprocessar sem --inquilino recusa com uso', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const codigo = executar(
      ['transcricao', 'reprocessar'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) },
    );
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /Uso: malote transcricao reprocessar/);
  } finally {
    limpar();
  }
});

test('malote transcricao incluir-estoque respeita --limite e relata em --json', () => {
  const { raiz, id, limpar } = instalacaoComAnexoDeAudio('fora-de-escopo');
  try {
    const linhas: string[] = [];
    const codigo = executar(
      ['transcricao', 'incluir-estoque', '--inquilino', id, '--limite', '10', '--json'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) },
    );
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.deepEqual(JSON.parse(linhas.join('\n')), { promovidos: 1 });
  } finally {
    limpar();
  }
});

test('malote transcricao incluir-estoque exige --inquilino e --limite', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const codigo = executar(
      ['transcricao', 'incluir-estoque', '--inquilino', 'x'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) },
    );
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /--limite/);
  } finally {
    limpar();
  }
});

test('malote transcricao estado mostra a contagem por estado e se o motor esta configurado', () => {
  const { raiz, id, limpar } = instalacaoComAnexoDeAudio('concluida');
  try {
    const linhas: string[] = [];
    const codigo = executar(
      ['transcricao', 'estado', '--inquilino', id, '--json'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) },
    );
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.deepEqual(JSON.parse(linhas.join('\n')), {
      motorConfigurado: false,
      porEstado: { concluida: 1 },
    });
  } finally {
    limpar();
  }
});

test('malote transcricao estado sem --inquilino recusa com uso', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const codigo = executar(
      ['transcricao', 'estado'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) },
    );
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /Uso: malote transcricao estado/);
  } finally {
    limpar();
  }
});
