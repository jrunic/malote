import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar } from '../src/cli/index.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao, listarConfiguracoes } from '../src/registro/configuracao-adaptador.js';

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

test('malote enviar e operacao LOCAL — recusa com --servidor setado', async () => {
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
