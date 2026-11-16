// tests/decifra-registro.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FalhaCapturada } from '../src/adaptadores/whatsapp/falha-de-decifra.js';
import {
  caminhoDoRegistroAnterior,
  criarRegistroDaDecifra,
  FOLGA_DA_RECONFERENCIA_MS,
  PRAZO_DE_PERDA_MS,
  type OpcoesDoRegistro,
} from '../src/cli/decifra.js';

const GRUPO = '120363000000000001@g.us';
const falha = (id: string, extra: Partial<FalhaCapturada> = {}): FalhaCapturada => ({
  id,
  conversa: GRUPO,
  direcao: 'recebida',
  tipo: 'grupo',
  causa: 'sem-sessao',
  ...extra,
});

function comPasta<T>(f: (pasta: string) => T): T {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-decifra-'));
  try {
    return f(pasta);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** Relogio e Acervo controlados: `no` diz que identificadores ja estao gravados. */
function montar(pasta: string, extra: Partial<OpcoesDoRegistro> = {}) {
  const estado = { agora: Date.parse('2026-11-20T12:00:00Z'), no: new Set<string>(), avisos: [] as string[] };
  const registro = criarRegistroDaDecifra({
    caminho: join(pasta, 'decifra.jsonl'),
    caminhoDosContadores: join(pasta, 'decifra.json'),
    agora: () => estado.agora,
    existe: (id) => estado.no.has(id),
    avisar: (l) => estado.avisos.push(l),
    ...extra,
  });
  registro.abrir();
  return { estado, registro, caminho: join(pasta, 'decifra.jsonl') };
}
const linhas = (caminho: string): Array<Record<string, unknown>> =>
  readFileSync(caminho, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);

test('a linha da falha tem o formato fixo, modo 0600, e a mensagem ausente fica jaGravada falso', () =>
  comPasta((pasta) => {
    const { registro, caminho } = montar(pasta);
    registro.registrar(falha('I1', { autor: '100000000000001@lid' }));
    assert.equal(statSync(caminho).mode & 0o777, 0o600);
    assert.deepEqual(linhas(caminho), [
      {
        t: 'falha',
        em: '2026-11-20T12:00:00.000Z',
        id: 'I1',
        conversa: GRUPO,
        autor: '100000000000001@lid',
        direcao: 'recebida',
        tipo: 'grupo',
        causa: 'sem-sessao',
        jaGravada: false,
      },
    ]);
  }));

test('a mensagem ja gravada na hora da falha grava jaGravada verdadeiro e nao abre', () =>
  comPasta((pasta) => {
    const { estado, registro, caminho } = montar(pasta);
    estado.no.add('I1');
    registro.registrar(falha('I1'));
    assert.equal(linhas(caminho)[0]?.['jaGravada'], true);
    assert.equal(registro.abertas(), 0);
  }));

test('nada e criado antes da primeira falha: nem o arquivo do registro', () =>
  comPasta((pasta) => {
    const { caminho } = montar(pasta);
    assert.equal(existsSync(caminho), false);
    assert.equal(existsSync(join(pasta, 'decifra.json')), true, 'so o arquivo dos contadores, que abrir() cria');
  }));

test('a rotacao no teto leva o atual para o anterior', () =>
  comPasta((pasta) => {
    const { registro, caminho } = montar(pasta, { teto: 300 });
    registro.registrar(falha('I1'));
    registro.registrar(falha('I2'));
    registro.registrar(falha('I3'));
    assert.equal(existsSync(caminhoDoRegistroAnterior(caminho)), true);
    assert.deepEqual(linhas(caminho).map((l) => l['id']), ['I3']);
  }));

test('a falha de gravacao nunca lanca: conta, avisa UMA vez e o contador vai ao arquivo', () =>
  comPasta((pasta) => {
    writeFileSync(join(pasta, 'arquivo-comum'), 'x');
    // A pasta do registro fica "dentro" de um arquivo comum: criar o diretorio falha com ENOTDIR.
    const { estado, registro } = montar(pasta, { caminho: join(pasta, 'arquivo-comum', 'decifra.jsonl') });
    assert.doesNotThrow(() => registro.registrar(falha('I1')));
    assert.doesNotThrow(() => registro.registrar(falha('I2')));
    assert.equal(registro.falhasDeRegistro(), 2);
    assert.equal(estado.avisos.length, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(pasta, 'decifra.json'), 'utf8')), {
      desde: '2026-11-20T12:00:00.000Z',
      falhasDeRegistro: 2,
    });
  }));

