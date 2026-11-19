import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoComInquilino, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { configuracaoPorApelido } from '../src/registro/configuracao-adaptador.js';
import { registrarEnderecosDoVinculo } from '../src/registro/endereco-da-conta.js';

/** `configuracao trocar-telefone` pela CLI (#1564), na ordem das verificacoes da spec. Numeros sinteticos. */
const CRIAR = (inq: string, apelido: string, telefone: string): string[] =>
  ['configuracao', 'criar', '--inquilino', inq, '--fonte', 'whatsapp', '--configuracao', apelido, '--telefone', telefone];
const TROCAR = (inq: string, apelido: string, telefone: string, extra: string[] = []): string[] =>
  ['configuracao', 'trocar-telefone', '--inquilino', inq, '--configuracao', apelido, '--telefone', telefone, ...extra];
const listar = (raiz: string, inq: string): string => rodar(raiz, ['configuracao', 'listar', '--inquilino', inq]).saida;
const operacoes = (raiz: string): number => {
  const r = abrirRegistro(raiz);
  try {
    return (r.db.prepare(`SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'trocar-telefone-da-conta'`).get() as { n: number }).n;
  } finally {
    r.fechar();
  }
};

function cenarioComConta(corpo: (raiz: string, inq: string) => void): void {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    assert.equal(rodar(raiz, CRIAR(inq, 'principal', '5511900000001')).codigo, 0);
    corpo(raiz, inq);
  } finally {
    limpar();
  }
}

test('sem --com-efeito e ENSAIO: mostra o antes e o depois, diz o que nao faz, e nao escreve nem abre Operacao', () => {
  cenarioComConta((raiz, inq) => {
    const r = rodar(raiz, TROCAR(inq, 'principal', '5511900000002'));
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /ENSAIO {2}whatsapp\/principal {2}telefone: 5511900000001 -> 5511900000002/);
    assert.match(r.saida, /Nao troca o vinculo, nao move Conversa, nao apaga nada/);
    assert.match(listar(raiz, inq), /telefone: 5511900000001/);
    assert.equal(operacoes(raiz), 0);
  });
});

test('--com-efeito SEM --mesma-conta sai 2 e nao escreve', () => {
  cenarioComConta((raiz, inq) => {
    const r = rodar(raiz, TROCAR(inq, 'principal', '5511900000002', ['--com-efeito']));
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /Falta --mesma-conta/);
    assert.match(listar(raiz, inq), /telefone: 5511900000001/);
    assert.equal(operacoes(raiz), 0);
  });
});

test('--com-efeito --mesma-conta troca, abre UMA Operacao, e o listar mostra o telefone novo', () => {
  cenarioComConta((raiz, inq) => {
    const r = rodar(raiz, TROCAR(inq, 'principal', '5511900000002', ['--com-efeito', '--mesma-conta']));
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /telefone: 5511900000001 -> 5511900000002/);
    assert.match(r.saida, /Para voltar: rode o mesmo comando com o numero anterior/);
    assert.match(listar(raiz, inq), /telefone: 5511900000002/);
    assert.equal(operacoes(raiz), 1);
  });
});

test('o mesmo telefone, tambem com ou sem o nono digito, sai 0 sem escrever nem abrir Operacao', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    assert.equal(rodar(raiz, CRIAR(inq, 'principal', '5511999990001')).codigo, 0);
    for (const igual of ['5511999990001', '551199990001']) {
      const r = rodar(raiz, TROCAR(inq, 'principal', igual, ['--com-efeito', '--mesma-conta']));
      assert.equal(r.codigo, 0, igual);
      assert.match(r.saida, /Nada foi feito/);
    }
    assert.equal(operacoes(raiz), 0);
  } finally {
    limpar();
  }
});

test('as recusas saem 2, nada e gravado, e cada uma tem a sua mensagem (telefone invalido, Configuracao desconhecida, sem telefone, de OUTRA Configuracao)', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    assert.equal(rodar(raiz, CRIAR(inq, 'principal', '5511999990001')).codigo, 0);
    assert.equal(rodar(raiz, CRIAR(inq, 'outra', '5511999990002')).codigo, 0);
    // Configuracao de WhatsApp SEM telefone declarado: nasce por importacao, nunca por `criar`.
    const registro = abrirRegistro(raiz);
    try {
      registro.db.prepare(`DELETE FROM enderecos_da_conta WHERE configuracao_id = ?`).run(configuracaoPorApelido(registro, inq, 'whatsapp', 'outra')!.id);
    } finally {
      registro.fechar();
    }
    const efeito = ['--com-efeito', '--mesma-conta'];

    const invalido = rodar(raiz, TROCAR(inq, 'principal', '12', efeito));
    assert.equal(invalido.codigo, 2);
    assert.match(invalido.saida, /Telefone invalido/);

    const desconhecida = rodar(raiz, TROCAR(inq, 'nao-existe', '5511999990009', efeito));
    assert.equal(desconhecida.codigo, 2);
    assert.match(desconhecida.saida, /Configuracao desconhecida/);

    const semTelefone = rodar(raiz, TROCAR(inq, 'outra', '5511999990009', efeito));
    assert.equal(semTelefone.codigo, 2);
    assert.match(semTelefone.saida, /nao tem telefone declarado: use configuracao definir-telefone/);

    // O telefone de OUTRA Configuracao: igual e sem o nono digito.
    assert.equal(rodar(raiz, CRIAR(inq, 'terceira', '5511999990003')).codigo, 0);
    for (const dela of ['5511999990003', '551199990003']) {
      const r = rodar(raiz, TROCAR(inq, 'principal', dela, efeito));
      assert.equal(r.codigo, 2, dela);
      assert.match(r.saida, /ja pertence a Configuracao terceira/);
    }
    assert.equal(operacoes(raiz), 0, 'nenhuma recusa escreveu');
    assert.match(listar(raiz, inq), /whatsapp\/principal {2}conta: \(nao declarada\) {2}telefone: 5511999990001/);
  } finally {
    limpar();
  }
});

