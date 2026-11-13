import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { criarRegistroNoPiso } from './ajuda/registro-no-piso.js';
import { abrirRegistro, criarInquilino, VERSAO_SCHEMA_REGISTRO } from '../src/registro/registro.js';
import {
  PADROES_DO_DESTINO_REMOTO,
  configurarDestinoRemotoDeMidia,
  inteiroDaOpcao,
  lerDestinoRemotoDeMidia,
  validarDestinoRemoto,
  type DestinoRemotoDeMidia,
} from '../src/registro/destino-remoto.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';

const BASE: DestinoRemotoDeMidia = { remoto: 'drive_de_teste', ...PADROES_DO_DESTINO_REMOTO };

test('o Registro de forma anterior sobe para a v9 e ganha a tabela do Destino Remoto, vazia', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    criarRegistroNoPiso(raiz);
    const r = abrirRegistro(raiz);
    try {
      assert.equal(VERSAO_SCHEMA_REGISTRO, 9);
      assert.equal(r.versaoDoSchema(), 9);
      const colunas = r.db.prepare('PRAGMA table_info(destinos_remotos_de_midia)').all() as Array<{
        name: string;
      }>;
      assert.deepEqual(
        colunas.map((c) => c.name),
        [
          'inquilino_id',
          'remoto',
          'pasta_base',
          'janela_dias',
          'apagar_local',
          'fuso',
          'transferencias',
          'chamadas_por_segundo',
          'configurado_em',
        ],
      );
      const linhas = r.db.prepare('SELECT COUNT(*) AS n FROM destinos_remotos_de_midia').get() as { n: number };
      assert.equal(linhas.n, 0);
      const passo = r.db.prepare('SELECT conferencia FROM migracoes_aplicadas WHERE para = 9').get() as
        | { conferencia: string }
        | undefined;
      assert.match(passo?.conferencia ?? '', /^ok:/);
    } finally {
      r.fechar();
    }
  } finally {
    limpar();
  }
});

test('configurar grava e le de volta, com os padroes onde nada foi dito', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });
      assert.equal(lerDestinoRemotoDeMidia(registro, inquilino), undefined);

      configurarDestinoRemotoDeMidia(registro, inquilino, BASE);
      assert.deepEqual(lerDestinoRemotoDeMidia(registro, inquilino), {
        remoto: 'drive_de_teste',
        pastaBase: 'malote',
        janelaDias: 7,
        apagarLocal: false,
        fuso: 'America/Cuiaba',
        transferencias: 4,
        chamadasPorSegundo: 8,
      });
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('declarar de novo substitui, e a trilha guarda o antes e o depois so do que mudou', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });
      configurarDestinoRemotoDeMidia(registro, inquilino, BASE);
      configurarDestinoRemotoDeMidia(registro, inquilino, { ...BASE, apagarLocal: true });

      assert.equal(lerDestinoRemotoDeMidia(registro, inquilino)?.apagarLocal, true);

      const operacoes = listarOperacoesCruas(registro).filter((o) => o.natureza === 'configurar-destino-remoto');
      assert.equal(operacoes.length, 2);
      assert.ok(operacoes.every((o) => o.reversibilidade === 'irreversivel'));
      const maisRecente = linhasDaOperacao(registro, operacoes[0]?.id as string);
      assert.deepEqual(
        maisRecente.map((l) => [l.campo, l.antes, l.depois]),
        [['apagar_local', 'false', 'true']],
      );
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('configurar para Inquilino desconhecido falha sem gravar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      assert.throws(() => configurarDestinoRemotoDeMidia(registro, 'nao-existe', BASE), /Inquilino desconhecido/);
      const n = registro.db.prepare('SELECT COUNT(*) AS n FROM destinos_remotos_de_midia').get() as { n: number };
      assert.equal(n.n, 0);
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('o Destino Remoto sai junto com o Inquilino (a chave estrangeira em cascata)', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const registro = abrirRegistro(raiz);
    try {
      const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });
      configurarDestinoRemotoDeMidia(registro, inquilino, BASE);
      registro.db.prepare('DELETE FROM inquilinos WHERE id = ?').run(inquilino);
      assert.equal(lerDestinoRemotoDeMidia(registro, inquilino), undefined);
    } finally {
      registro.fechar();
    }
  } finally {
    limpar();
  }
});

test('valida o que nao pode gravar', () => {
  const ruins: Array<[Partial<DestinoRemotoDeMidia>, RegExp]> = [
    [{ remoto: 'drive-com-hifen' }, /nome do remoto/],
    [{ remoto: '1drive' }, /nome do remoto/],
    [{ remoto: '' }, /nome do remoto/],
    [{ pastaBase: '../fora' }, /pasta-base/],
    [{ pastaBase: '/absoluta' }, /pasta-base/],
    [{ pastaBase: 'a//b' }, /pasta-base/],
    [{ pastaBase: 'com espaco' }, /pasta-base/],
    [{ janelaDias: -1 }, /Janela/],
    [{ janelaDias: 366 }, /Janela/],
    [{ janelaDias: 1.5 }, /Janela/],
    [{ transferencias: 0 }, /transferencias/],
    [{ transferencias: 33 }, /transferencias/],
    [{ chamadasPorSegundo: 51 }, /chamadas/],
    [{ fuso: 'Marte/Olympus' }, /Fuso desconhecido/],
  ];
  for (const [mudanca, esperado] of ruins) {
    assert.throws(() => validarDestinoRemoto({ ...BASE, ...mudanca }), esperado, JSON.stringify(mudanca));
  }
  // O limite de cada faixa passa, e a pasta-base vazia (raiz do remoto) tambem.
  validarDestinoRemoto({ ...BASE, pastaBase: '', janelaDias: 0, transferencias: 32, chamadasPorSegundo: 50 });
  validarDestinoRemoto({ ...BASE, pastaBase: 'a/b.c/d-e_f', janelaDias: 365, transferencias: 1, chamadasPorSegundo: 1 });
});

test('inteiroDaOpcao le inteiro, ignora o que nao veio e recusa o resto', () => {
  assert.equal(inteiroDaOpcao(undefined, '--janela-dias'), undefined);
  assert.equal(inteiroDaOpcao('7', '--janela-dias'), 7);
  assert.equal(inteiroDaOpcao('0', '--janela-dias'), 0);
  for (const ruim of ['', 'sete', '7.5', '7 dias', '0x10']) {
    assert.throws(() => inteiroDaOpcao(ruim, '--janela-dias'), /--janela-dias precisa ser um inteiro/);
  }
});
