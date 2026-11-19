import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoComInquilino, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { COMANDOS_DE_REDE, executar } from '../src/cli/index.js';

/** `legenda extrair` pela CLI (#1530). Legenda SINTETICA; a saida nunca a traz (so contagens). */
const AGORA = Date.parse('2026-11-18T12:00:00Z');
const CONTATO = '5511900000001@s.whatsapp.net';
const LEGENDA = 'Legenda sintetica de teste';

function instalacaoComEstoque(corpo: (raiz: string, inq: string) => void): void {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inq = instalacaoComInquilino(raiz);
    const acervo = abrirAcervo(join(raiz, 'acervos'), inq);
    try {
      const cv = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: CONTATO, coletiva: false, configuracao: { id: 'cfg-teste', fonte: 'whatsapp' } });
      for (const [id, midia] of [['I1', 'imageMessage'], ['V1', 'videoMessage']] as const) {
        registrarMensagem(acervo, {
          origemDaChegada: 'importacao',
          conversaId: cv,
          fonte: 'whatsapp',
          idExterno: id,
          ocorridaEm: AGORA,
          agora: AGORA,
          direcao: 'recebida',
          bruto: JSON.stringify({ key: { id }, message: { [midia]: { caption: LEGENDA } } }),
        });
      }
    } finally {
      acervo.fechar();
    }
    corpo(raiz, inq);
  } finally {
    limpar();
  }
}

const gravadas = (raiz: string, inq: string): number => {
  const a = abrirAcervo(join(raiz, 'acervos'), inq);
  try {
    return (a.db.prepare("SELECT COUNT(*) AS n FROM mensagens WHERE conteudo IS NOT NULL").get() as { n: number }).n;
  } finally {
    a.fechar();
  }
};

test('o ensaio e o padrao: conta por origem, diz que nada foi escrito, e a saida NAO traz a legenda', () => {
  instalacaoComEstoque((raiz, inq) => {
    const r = rodar(raiz, ['legenda', 'extrair', '--inquilino', inq]);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /Ensaio: 2 legenda\(s\) a gravar como texto da Mensagem/);
    assert.match(r.saida, /Ao vivo: 1 imagem\(ns\), 1 video\(s\), 0 documento\(s\)/);
    assert.match(r.saida, /Nada foi escrito/);
    assert.equal(r.saida.includes('sintetica'), false, 'legenda e dado pessoal: nunca vai a relatorio');
    assert.equal(gravadas(raiz, inq), 0);
  });
});

test('--com-efeito exige --confirmo, e sem ele nada e escrito', () => {
  instalacaoComEstoque((raiz, inq) => {
    const r = rodar(raiz, ['legenda', 'extrair', '--inquilino', inq, '--com-efeito']);
    assert.notEqual(r.codigo, 0);
    assert.match(r.saida, /Repita o comando com --confirmo/);
    assert.equal(gravadas(raiz, inq), 0);
  });
});

test('--com-efeito --confirmo grava, diz como desfazer e a saida segue sem a legenda; repetir nao grava de novo', () => {
  instalacaoComEstoque((raiz, inq) => {
    const r = rodar(raiz, ['legenda', 'extrair', '--inquilino', inq, '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /Gravado: 2 legenda\(s\)/);
    assert.match(r.saida, /Para desfazer: malote operacao desfazer /);
    assert.equal(r.saida.includes('sintetica'), false);
    assert.equal(gravadas(raiz, inq), 2);
    const de_novo = rodar(raiz, ['legenda', 'extrair', '--inquilino', inq, '--com-efeito', '--confirmo']);
    assert.equal(de_novo.codigo, 0);
    assert.match(de_novo.saida, /Gravado: 0 legenda\(s\)/);
    assert.doesNotMatch(de_novo.saida, /Para desfazer/);
  });
});

test('--json devolve so contagens, e --limite invalido sai 2', () => {
  instalacaoComEstoque((raiz, inq) => {
    const j = rodar(raiz, ['legenda', 'extrair', '--inquilino', inq, '--json']);
    assert.equal(j.codigo, 0);
    const corpo = JSON.parse(j.saida) as Record<string, unknown>;
    assert.deepEqual(corpo['aoVivo'], { imagem: 1, video: 1, documento: 0 });
    assert.equal(j.saida.includes('sintetica'), false);
    assert.equal(rodar(raiz, ['legenda', 'extrair', '--inquilino', inq, '--limite', '0']).codigo, 2);
    assert.equal(rodar(raiz, ['legenda', 'extrair', '--inquilino', inq, '--tamanho-do-lote', 'x']).codigo, 2);
  });
});

test('o indice defasado: o comando recusa com saida 1 e uma mensagem que diz isso, sem escrever', () => {
  instalacaoComEstoque((raiz, inq) => {
    const a = abrirAcervo(join(raiz, 'acervos'), inq);
    try {
      a.preparar('UPDATE mensagens SET conteudo = ? WHERE id_externo = ?').run('texto sem entrada no indice', 'I1');
    } finally {
      a.fechar();
    }
    const r = rodar(raiz, ['legenda', 'extrair', '--inquilino', inq, '--com-efeito', '--confirmo']);
    assert.equal(r.codigo, 1);
    assert.match(r.saida, /indice de busca por texto nao esta de acordo/);
    assert.equal(gravadas(raiz, inq), 1, 'so o texto que o teste pos; o comando nao escreveu');
  });
});

test('o verbo NAO esta entre os comandos que o modo rede despacha (a lista e por primeira palavra): so assim o modo rede o recusa como local', () => {
  assert.equal(COMANDOS_DE_REDE.has('legenda'), false);
});

test('no modo rede o comando e recusado como operacao LOCAL, antes de abrir o Registro', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const linhas: string[] = [];
    const codigo = executar(['legenda', 'extrair', '--inquilino', 'inq', '--com-efeito', '--confirmo'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      servidor: 'http://x',
      chave: 'k',
    });
    assert.equal(codigo, 2);
    assert.match(linhas.join('\n'), /operacao LOCAL/);
    assert.equal(existsSync(join(raiz, 'registro.db')), false, 'a invocacao abriu base');
  } finally {
    limpar();
  }
});