test('a ordem das verificacoes: telefone invalido vem antes da Configuracao desconhecida, e a idempotencia antes da recusa por outra Configuracao', () => {
  cenarioComConta((raiz, inq) => {
    assert.match(rodar(raiz, TROCAR(inq, 'nao-existe', '12')).saida, /Telefone invalido/);
    // O mesmo telefone da Configuracao: idempotente (0) mesmo sem a confirmacao.
    assert.equal(rodar(raiz, TROCAR(inq, 'principal', '5511900000001', ['--com-efeito'])).codigo, 0);
  });
});

test('a recusa por telefone de OUTRA Configuracao vale tambem no ENSAIO: o ensaio nao promete o que o efeito recusaria', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    assert.equal(rodar(raiz, CRIAR(inq, 'principal', '5511999990001')).codigo, 0);
    assert.equal(rodar(raiz, CRIAR(inq, 'outra', '5511999990002')).codigo, 0);
    const ensaio = rodar(raiz, TROCAR(inq, 'principal', '5511999990002'));
    assert.equal(ensaio.codigo, 2);
    assert.match(ensaio.saida, /ja pertence a Configuracao outra/);
    assert.doesNotMatch(ensaio.saida, /ENSAIO/);
    // E o idempotente (mesmo telefone) tambem vem antes do ensaio e antes da exigencia da confirmacao.
    const igual = rodar(raiz, TROCAR(inq, 'principal', '5511999990001'));
    assert.equal(igual.codigo, 0);
    assert.doesNotMatch(igual.saida, /ENSAIO/);
  } finally {
    limpar();
  }
});

test('voltar atras e rodar de novo com o numero anterior', () => {
  cenarioComConta((raiz, inq) => {
    const efeito = ['--com-efeito', '--mesma-conta'];
    assert.equal(rodar(raiz, TROCAR(inq, 'principal', '5511900000002', efeito)).codigo, 0);
    assert.equal(rodar(raiz, TROCAR(inq, 'principal', '5511900000001', efeito)).codigo, 0);
    assert.match(listar(raiz, inq), /telefone: 5511900000001/);
    assert.equal(operacoes(raiz), 2);
  });
});

test('a troca nao toca o que o vinculo mostrou: jid e lid ficam no listar', () => {
  cenarioComConta((raiz, inq) => {
    const registro = abrirRegistro(raiz);
    try {
      const cfg = configuracaoPorApelido(registro, inq, 'whatsapp', 'principal')!;
      registrarEnderecosDoVinculo(registro, cfg.id, {
        telefone: '5511900000001',
        jid: '5511900000001@s.whatsapp.net',
        lid: '100000000000001@lid',
      });
    } finally {
      registro.fechar();
    }
    assert.equal(rodar(raiz, TROCAR(inq, 'principal', '5511900000002', ['--com-efeito', '--mesma-conta'])).codigo, 0);
    const linha = listar(raiz, inq);
    assert.match(linha, /telefone: 5511900000002 {2}jid: 5511900000001@s\.whatsapp\.net {2}lid: 100000000000001@lid/);
  });
});

test('no modo rede o comando e recusado (fail-closed), sem abrir o Registro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const codigo = executar(
      TROCAR('inq', 'principal', '5511900000002', ['--com-efeito', '--mesma-conta']),
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t), servidor: 'http://x', chave: 'k' },
    );
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /operacao LOCAL/);
    assert.equal(existsSync(join(raiz, 'registro.db')), false, 'a invocacao abriu base');
  } finally {
    limpar();
  }
});

test('--mesma-conta e bandeira: nao engole o argumento seguinte como valor', () => {
  cenarioComConta((raiz, inq) => {
    const r = rodar(raiz, ['configuracao', 'trocar-telefone', '--inquilino', inq, '--configuracao', 'principal', '--com-efeito', '--mesma-conta', '--telefone', '5511900000002']);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(listar(raiz, inq), /telefone: 5511900000002/);
  });
});
