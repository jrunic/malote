import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar } from '../src/cli/index.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao, listarConfiguracoes } from '../src/registro/configuracao-adaptador.js';
import { registrarEnvio } from '../src/nucleo/envio.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { join } from 'node:path';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

function comInquilinoEConfiguracao(raiz: string, apelido: string): { inquilinoId: string } {
  const registro = abrirRegistro(raiz);
  try {
    const inquilinoId = criarInquilino(registro, { titularNome: 'Leia' });
    resolverConfiguracao(registro, inquilinoId, 'whatsapp', apelido);
    return { inquilinoId };
  } finally {
    registro.fechar();
  }
}

test('malote enviar --texto grava um Envio pendente', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const linhas: string[] = [];
    const ambiente = { dados: raiz, estado: raiz, escrever: (l: string) => linhas.push(l) };

    const codigo = await executar(
      [
        'enviar',
        '--inquilino',
        inquilinoId,
        '--configuracao',
        'padrao',
        '--para',
        '5511999990000@s.whatsapp.net',
        '--texto',
        'oi da espiga',
      ],
      ambiente,
    );

    assert.equal(codigo, 0);
    assert.ok(linhas.some((l) => l.includes('Envio registrado')));
  } finally {
    limpar();
  }
});

test('malote enviar recusa Configuracao inexistente, sem criar uma nova', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    const inquilinoId = criarInquilino(registro, { titularNome: 'Leia' });
    registro.fechar();

    const linhas: string[] = [];
    const codigo = await executar(
      [
        'enviar',
        '--inquilino',
        inquilinoId,
        '--configuracao',
        'nao-existe',
        '--para',
        '5511999990000@s.whatsapp.net',
        '--texto',
        'oi',
      ],
      { dados: raiz, estado: raiz, escrever: (l: string) => linhas.push(l) },
    );

    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /nao existe/i);

    const r2 = abrirRegistro(raiz);
    assert.deepEqual(listarConfiguracoes(r2, inquilinoId), []);
    r2.fechar();
  } finally {
    limpar();
  }
});

test('malote enviar recusa --para sem forma reconhecida de endereco', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const linhas: string[] = [];
    const codigo = await executar(
      [
        'enviar',
        '--inquilino',
        inquilinoId,
        '--configuracao',
        'padrao',
        '--para',
        '5511999990000', // sem @
        '--texto',
        'oi',
      ],
      { dados: raiz, estado: raiz, escrever: (l: string) => linhas.push(l) },
    );
    assert.equal(codigo, 2);
  } finally {
    limpar();
  }
});

test('o executor local recusa uma invocacao de enviar que chegue a ele com servidor declarado', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const linhas: string[] = [];
    const codigo = await executar(
      [
        'enviar',
        '--inquilino',
        inquilinoId,
        '--configuracao',
        'padrao',
        '--para',
        '5511999990000@s.whatsapp.net',
        '--texto',
        'oi',
        '--servidor',
        'http://localhost:9',
      ],
      { dados: raiz, estado: raiz, escrever: (l: string) => linhas.push(l) },
    );
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /operacao LOCAL/);
  } finally {
    limpar();
  }
});

test('malote envio reprocessar volta falhas para pendente', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilinoId);
    const r = registrarEnvio(acervo, {
      configuracaoId: 'cfg-qualquer',
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    acervo
      .preparar(`UPDATE envios SET estado = 'falhou', motivo_falha = 'x' WHERE id = ?`)
      .run(r.envioId);
    acervo.fechar();

    const linhas: string[] = [];
    const codigo = await executar(
      ['envio', 'reprocessar', '--inquilino', inquilinoId],
      { dados: raiz, estado: raiz, escrever: (l: string) => linhas.push(l) },
    );
    assert.equal(codigo, 0);
    assert.match(linhas.join('\n'), /1/);
  } finally {
    limpar();
  }
});

test('malote envio estado mostra a contagem por estado', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilinoId);
    registrarEnvio(acervo, {
      configuracaoId: 'cfg-qualquer',
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    acervo.fechar();

    const linhas: string[] = [];
    const codigo = await executar(
      ['envio', 'estado', '--inquilino', inquilinoId, '--json'],
      { dados: raiz, estado: raiz, escrever: (l: string) => linhas.push(l) },
    );
    assert.equal(codigo, 0);
    const saida = JSON.parse(linhas.at(-1) ?? '{}');
    assert.deepEqual(saida, { enviado: 0, falhou: 0, pendente: 1 });
  } finally {
    limpar();
  }
});

const ARGS_BASE = (inquilinoId: string): string[] => [
  'enviar',
  '--inquilino',
  inquilinoId,
  '--configuracao',
  'padrao',
  '--para',
  '5511999990000@s.whatsapp.net',
];

