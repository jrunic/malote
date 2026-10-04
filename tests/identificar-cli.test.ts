import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { executar, executarConsultaRede } from '../src/cli/index.js';
import { primeiroPosicional } from '../src/cli/posicional.js';
import { formatarIdentificacao } from '../src/cli/identificar-texto.js';
import { identificarPorValor } from '../src/nucleo/identificar.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import {
  semearIdentidade,
  subirCenaDeIdentidade,
  acervoDeIdentidade,
  PRECEDENCIA,
  BRUNO,
  BRUNO_LID,
  ANA,
} from './ajuda/identidade.js';
import { subirServidorContador } from './ajuda/servidor-de-envio.js';

const INDEX = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts');

test('primeiroPosicional pula --json e qualquer --opcao com o seu valor (#1126)', () => {
  assert.equal(primeiroPosicional(['identificar', 'abc', '--json'], 1), 'abc');
  assert.equal(primeiroPosicional(['identificar', '--fonte', 'whatsapp', 'abc'], 1), 'abc');
  assert.equal(primeiroPosicional(['identificar', '--json', '--fonte', 'whatsapp', 'abc', '--inquilino', 'x'], 1), 'abc');
  assert.equal(primeiroPosicional(['identificar', '--fonte', 'whatsapp'], 1), undefined);
  assert.equal(primeiroPosicional(['identificar'], 1), undefined);
});

test('o texto resume Identificador por Identificador, com nomes, origem e presenca (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const linhas = formatarIdentificacao(identificarPorValor(acervo, { valor: BRUNO_LID }, PRECEDENCIA)).join('\n');
    assert.match(linhas, /whatsapp\s+5565222222222@s\.whatsapp\.net/);
    assert.match(linhas, /sem Pessoa/);
    assert.match(linhas, /Bruno Contato \(contatos\)/);
    assert.match(linhas, /Bruno Silva/);
    assert.match(linhas, /conversas: 2/);
    assert.match(linhas, /mensagens: 4/);
    assert.match(linhas, /222222@lid\s+consultado\s+\(sem Identificador gravado\)/);
  } finally {
    limpar();
  }
});

test('o texto de valor que o Acervo nunca viu diz que e exato e como escrever (#1126)', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const linhas = formatarIdentificacao(identificarPorValor(acervo, { valor: '000@lid' }, PRECEDENCIA)).join('\n');
    assert.match(linhas, /nunca viu/);
    assert.match(linhas, /exato/);
  } finally {
    limpar();
  }
});

function instalacaoComIdentidade(): { raiz: string; inquilino: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  semearIdentidade(acervo);
  acervo.fechar();
  return { raiz, inquilino, limpar };
}

test('identificar LOCAL: texto e --json, com o mesmo conteudo (#1126)', () => {
  const { raiz, inquilino, limpar } = instalacaoComIdentidade();
  try {
    const ambiente = (saida: string[]) => ({ dados: raiz, estado: raiz, escrever: (t: string) => saida.push(t) });
    const texto: string[] = [];
    assert.equal(executar(['identificar', BRUNO, '--inquilino', inquilino], ambiente(texto)), 0);
    assert.match(texto.join('\n'), /Bruno Contato \(contatos\)/);
    const json: string[] = [];
    assert.equal(executar(['identificar', BRUNO, '--inquilino', inquilino, '--json'], ambiente(json)), 0);
    assert.equal(JSON.parse(json.join('\n')).identificadores[0].nome, 'Bruno Contato');
    const desconhecido: string[] = [];
    assert.equal(executar(['identificar', '000@lid', '--inquilino', inquilino, '--json'], ambiente(desconhecido)), 0);
    assert.deepEqual(
      JSON.parse(desconhecido.join('\n')).identificadores,
      [],
      'valor desconhecido: lista vazia tambem no modo local',
    );
    const semValor: string[] = [];
    assert.equal(executar(['identificar', '--inquilino', inquilino], ambiente(semValor)), 2);
    const fonteRuim: string[] = [];
    assert.equal(executar(['identificar', BRUNO, '--inquilino', inquilino, '--fonte', 'nao-existe'], ambiente(fonteRuim)), 2);
  } finally {
    limpar();
  }
});

