import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import {
  LocalizacaoDeOutraFormaError,
  VERSAO_DA_LOCALIZACAO,
  abrirLocalizacao,
  abrirLocalizacaoSomenteLeitura,
  idsComDivergencia,
  registrarConferencia,
  candidatasAPerderACopiaLocal,
  caminhoDaLocalizacao,
  lerLocalizacoes,
  marcarCopiaLocalRemovida,
  recriarLocalizacao,
  registrarDuplicatas,
  amostrarSemCopiaLocal,
  lerPassadas,
  limparDivergencia,
  registrarDivergencia,
  registrarFalhaDeEnvio,
  registrarLocalizacao,
  registrarPassada,
  removerLocalizacao,
  resumoDaLocalizacao,
  type NovaLocalizacao,
} from '../src/registro/localizacao.js';

const INQUILINO_A = 'inquilino-a';
const INQUILINO_B = 'inquilino-b';

function nova(n: number, quando = '2026-11-12T10:00:00.000Z'): NovaLocalizacao {
  return {
    anexoId: `anexo-${String(n).padStart(5, '0')}`,
    remoto: 'remoto_de_teste',
    caminhoRemoto: `i/image/ab/cd${n}.jpg`,
    idNoRemoto: `id-${n}`,
    tamanho: 100 + n,
    hash: `${'0'.repeat(63)}${n % 10}`,
    verificadaEm: quando,
  };
}

test('cria a base na categoria de estado, com modo 0600, e registra e le a Localizacao', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      const caminho = caminhoDaLocalizacao(raiz, INQUILINO_A);
      assert.ok(existsSync(caminho));

      registrarLocalizacao(base, nova(1));
      // O -wal e o -shm herdam o modo do arquivo principal: os tres nascem 0600 (nao so o .db).
      for (const sufixo of ['', '-wal', '-shm']) {
        assert.equal(statSync(`${caminho}${sufixo}`).mode & 0o777, 0o600, `modo de ${sufixo || '.db'}`);
      }
      const lidas = lerLocalizacoes(base, ['anexo-00001', 'anexo-inexistente']);
      assert.equal(lidas.size, 1);
      const l = lidas.get('anexo-00001');
      assert.equal(l?.idNoRemoto, 'id-1');
      assert.equal(l?.copiaLocalRemovidaEm, null);
      assert.equal(l?.duplicatas, 0);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('le mais de 500 Anexos por vez, em lotes', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      const ids: string[] = [];
      base.db.transaction(() => {
        for (let i = 0; i < 1_234; i += 1) {
          const n = nova(i);
          registrarLocalizacao(base, n);
          ids.push(n.anexoId);
        }
      })();
      assert.equal(lerLocalizacoes(base, ids).size, 1_234);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('regravar uma Localizacao nao desfaz a remocao da copia local nem as duplicatas ja vistas', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      registrarLocalizacao(base, nova(1));
      marcarCopiaLocalRemovida(base, 'anexo-00001', '2026-11-19T10:00:00.000Z');
      registrarDuplicatas(base, 'anexo-00001', 2);
      registrarLocalizacao(base, nova(1, '2026-11-20T10:00:00.000Z'));
      const l = lerLocalizacoes(base, ['anexo-00001']).get('anexo-00001');
      assert.equal(l?.copiaLocalRemovidaEm, '2026-11-19T10:00:00.000Z');
      assert.equal(l?.duplicatas, 2);
      assert.equal(l?.verificadaEm, '2026-11-20T10:00:00.000Z');
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('as candidatas a perder a copia local sao as verificadas ate o corte e ainda com copia', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      registrarLocalizacao(base, nova(1, '2026-11-01T00:00:00.000Z'));
      registrarLocalizacao(base, nova(2, '2026-11-05T00:00:00.000Z'));
      registrarLocalizacao(base, nova(3, '2026-11-10T00:00:00.000Z'));
      marcarCopiaLocalRemovida(base, 'anexo-00001', '2026-11-09T00:00:00.000Z');

      const candidatas = candidatasAPerderACopiaLocal(base, '2026-11-06T00:00:00.000Z', 10);
      assert.deepEqual(
        candidatas.map((c) => c.anexoId),
        ['anexo-00002'],
        'o 1 ja perdeu a copia, o 3 foi verificado depois do corte',
      );
      assert.equal(candidatasAPerderACopiaLocal(base, '2026-11-06T00:00:00.000Z', 0).length, 0);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('o resumo conta enviados, bytes, copias removidas, duplicatas, falhos e a ultima verificacao', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      assert.deepEqual(resumoDaLocalizacao(base), {
        enviados: 0,
        bytesEnviados: 0,
        copiasLocaisRemovidas: 0,
        duplicatas: 0,
        falhos: 0,
        divergencias: 0,
        ultimaVerificacaoEm: null,
        verificacaoMaisAntigaComCopiaLocalEm: null,
        divergenciaMaisAntigaEm: null,
        ultimaConferenciaEm: null,
      });
      registrarLocalizacao(base, nova(1, '2026-11-01T00:00:00.000Z'));
      registrarLocalizacao(base, nova(2, '2026-11-05T00:00:00.000Z'));
      marcarCopiaLocalRemovida(base, 'anexo-00001', '2026-11-08T00:00:00.000Z');
      registrarDuplicatas(base, 'anexo-00002', 1);
      registrarFalhaDeEnvio(base, 'anexo-00003', 'erro de teste', '2026-11-05T01:00:00.000Z');
      registrarFalhaDeEnvio(base, 'anexo-00003', 'erro de teste de novo', '2026-11-05T02:00:00.000Z');
      assert.deepEqual(resumoDaLocalizacao(base), {
        enviados: 2,
        bytesEnviados: 101 + 102,
        copiasLocaisRemovidas: 1,
        duplicatas: 1,
        falhos: 1,
        divergencias: 0,
        ultimaVerificacaoEm: '2026-11-05T00:00:00.000Z',
        verificacaoMaisAntigaComCopiaLocalEm: '2026-11-05T00:00:00.000Z',
        divergenciaMaisAntigaEm: null,
        ultimaConferenciaEm: null,
      });
      const tentativas = base
        .preparar('SELECT tentativas FROM falhas_de_envio WHERE anexo_id = ?')
        .get('anexo-00003') as { tentativas: number };
      assert.equal(tentativas.tentativas, 2);

      // Enviar com sucesso limpa a falha do Anexo.
      registrarLocalizacao(base, nova(3));
      assert.equal(resumoDaLocalizacao(base).falhos, 0);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('forma diferente da corrente e recusada com a instrucao de recriar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    base.db.prepare('UPDATE versao_da_localizacao SET versao = ?').run(VERSAO_DA_LOCALIZACAO + 1);
    base.fechar();

    assert.throws(
      () => abrirLocalizacao(raiz, INQUILINO_A),
      (e: unknown) => e instanceof LocalizacaoDeOutraFormaError && /reconstruir/.test(e.message),
    );
    assert.throws(() => abrirLocalizacaoSomenteLeitura(raiz, INQUILINO_A), LocalizacaoDeOutraFormaError);
  } finally {
    limpar();
  }
});

test('recriar apaga o conteudo e deixa a base utilizavel', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    registrarLocalizacao(base, nova(1));
    base.fechar();

    const nova1 = recriarLocalizacao(raiz, INQUILINO_A);
    try {
      assert.equal(resumoDaLocalizacao(nova1).enviados, 0);
      registrarLocalizacao(nova1, nova(2));
      assert.equal(resumoDaLocalizacao(nova1).enviados, 1);
    } finally {
      nova1.fechar();
    }
  } finally {
    limpar();
  }
});

test('somente leitura devolve undefined sem base, nao cria nada e nao grava', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    assert.equal(abrirLocalizacaoSomenteLeitura(raiz, INQUILINO_A), undefined);
    assert.ok(!existsSync(caminhoDaLocalizacao(raiz, INQUILINO_A)), 'abrir para ler nao cria');

    const escrita = abrirLocalizacao(raiz, INQUILINO_A);
    registrarLocalizacao(escrita, nova(1));
    const leitura = abrirLocalizacaoSomenteLeitura(raiz, INQUILINO_A);
    try {
      assert.ok(leitura);
      assert.equal(lerLocalizacoes(leitura, ['anexo-00001']).size, 1);
      assert.throws(() => registrarLocalizacao(leitura, nova(2)), /readonly/i);
    } finally {
      leitura?.fechar();
      escrita.fechar();
    }
  } finally {
    limpar();
  }
});

