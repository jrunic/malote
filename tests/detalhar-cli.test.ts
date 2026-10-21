import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { executar, executarConsultaRede, COMANDOS_DE_REDE } from '../src/cli/index.js';
import { formatarDetalhe } from '../src/cli/detalhar-texto.js';
import { detalharConversa } from '../src/nucleo/detalhe-da-conversa.js';
import { registrarMetadadosDeColetiva } from '../src/nucleo/escrita.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { acervoDeIdentidade, semearIdentidade, subirCenaDeIdentidade, PRECEDENCIA } from './ajuda/identidade.js';
import { subirServidorContador } from './ajuda/servidor-de-envio.js';

// #1203: `malote detalhar --conversa <id>` nos dois modos. O verbo e solto (ao lado de `conversas`) para entrar na
// lista de comandos de rede sem mexer em `conversa presenca`, que e local.

const INDEX = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts');
const METADADOS = { descricao: 'Avisos da familia\nSem spam', alteradoPor: 'AUTOR@lid', alteradoEm: '2026-06-01T12:30:00.000Z' };

test('o texto da coletiva mostra assunto, descricao em varias linhas, autor e instante; o da direta, o nome', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    registrarMetadadosDeColetiva(acervo, s.grupo, METADADOS);
    const grupo = formatarDetalhe(detalharConversa(acervo, s.grupo, PRECEDENCIA)!).join('\n');
    assert.match(grupo, /coletiva/);
    assert.match(grupo, /assunto: Grupo da Familia/);
    assert.match(grupo, /descricao:\n {4}Avisos da familia\n {4}Sem spam/);
    assert.match(grupo, /alterado por AUTOR@lid em 2026-06-01T12:30:00.000Z/);
    assert.match(grupo, /mensagens: 5/);
    assert.match(grupo, /endereco: grupo-1@g\.us/);
    const direta = formatarDetalhe(detalharConversa(acervo, s.diretaDeBruno, PRECEDENCIA)!).join('\n');
    assert.match(direta, /direta/);
    assert.match(direta, /nome: Bruno Contato \(contatos\)/);
    assert.doesNotMatch(direta, /assunto|descricao|endereco/);
  } finally {
    limpar();
  }
});

test('o texto da coletiva sem descricao diz que nao ha, em vez de calar', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const grupo = formatarDetalhe(detalharConversa(acervo, s.grupo, PRECEDENCIA)!).join('\n');
    assert.match(grupo, /descricao: \(sem descricao\)/);
  } finally {
    limpar();
  }
});

function instalacaoComIdentidade(): { raiz: string; inquilino: string; grupo: string; direta: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Titular' });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  const s = semearIdentidade(acervo);
  registrarMetadadosDeColetiva(acervo, s.grupo, METADADOS);
  acervo.fechar();
  return { raiz, inquilino, grupo: s.grupo, direta: s.diretaDeBruno, limpar };
}

test('detalhar LOCAL: texto e --json, e as recusas de uso', () => {
  const { raiz, inquilino, grupo, direta, limpar } = instalacaoComIdentidade();
  try {
    const ambiente = (saida: string[]) => ({ dados: raiz, estado: raiz, escrever: (t: string) => saida.push(t) });
    const texto: string[] = [];
    assert.equal(executar(['detalhar', '--inquilino', inquilino, '--conversa', grupo], ambiente(texto)), 0);
    assert.match(texto.join('\n'), /assunto: Grupo da Familia/);
    const json: string[] = [];
    assert.equal(executar(['detalhar', '--inquilino', inquilino, '--conversa', grupo, '--json'], ambiente(json)), 0);
    const g = JSON.parse(json.join('\n'));
    assert.equal(g.metadados.descricao, 'Avisos da familia\nSem spam');
    const d: string[] = [];
    assert.equal(executar(['detalhar', '--inquilino', inquilino, '--conversa', direta, '--json'], ambiente(d)), 0);
    assert.equal(JSON.parse(d.join('\n')).nome, 'Bruno Contato');
    const desconhecida: string[] = [];
    assert.equal(executar(['detalhar', '--inquilino', inquilino, '--conversa', 'nao-existe'], ambiente(desconhecida)), 2);
    assert.match(desconhecida.join('\n'), /Conversa desconhecida: nao-existe/);
    const semConversa: string[] = [];
    assert.equal(executar(['detalhar', '--inquilino', inquilino], ambiente(semConversa)), 2);
    assert.match(semConversa.join('\n'), /Informe --conversa/);
  } finally {
    limpar();
  }
});

test('detalhar esta na lista de comandos de rede, e conversa presenca continua fora dela', () => {
  assert.equal(COMANDOS_DE_REDE.has('detalhar'), true);
  assert.equal(COMANDOS_DE_REDE.has('conversa'), false);
});

test('detalhar por REDE: texto, --json, 404 com a mesma resposta e a recusa de --inquilino, sem rede', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo, s) => {
      registrarMetadadosDeColetiva(acervo, s.grupo, METADADOS);
    },
  });
  const contador = await subirServidorContador();
  try {
    const linhas: string[] = [];
    const rede = { servidor: cena.url, chave: cena.chave.valor, escrever: (t: string) => linhas.push(t) };
    assert.equal(await executarConsultaRede(['detalhar', '--conversa', cena.s.grupo], rede), 0);
    assert.match(linhas.join('\n'), /descricao:\n {4}Avisos da familia/);
    const json: string[] = [];
    assert.equal(await executarConsultaRede(['detalhar', '--conversa', cena.s.grupo, '--json'], { ...rede, escrever: (t) => json.push(t) }), 0);
    assert.equal(JSON.parse(json.join('\n')).metadados.assunto, 'Grupo da Familia');

    const nao: string[] = [];
    assert.equal(await executarConsultaRede(['detalhar', '--conversa', 'nao-existe'], { ...rede, escrever: (t) => nao.push(t) }), 6);
    assert.match(nao.join('\n'), /Conversa nao encontrada: nao-existe/);

    const recusa: string[] = [];
    const comContador = { servidor: contador.url, chave: 'k', escrever: (t: string) => recusa.push(t) };
    assert.equal(await executarConsultaRede(['detalhar', '--conversa', 'x', '--inquilino', 'y'], comContador), 2);
    assert.match(recusa.join('\n'), /env -u MALOTE_SERVIDOR/);
    assert.equal(await executarConsultaRede(['detalhar'], comContador), 2);
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

test('o executavel detalha por rede', async () => {
  const cena = await subirCenaDeIdentidade();
  try {
    const env = { MALOTE_HOME: cena.raiz, MALOTE_SERVIDOR: cena.url, MALOTE_CHAVE_DE_ACESSO: cena.chave.valor };
    const r = await rodar(env, ['detalhar', '--conversa', cena.s.diretaDeBruno, '--json']);
    assert.equal(r.codigo, 0, r.stdout);
    assert.equal(JSON.parse(r.stdout).nome, 'Bruno Contato');
  } finally {
    cena.encerrar();
  }
});

test('a ajuda lista detalhar nos dois modos', () => {
  const linhas: string[] = [];
  assert.equal(executar(['--ajuda'], { dados: '/nao/usado', estado: '/nao/usado', escrever: (t: string) => linhas.push(t) }), 0);
  const saida = linhas.join('\n');
  assert.match(saida, /malote detalhar\s+--inquilino <id> --conversa <id>/);
  assert.match(saida, /malote detalhar\s+--conversa <id> \[--json\]/);
});