test('malote enviar --imagem copia o arquivo para staging e grava o Envio', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const pastaOrigem = mkdtempSync(join(tmpdir(), 'malote-origem-'));
    const caminhoOrigem = join(pastaOrigem, 'foto.jpg');
    writeFileSync(caminhoOrigem, Buffer.from('bytes-da-foto'));

    const codigo = await executar([...ARGS_BASE(inquilinoId), '--imagem', caminhoOrigem], {
      dados: raiz,
      estado: raiz,
      escrever: () => undefined,
    });

    assert.equal(codigo, 0);
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilinoId);
    const linha = acervo
      .preparar('SELECT conteudo_tipo, conteudo_caminho_arquivo, conteudo_mimetype FROM envios')
      .get() as { conteudo_tipo: string; conteudo_caminho_arquivo: string; conteudo_mimetype: string };
    acervo.fechar();
    assert.equal(linha.conteudo_tipo, 'imagem');
    assert.notEqual(linha.conteudo_caminho_arquivo, caminhoOrigem, 'deveria ser copia, nao o original');
    assert.ok(existsSync(linha.conteudo_caminho_arquivo));
    assert.ok(existsSync(caminhoOrigem), 'o original nao deveria ser movido nem apagado');
    assert.equal(linha.conteudo_mimetype, 'image/jpeg');
  } finally {
    limpar();
  }
});

test('malote enviar --documento deriva o nome de arquivo do caminho e a legenda de --texto', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const pastaOrigem = mkdtempSync(join(tmpdir(), 'malote-origem-'));
    const caminhoOrigem = join(pastaOrigem, 'relatorio-final.pdf');
    writeFileSync(caminhoOrigem, Buffer.from('bytes-do-pdf'));

    const codigo = await executar(
      [...ARGS_BASE(inquilinoId), '--documento', caminhoOrigem, '--texto', 'segue o relatorio'],
      { dados: raiz, estado: raiz, escrever: () => undefined },
    );

    assert.equal(codigo, 0);
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilinoId);
    const linha = acervo
      .preparar('SELECT conteudo_nome_arquivo, conteudo_mimetype, conteudo_texto FROM envios')
      .get() as { conteudo_nome_arquivo: string; conteudo_mimetype: string; conteudo_texto: string };
    acervo.fechar();
    assert.equal(linha.conteudo_nome_arquivo, 'relatorio-final.pdf');
    assert.equal(linha.conteudo_mimetype, 'application/pdf');
    assert.equal(linha.conteudo_texto, 'segue o relatorio');
  } finally {
    limpar();
  }
});

test('malote enviar recusa --imagem e --documento juntos', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const pastaOrigem = mkdtempSync(join(tmpdir(), 'malote-origem-'));
    const a = join(pastaOrigem, 'a.jpg');
    const b = join(pastaOrigem, 'b.pdf');
    writeFileSync(a, 'x');
    writeFileSync(b, 'y');
    const codigo = await executar([...ARGS_BASE(inquilinoId), '--imagem', a, '--documento', b], {
      dados: raiz,
      estado: raiz,
      escrever: () => undefined,
    });
    assert.equal(codigo, 2);
    assert.equal(existsSync(join(raiz, 'envios-pendentes')), false, 'recusa nao deveria copiar nada');
  } finally {
    limpar();
  }
});

test('malote enviar --imagem com arquivo inexistente recusa antes de copiar', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const codigo = await executar(
      [...ARGS_BASE(inquilinoId), '--imagem', '/caminho/que/nao/existe.jpg'],
      { dados: raiz, estado: raiz, escrever: () => undefined },
    );
    assert.equal(codigo, 2);
    assert.equal(existsSync(join(raiz, 'envios-pendentes')), false);
  } finally {
    limpar();
  }
});

// Criterio 12: o relato do reprocessamento diz quantos Envios pendentes ha —
// os orfaos de um vinculo invalidado entram nessa conta.
test('malote envio reprocessar diz quantos Envios continuam pendentes', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const acervo = abrirAcervo(join(raiz, 'acervos'), inquilinoId);
    for (const n of [1, 2]) {
      registrarEnvio(acervo, {
        configuracaoId: 'cfg-qualquer',
        destino: { enderecoCru: `55119999900${n}0@s.whatsapp.net` },
        conteudo: { tipo: 'texto', texto: 'oi' },
      });
    }
    acervo.fechar();

    const linhas: string[] = [];
    const codigo = await executar(['envio', 'reprocessar', '--inquilino', inquilinoId], {
      dados: raiz,
      estado: raiz,
      escrever: (l: string) => linhas.push(l),
    });
    assert.equal(codigo, 0);
    assert.match(linhas.join('\n'), /2 Envio\(s\) pendente\(s\)/);

    const json: string[] = [];
    await executar(['envio', 'reprocessar', '--inquilino', inquilinoId, '--json'], {
      dados: raiz,
      estado: raiz,
      escrever: (l: string) => json.push(l),
    });
    assert.deepEqual(JSON.parse(json[0]!), { reenfileirados: 0, pendentes: 2 });
  } finally {
    limpar();
  }
});

test('malote envio estado local lista os tres estados em texto, mesmo com o Acervo vazio (#1117)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilinoId } = comInquilinoEConfiguracao(raiz, 'padrao');
    const linhas: string[] = [];
    const codigo = await executar(['envio', 'estado', '--inquilino', inquilinoId], {
      dados: raiz,
      estado: raiz,
      escrever: (l: string) => linhas.push(l),
    });
    assert.equal(codigo, 0);
    const saida = linhas.join('\n');
    assert.match(saida, /enviado: 0/);
    assert.match(saida, /falhou: 0/);
    assert.match(saida, /pendente: 0/);
  } finally {
    limpar();
  }
});