test('conversas LOCAL traz o nome da Conversa direta e a busca o acha (#1126)', () => {
  const { raiz, inquilino, limpar } = instalacaoComIdentidade();
  try {
    const ambiente = (saida: string[]) => ({ dados: raiz, estado: raiz, escrever: (t: string) => saida.push(t) });
    const todas: string[] = [];
    assert.equal(executar(['conversas', '--inquilino', inquilino, '--json'], ambiente(todas)), 0);
    const lista = JSON.parse(todas.join('\n')) as Array<{ nome: string | null; origemDoNome: string | null; coletiva: boolean }>;
    assert.equal(lista.length, 4, 'a fixture produz as quatro Conversas');
    const comNome = lista.filter((c) => c.nome !== null).map((c) => [c.nome, c.origemDoNome]).sort();
    assert.deepEqual(comNome, [
      ['Ana WhatsApp', 'whatsapp'],
      ['Bruno Contato', 'contatos'],
    ]);
    const achadas: string[] = [];
    assert.equal(executar(['conversas', '--inquilino', inquilino, '--busca', 'silva', '--json'], ambiente(achadas)), 0);
    assert.equal((JSON.parse(achadas.join('\n')) as unknown[]).length, 1);
    const texto: string[] = [];
    assert.equal(executar(['conversas', '--inquilino', inquilino, '--busca', 'silva'], ambiente(texto)), 0);
    assert.match(texto.join('\n'), /Bruno Contato/, 'a saida em texto mostra o nome da Conversa direta');
  } finally {
    limpar();
  }
});

test('identificar por REDE: texto, --json, fonte e a recusa de --inquilino, sem rede (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  const contador = await subirServidorContador();
  try {
    const linhas: string[] = [];
    const rede = { servidor: cena.url, chave: cena.chave.valor, escrever: (t: string) => linhas.push(t) };
    assert.equal(await executarConsultaRede(['identificar', BRUNO_LID], rede), 0);
    assert.match(linhas.join('\n'), /Bruno Contato \(contatos\)/);
    const json: string[] = [];
    assert.equal(await executarConsultaRede(['identificar', BRUNO, '--json'], { ...rede, escrever: (t) => json.push(t) }), 0);
    assert.equal(JSON.parse(json.join('\n')).identificadores[0].valor, BRUNO);
    const vazio: string[] = [];
    assert.equal(
      await executarConsultaRede(['identificar', '000@lid', '--json'], { ...rede, escrever: (t) => vazio.push(t) }),
      0,
    );
    assert.deepEqual(JSON.parse(vazio.join('\n')).identificadores, []);
    const porFonte: string[] = [];
    assert.equal(
      await executarConsultaRede(['identificar', BRUNO, '--fonte', 'instagram', '--json'], { ...rede, escrever: (t) => porFonte.push(t) }),
      0,
    );
    assert.deepEqual(JSON.parse(porFonte.join('\n')).identificadores, [], 'a Fonte sem o valor devolve vazio');

    const recusa: string[] = [];
    const comContador = { servidor: contador.url, chave: 'k', escrever: (t: string) => recusa.push(t) };
    assert.equal(await executarConsultaRede(['identificar', ANA, '--inquilino', 'x'], comContador), 2);
    assert.match(recusa.join('\n'), /env -u MALOTE_SERVIDOR/);
    assert.equal(await executarConsultaRede(['identificar'], comContador), 2);
    assert.equal(contador.requisicoes(), 0, 'as recusas locais nao tocam a rede');
  } finally {
    contador.fechar();
    cena.encerrar();
  }
});

function rodar(env: Record<string, string>, argumentos: string[]): Promise<{ codigo: number; stdout: string }> {
  return new Promise((resolver) => {
    const base = { ...process.env };
    delete base['MALOTE_SERVIDOR'];
    delete base['MALOTE_CHAVE_DE_ACESSO'];
    const filho = spawn(process.execPath, ['--import', 'tsx', INDEX, ...argumentos], { env: { ...base, ...env } });
    let stdout = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.on('close', (codigo) => resolver({ codigo: codigo ?? -1, stdout }));
  });
}

test('o executavel identifica por rede, com o valor antes ou depois das opcoes (#1126)', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const env = { MALOTE_HOME: cena.raiz, MALOTE_SERVIDOR: cena.url, MALOTE_CHAVE_DE_ACESSO: cena.chave.valor };
    const a = await rodar(env, ['identificar', BRUNO_LID]);
    assert.equal(a.codigo, 0, a.stdout);
    assert.match(a.stdout, /Bruno Contato \(contatos\)/);
    const b = await rodar(env, ['identificar', '--fonte', 'whatsapp', BRUNO, '--json']);
    assert.equal(b.codigo, 0, b.stdout);
    assert.equal(JSON.parse(b.stdout).identificadores[0].valor, BRUNO);
  } finally {
    cena.encerrar();
  }
});