test('cada Inquilino tem a sua base: o isolamento e fisico', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const a = abrirLocalizacao(raiz, INQUILINO_A);
    const b = abrirLocalizacao(raiz, INQUILINO_B);
    try {
      registrarLocalizacao(a, nova(1));
      assert.equal(lerLocalizacoes(a, ['anexo-00001']).size, 1);
      assert.equal(lerLocalizacoes(b, ['anexo-00001']).size, 0);
      assert.notEqual(caminhoDaLocalizacao(raiz, INQUILINO_A), caminhoDaLocalizacao(raiz, INQUILINO_B));
    } finally {
      a.fechar();
      b.fechar();
    }
  } finally {
    limpar();
  }
});

test('as candidatas andam por cursor de identificador: o que nao saiu nao trava a pagina seguinte', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      for (let i = 1; i <= 5; i += 1) registrarLocalizacao(base, nova(i, '2026-11-01T00:00:00.000Z'));
      const primeira = candidatasAPerderACopiaLocal(base, '2026-11-10T00:00:00.000Z', 2);
      assert.deepEqual(primeira.map((c) => c.anexoId), ['anexo-00001', 'anexo-00002']);
      const segunda = candidatasAPerderACopiaLocal(base, '2026-11-10T00:00:00.000Z', 2, 'anexo-00002');
      assert.deepEqual(segunda.map((c) => c.anexoId), ['anexo-00003', 'anexo-00004']);
      const ultima = candidatasAPerderACopiaLocal(base, '2026-11-10T00:00:00.000Z', 2, 'anexo-00004');
      assert.deepEqual(ultima.map((c) => c.anexoId), ['anexo-00005']);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('remover tira a Localizacao e as pendencias dela; amostrar so devolve quem ja perdeu a copia local', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      registrarLocalizacao(base, nova(1));
      registrarLocalizacao(base, nova(2));
      marcarCopiaLocalRemovida(base, 'anexo-00002', '2026-11-09T00:00:00.000Z');
      assert.deepEqual(amostrarSemCopiaLocal(base, 10).map((l) => l.anexoId), ['anexo-00002']);

      registrarDivergencia(base, 'anexo-00001', 'sumiu', '2026-11-10T00:00:00.000Z');
      registrarFalhaDeEnvio(base, 'anexo-00001', 'erro', '2026-11-10T00:00:00.000Z');
      removerLocalizacao(base, 'anexo-00001');
      const resumo = resumoDaLocalizacao(base);
      assert.equal(resumo.enviados, 1);
      assert.equal(resumo.divergencias, 0);
      assert.equal(resumo.falhos, 0);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('divergencia se registra, mantem o primeiro instante e se limpa', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      registrarDivergencia(base, 'anexo-00001', 'ausente', '2026-11-10T00:00:00.000Z');
      registrarDivergencia(base, 'anexo-00001', 'hash diferente', '2026-11-11T00:00:00.000Z');
      const linha = base.preparar('SELECT motivo, detectada_em FROM divergencias WHERE anexo_id = ?').get('anexo-00001') as {
        motivo: string;
        detectada_em: string;
      };
      assert.deepEqual(linha, { motivo: 'hash diferente', detectada_em: '2026-11-10T00:00:00.000Z' });
      assert.equal(resumoDaLocalizacao(base).divergencias, 1);
      limparDivergencia(base, 'anexo-00001');
      assert.equal(resumoDaLocalizacao(base).divergencias, 0);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('o fim de cada passada se grava por grupo e se le ordenado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      registrarPassada(base, { grupo: 'video', concluidaEm: '2026-11-10T00:00:00.000Z', pendentes: 3, bytesPendentes: 30, maisAntigoMs: 100 });
      registrarPassada(base, { grupo: 'resto', concluidaEm: '2026-11-10T00:01:00.000Z', pendentes: 0, bytesPendentes: 0, maisAntigoMs: null });
      registrarPassada(base, { grupo: 'video', concluidaEm: '2026-11-10T00:02:00.000Z', pendentes: 1, bytesPendentes: 10, maisAntigoMs: 200 });
      assert.deepEqual(lerPassadas(base), [
        { grupo: 'resto', concluidaEm: '2026-11-10T00:01:00.000Z', pendentes: 0, bytesPendentes: 0, maisAntigoMs: null },
        { grupo: 'video', concluidaEm: '2026-11-10T00:02:00.000Z', pendentes: 1, bytesPendentes: 10, maisAntigoMs: 200 },
      ]);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('reenviar (registrar a Localizacao de novo) CURA a divergencia: ela sai do estado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      registrarLocalizacao(base, nova(1));
      registrarDivergencia(base, 'anexo-00001', 'o remoto perdeu o arquivo', '2026-11-10T00:00:00.000Z');
      assert.deepEqual([...idsComDivergencia(base, ['anexo-00001', 'anexo-00002'])], ['anexo-00001']);
      assert.equal(resumoDaLocalizacao(base).divergencias, 1);
      registrarLocalizacao(base, nova(1, '2026-11-12T00:00:00.000Z'));
      assert.equal(resumoDaLocalizacao(base).divergencias, 0);
      assert.equal(idsComDivergencia(base, ['anexo-00001']).size, 0);
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});

test('o resumo traz a medicao crua da Escolha 5 e do criterio 17: verificacao mais antiga com copia, divergencia mais antiga, ultima conferencia', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const base = abrirLocalizacao(raiz, INQUILINO_A);
    try {
      registrarLocalizacao(base, nova(1, '2026-11-01T00:00:00.000Z'));
      registrarLocalizacao(base, nova(2, '2026-11-04T00:00:00.000Z'));
      registrarLocalizacao(base, nova(3, '2026-11-06T00:00:00.000Z'));
      marcarCopiaLocalRemovida(base, 'anexo-00001', '2026-11-08T00:00:00.000Z');
      registrarDivergencia(base, 'anexo-00002', 'sumiu', '2026-11-09T00:00:00.000Z');
      registrarDivergencia(base, 'anexo-00003', 'mudou', '2026-11-11T00:00:00.000Z');
      registrarConferencia(base, '2026-11-12T08:00:00.000Z');
      registrarConferencia(base, '2026-11-12T09:00:00.000Z');
      const r = resumoDaLocalizacao(base);
      assert.equal(r.verificacaoMaisAntigaComCopiaLocalEm, '2026-11-04T00:00:00.000Z', 'o 1 ja perdeu a copia: nao conta');
      assert.equal(r.divergenciaMaisAntigaEm, '2026-11-09T00:00:00.000Z');
      assert.equal(r.ultimaConferenciaEm, '2026-11-12T09:00:00.000Z');
    } finally {
      base.fechar();
    }
  } finally {
    limpar();
  }
});