test('os dois arquivos falham: o contador velho nao fica dizendo zero, o arquivo some', () =>
  comPasta((pasta) => {
    writeFileSync(join(pasta, 'arquivo-comum'), 'x');
    const { registro } = montar(pasta, { caminho: join(pasta, 'arquivo-comum', 'decifra.jsonl') });
    assert.equal(existsSync(join(pasta, 'decifra.json')), true);
    mkdirSync(join(pasta, 'decifra.json.tmp')); // a troca atomica dos contadores passa a falhar (EISDIR)
    registro.registrar(falha('I1'));
    assert.equal(registro.falhasDeRegistro(), 1, 'o contador na memoria sobe');
    assert.equal(existsSync(join(pasta, 'decifra.json')), false, 'sem o arquivo, o estado mostra o bloco indisponivel');
  }));

test('o aviso que lanca (saida estrangulada) nunca escapa do registro', () =>
  comPasta((pasta) => {
    writeFileSync(join(pasta, 'arquivo-comum'), 'x');
    const { registro } = montar(pasta, {
      caminho: join(pasta, 'arquivo-comum', 'decifra.jsonl'),
      avisar: () => {
        throw new Error('EPIPE');
      },
    });
    assert.doesNotThrow(() => registro.registrar(falha('I1')));
  }));

test('a consulta ao Acervo que lanca conta como nao gravada e nao derruba nada', () =>
  comPasta((pasta) => {
    const { registro, caminho } = montar(pasta, {
      existe: () => {
        throw new Error('banco fechado');
      },
    });
    assert.doesNotThrow(() => registro.registrar(falha('I1')));
    assert.equal(linhas(caminho)[0]?.['jaGravada'], false);
  }));

test('depois de encerrar, registrar e reconferir nao fazem nada', () =>
  comPasta((pasta) => {
    const { registro, caminho } = montar(pasta);
    registro.encerrar();
    registro.registrar(falha('I1'));
    registro.reconferir();
    assert.equal(existsSync(caminho), false);
  }));

// --- a reconferencia

test('recuperada: entrou depois da falha, e so uma situacao e gravada', () =>
  comPasta((pasta) => {
    const { estado, registro, caminho } = montar(pasta);
    registro.registrar(falha('I1'));
    estado.agora += 5_000;
    estado.no.add('I1');
    registro.reconferir();
    registro.reconferir();
    const situacoes = linhas(caminho).filter((l) => l['t'] === 'situacao');
    assert.equal(situacoes.length, 1);
    assert.equal(situacoes[0]?.['situacao'], 'recuperada');
    assert.equal(registro.abertas(), 0);
  }));

test('perdida so depois de 1 hora; a que entra 2 horas depois continua perdida', () =>
  comPasta((pasta) => {
    const { estado, registro, caminho } = montar(pasta);
    registro.registrar(falha('I1'));
    estado.agora += PRAZO_DE_PERDA_MS - 1_000;
    registro.reconferir();
    assert.equal(linhas(caminho).filter((l) => l['t'] === 'situacao').length, 0, 'aos 59 min 59 s: ainda aberta');
    estado.agora += 1_000;
    registro.reconferir();
    assert.equal(linhas(caminho).at(-1)?.['situacao'], 'perdida');
    estado.agora += 2 * PRAZO_DE_PERDA_MS;
    estado.no.add('I1');
    registro.reconferir();
    assert.equal(linhas(caminho).filter((l) => l['t'] === 'situacao').length, 1, 'a perdida nao reabre');
  }));

test('a reconferencia tardia (ouvinte parado) com a mensagem presente vale incerta, e ausente vale perdida', () =>
  comPasta((pasta) => {
    const { estado, registro, caminho } = montar(pasta);
    registro.registrar(falha('I1'));
    registro.registrar(falha('I2'));
    estado.agora += PRAZO_DE_PERDA_MS + FOLGA_DA_RECONFERENCIA_MS + 1_000;
    estado.no.add('I1');
    registro.reconferir();
    const por = Object.fromEntries(linhas(caminho).filter((l) => l['t'] === 'situacao').map((l) => [l['id'], l['situacao']]));
    assert.deepEqual(por, { I1: 'incerta', I2: 'perdida' });
  }));

test('a reconferencia no limite do prazo, com a mensagem presente, vale recuperada (a passada normal do ouvinte)', () =>
  comPasta((pasta) => {
    const { estado, registro, caminho } = montar(pasta);
    registro.registrar(falha('I1'));
    estado.agora += PRAZO_DE_PERDA_MS + 1_000;
    estado.no.add('I1');
    registro.reconferir();
    assert.equal(linhas(caminho).at(-1)?.['situacao'], 'recuperada');
  }));

test('o id ja resolvido nao reabre quando a falha se repete', () =>
  comPasta((pasta) => {
    const { estado, registro, caminho } = montar(pasta);
    registro.registrar(falha('I1'));
    estado.agora += PRAZO_DE_PERDA_MS;
    registro.reconferir(); // perdida
    registro.registrar(falha('I1')); // a falha se repete
    estado.no.add('I1');
    registro.reconferir();
    assert.equal(registro.abertas(), 0);
    assert.equal(linhas(caminho).filter((l) => l['t'] === 'situacao').length, 1);
  }));

test('duas falhas do mesmo id viram uma so aberta', () =>
  comPasta((pasta) => {
    const { registro } = montar(pasta);
    registro.registrar(falha('I1'));
    registro.registrar(falha('I1'));
    assert.equal(registro.abertas(), 1);
  }));

test('a consulta que lanca na reconferencia deixa a mensagem aberta e nao lanca', () =>
  comPasta((pasta) => {
    let lanca = false;
    const { estado, registro } = montar(pasta, {
      existe: () => {
        if (lanca) throw new Error('banco ocupado');
        return false;
      },
    });
    registro.registrar(falha('I1'));
    lanca = true;
    estado.agora += PRAZO_DE_PERDA_MS * 2;
    assert.doesNotThrow(() => registro.reconferir());
    assert.equal(registro.abertas(), 1);
  }));

test('carregar reconstroi so as abertas: a resolvida e a ja gravada nao voltam', () =>
  comPasta((pasta) => {
    const a = montar(pasta);
    a.estado.no.add('J');
    a.registro.registrar(falha('J')); // ja gravada
    a.registro.registrar(falha('R')); // vai ser resolvida
    a.registro.registrar(falha('A')); // continua aberta
    a.estado.no.add('R');
    a.estado.agora += 5_000;
    a.registro.reconferir();
    const b = montar(pasta);
    b.registro.carregar();
    assert.equal(b.registro.abertas(), 1);
  }));

test('o contador de falhas de registro sobrevive ao reinicio', () =>
  comPasta((pasta) => {
    writeFileSync(join(pasta, 'arquivo-comum'), 'x');
    const a = montar(pasta, { caminho: join(pasta, 'arquivo-comum', 'decifra.jsonl') });
    a.registro.registrar(falha('I1'));
    const b = montar(pasta);
    assert.equal(b.registro.falhasDeRegistro(), 1);
  }));
