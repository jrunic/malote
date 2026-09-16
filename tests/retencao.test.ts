import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import {
  definirPoliticaDeRetencao,
  lerPoliticaDeRetencao,
} from '../src/registro/politica-de-retencao.js';
import { cenario } from './ajuda/acervo.js';
import { buscarMensagens, contarAcervo } from '../src/nucleo/consulta.js';
import { aplicarRetencao, projetarRetencao } from '../src/nucleo/retencao.js';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Acervo } from '../src/nucleo/acervo.js';
import { DestinoInacessivelError } from '../src/nucleo/arquivo-de-anexo.js';

/** Só arquivos, em caminho relativo — pastas vazias não contam como acervo. */
function arquivosSob(raiz: string): string[] {
  return readdirSync(raiz, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => `${d.parentPath}/${d.name}`)
    .sort();
}

function descartadosNo(acervo: Acervo): number {
  return (
    acervo.db
      .prepare("SELECT COUNT(*) AS n FROM anexos WHERE presenca = 'descartado'")
      .get() as { n: number }
  ).n;
}

test('Política sem critério algum é recusada, e nada fica gravado', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });

    // Conjunção sobre zero critérios é verdadeira para TODO Anexo: aceitar a
    // Política vazia seria aceitar "descarte tudo" escrito como "não decidi".
    assert.throws(
      () => definirPoliticaDeRetencao(registro, inquilino, {}),
      /pelo menos um criterio/i,
    );
    assert.equal(lerPoliticaDeRetencao(registro, inquilino), null);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('a Política gravada volta com os critérios que foram declarados', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });
    definirPoliticaDeRetencao(registro, inquilino, {
      maisVelhoQueDias: 365,
      tipos: ['video'],
    });

    const p = lerPoliticaDeRetencao(registro, inquilino);
    assert.equal(p?.maisVelhoQueDias, 365);
    assert.deepEqual(p?.tipos, ['video']);
    // Critério não declarado volta ausente, não como zero: "não filtro por
    // tamanho" e "filtro por tamanho maior que zero" são coisas diferentes.
    assert.equal(p?.maiorQueBytes, undefined);
  } finally {
    registro.fechar();
    limpar();
  }
});

test('Inquilino desconhecido não recebe Política', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  try {
    assert.throws(
      () => definirPoliticaDeRetencao(registro, 'inquilino-que-nao-existe', { tipos: ['video'] }),
      /Inquilino desconhecido/,
    );
  } finally {
    registro.fechar();
    limpar();
  }
});

// ─────────────────────────── projeção ───────────────────────────

const DIA = 86_400_000;
const AGORA = Date.UTC(2026, 7, 28);

/**
 * Três Anexos `presente` com idades e tamanhos escolhidos para que cada
 * critério isolado alcance um conjunto DIFERENTE — sem isso o teste não
 * distingue projeção por critério de projeção total.
 */
function acervoComTresAnexos(
  c: ReturnType<typeof cenario>,
  presenca: 'presente' | 'nunca-obtido' = 'presente',
) {
  const { acervo } = c.novoInquilino('Leia Organa');
  const p = { presenca };
  c.registrarAnexo(acervo, { tipo: 'video', tamanho: 50_000_000, ocorridaEm: AGORA - 1200 * DIA, ...p });
  c.registrarAnexo(acervo, { tipo: 'image', tamanho: 200_000, ocorridaEm: AGORA - 1200 * DIA, ...p });
  c.registrarAnexo(acervo, { tipo: 'video', tamanho: 40_000_000, ocorridaEm: AGORA - 10 * DIA, ...p });
  return acervo;
}

test('projetar não altera Presença alguma, e separa por critério', () => {
  const c = cenario();
  try {
    const acervo = acervoComTresAnexos(c);
    const antes = contarAcervo(acervo);

    const p = projetarRetencao(acervo, {
      politica: { maisVelhoQueDias: 365, tipos: ['video'] },
      agora: AGORA,
    });

    // A conjunção: velho E vídeo — só o primeiro.
    assert.equal(p.anexos, 1);
    assert.equal(p.bytes, 50_000_000);

    // Cada critério ISOLADO alcança conjunto diferente. É o número que o
    // Titular usa para calibrar antes de combinar.
    assert.equal(p.porCriterio['idade']?.anexos, 2);
    assert.equal(p.porCriterio['tipos']?.anexos, 2);

    // Nada mudou no Acervo: projetar é leitura.
    assert.deepEqual(contarAcervo(acervo), antes);
    // Escalar, não objeto: `assert.equal` do modo estrito é `strictEqual`, e
    // dois objetos distintos nunca passam nele por mais iguais que pareçam.
    assert.equal(
      (
        acervo.db
          .prepare("SELECT COUNT(*) AS n FROM anexos WHERE presenca = 'presente'")
          .get() as { n: number }
      ).n,
      3,
    );
  } finally {
    c.limpar();
  }
});

test('projetar sem critério algum é recusado, e não devolve o Acervo inteiro', () => {
  const c = cenario();
  try {
    const acervo = acervoComTresAnexos(c);
    assert.throws(
      () => projetarRetencao(acervo, { politica: {}, agora: AGORA }),
      /sem criterio/i,
    );
  } finally {
    c.limpar();
  }
});

test('Anexo que não está presente nunca é alvo', () => {
  const c = cenario();
  try {
    const acervo = acervoComTresAnexos(c, 'nunca-obtido');
    // Nunca tiveram arquivo, e não há o que descartar.
    const p = projetarRetencao(acervo, { politica: { tipos: ['video'] }, agora: AGORA });
    assert.equal(p.anexos, 0);
  } finally {
    c.limpar();
  }
});

// ─────────────────────────── aplicar ───────────────────────────

test('aplicar sem bandeira é ensaio: nenhum arquivo sai e nenhuma Presença muda', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const antes = arquivosSob(destino);
    assert.ok(antes.length > 0, 'sem arquivo em disco o ensaio mede o vazio');

    const r = aplicarRetencao(acervo, {
      politica: { tipos: ['video'] },
      destino,
      agora: AGORA,
    });

    assert.equal(r.comEfeito, false);
    assert.ok(r.projecao.anexos > 0, 'o ensaio precisa ter alvo, senão mede o vazio');
    assert.equal(r.descartados, 0);
    assert.deepEqual(arquivosSob(destino), antes);
    assert.equal(descartadosNo(acervo), 0);
  } finally {
    c.limpar();
  }
});

test('aplicar com efeito apaga o arquivo, mantém a linha e registra quando e por quê', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const antes = contarAcervo(acervo);

    const r = aplicarRetencao(acervo, {
      politica: { tipos: ['video'] },
      destino,
      agora: AGORA,
      comEfeito: true,
    });

    assert.equal(r.descartados, 2, 'os dois vídeos do auxiliar');
    assert.equal(r.falhas, 0);

    const l = acervo.db
      .prepare(
        "SELECT presenca, tamanho, caminho, descartado_em, descartado_por FROM anexos WHERE presenca = 'descartado' LIMIT 1",
      )
      .get() as {
      presenca: string;
      tamanho: number | null;
      caminho: string | null;
      descartado_em: string;
      descartado_por: string;
    };

    // O Descritor sobrevive: o tamanho continua lá, e é o que permite dizer
    // "aqui houve um vídeo que não está mais guardado".
    assert.ok(l.tamanho !== null && l.tamanho > 0);
    assert.equal(l.caminho, null, 'o caminho sai: o arquivo não está mais lá');
    assert.equal(l.descartado_em, new Date(AGORA).toISOString());
    assert.equal(l.descartado_por, 'tipos=video');

    // Nenhuma linha sumiu: descarte afeta o arquivo, não o registro.
    const depois = contarAcervo(acervo);
    assert.equal(depois.mensagens, antes.mensagens);
    assert.equal(depois.conversas, antes.conversas);
    assert.equal(depois.identificadores, antes.identificadores);

    // A imagem não era alvo e continua em disco.
    assert.equal(arquivosSob(destino).length, 1);
  } finally {
    c.limpar();
  }
});

test('reaplicar a mesma Política não muda mais nada e reporta zero', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const opcoes = {
      politica: { tipos: ['video'] },
      destino,
      agora: AGORA,
      comEfeito: true,
    };

    const primeira = aplicarRetencao(acervo, opcoes);
    assert.ok(primeira.descartados > 0);

    const segunda = aplicarRetencao(acervo, opcoes);
    assert.equal(segunda.descartados, 0);
    assert.equal(segunda.projecao.anexos, 0);
  } finally {
    c.limpar();
  }
});

// ─────────────────── guardas estruturais ───────────────────

test('aplicar com efeito não toca Mensagem, Conversa, Pessoa nem Identificador', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    const antes = contarAcervo(acervo);
    const anexosAntes = (
      acervo.db.prepare('SELECT COUNT(*) AS n FROM anexos').get() as { n: number }
    ).n;

    const r = aplicarRetencao(acervo, {
      politica: { tipos: ['video'] },
      destino,
      agora: AGORA,
      comEfeito: true,
    });
    assert.ok(r.descartados > 0, 'sem alvo, esta guarda mede o vazio');

    assert.deepEqual(contarAcervo(acervo), antes);
    assert.equal(
      (acervo.db.prepare('SELECT COUNT(*) AS n FROM anexos').get() as { n: number }).n,
      anexosAntes,
    );
  } finally {
    c.limpar();
  }
});

test('a aplicação não alcança arquivo de outro Inquilino na mesma raiz de Destino', () => {
  const c = cenario();
  try {
    const raiz = c.raizDeDestinoCompartilhada();
    const a = c.inquilinoComArquivos({ destino: raiz });
    const b = c.inquilinoComArquivos({ destino: raiz });

    const arquivosDeB = arquivosSob(join(raiz, b.id));
    assert.ok(arquivosDeB.length > 0, 'o vizinho precisa ter arquivo, senão nada é protegido');

    aplicarRetencao(a.acervo, {
      politica: { tipos: ['video'] },
      destino: raiz,
      agora: AGORA,
      comEfeito: true,
    });

    assert.deepEqual(arquivosSob(join(raiz, b.id)), arquivosDeB);
    // E o próprio alvo perdeu os dele: senão o teste passaria por não fazer nada.
    assert.equal(arquivosSob(join(raiz, a.id)).length, 1);
  } finally {
    c.limpar();
  }
});

test('caminho que escapa da subárvore não apaga nada e é contado como falha', () => {
  const c = cenario();
  try {
    const raiz = c.raizDeDestinoCompartilhada();
    const a = c.inquilinoComArquivos({ destino: raiz });
    const b = c.inquilinoComArquivos({ destino: raiz });

    const alvoDeB = arquivosSob(join(raiz, b.id))[0];
    assert.ok(alvoDeB, 'o vizinho precisa ter arquivo para haver o que proteger');

    // Corrompe o `caminho` de um vídeo de A para apontar, por travessia, ao
    // arquivo de B. A porta nunca escreveria isto — `caminhoDeMidia` sempre
    // começa pelo Inquilino do próprio Acervo. É dado adulterado, que é
    // exatamente o que a guarda existe para não obedecer.
    const travessia = `${a.id}/../${relative(raiz, alvoDeB)}`;
    a.acervo.db
      .prepare("UPDATE anexos SET caminho = ? WHERE tipo = 'video' AND presenca = 'presente' LIMIT 1")
      .run(travessia);

    const r = aplicarRetencao(a.acervo, {
      politica: { tipos: ['video'] },
      destino: raiz,
      agora: AGORA,
      comEfeito: true,
    });

    assert.equal(existsSync(alvoDeB), true, 'o arquivo do vizinho sobrevive à travessia');
    assert.equal(r.falhas, 1, 'a travessia é contada como falha, não silenciada');
    assert.equal(r.descartados, 1, 'o outro vídeo, de caminho íntegro, foi descartado');
  } finally {
    c.limpar();
  }
});

// ─────────────────── Destino inacessível ───────────────────

test('com Destino inacessível: o ensaio passa e a aplicação com efeito recusa', () => {
  const c = cenario();
  try {
    const { acervo, destino } = c.inquilinoComArquivos();
    rmSync(destino, { recursive: true, force: true }); // o Destino "desmontou"

    // Ensaio segue: não escreve em lugar nenhum, e é justamente o que o
    // Titular precisa poder rodar com o disco fora.
    const ensaio = aplicarRetencao(acervo, {
      politica: { tipos: ['video'] },
      destino,
      agora: AGORA,
    });
    assert.equal(ensaio.comEfeito, false);
    assert.ok(ensaio.projecao.anexos > 0);

    // Com efeito recusa. Sem esta recusa, `rmSync force` leria "já não existe"
    // para todo alvo e transitaria a Presença sem apagar nada — e ao remontar
    // sobraria órfão eterno, com o banco dizendo `descartado`.
    assert.throws(
      () =>
        aplicarRetencao(acervo, {
          politica: { tipos: ['video'] },
          destino,
          agora: AGORA,
          comEfeito: true,
        }),
      DestinoInacessivelError,
    );
    assert.equal(descartadosNo(acervo), 0);
  } finally {
    c.limpar();
  }
});

// ────────── a Mensagem sobrevive na consulta (critério 20) ──────────

test('depois do descarte a Mensagem continua na busca, com a Presença explícita', () => {
  const c = cenario();
  try {
    // O texto entra pela PORTA, no INSERT. `mensagens_texto` é FTS alimentada
    // por gatilho AFTER INSERT e não tem gatilho de UPDATE: texto posto por
    // UPDATE fica na tabela e nunca chega ao índice, e a busca não o acha.
    const { acervo, destino } = c.inquilinoComArquivos();

    const antes = buscarMensagens(acervo, { texto: 'holocron' });
    assert.equal(antes.length, 2, 'os dois vídeos do auxiliar dizem holocron');
    assert.ok(antes.every((m) => m.anexos[0]?.presenca === 'presente'));

    aplicarRetencao(acervo, {
      politica: { tipos: ['video'] },
      destino,
      agora: AGORA,
      comEfeito: true,
    });

    // Descarte afeta o arquivo, nunca o registro: a Mensagem continua achável.
    const depois = buscarMensagens(acervo, { texto: 'holocron' });
    assert.equal(depois.length, 2, 'descartar o arquivo não pode sumir com a Mensagem');
    assert.equal(depois[0]?.anexos.length, 1, 'o Descritor do Anexo sobrevive ao descarte');
    assert.ok(
      depois.every((m) => m.anexos[0]?.presenca === 'descartado'),
      'a Presença fica explícita no resultado da consulta',
    );
    assert.ok(
      (depois[0]?.anexos[0]?.tamanho ?? 0) > 0,
      'o tamanho sobrevive: houve um vídeo, e de quanto',
    );
  } finally {
    c.limpar();
  }
});

test('a saída de texto do buscar nomeia o Anexo descartado', () => {
  const c = cenario();
  try {
    const { id, acervo, destino } = c.inquilinoComArquivos();
    aplicarRetencao(acervo, {
      politica: { tipos: ['video'] },
      destino,
      agora: AGORA,
      comEfeito: true,
    });
    // A CLI abre o próprio handle sobre os mesmos arquivos; fechar antes evita
    // depender da janela de escrita do WAL para o que o outro handle enxerga.
    acervo.fechar();

    const { saida, codigo } = rodar(c.raiz, ['buscar', '--inquilino', id, '--texto', 'holocron']);

    assert.equal(codigo, 0);
    assert.match(saida, /holocron/, 'a Mensagem continua na saída depois do descarte');
    // É na saída de TEXTO que o Titular confunde "descartei o arquivo" com
    // "perdi o acervo". O `--json` já carregava a Presença antes deste plano.
    assert.match(saida, /descartado/i);
  } finally {
    c.limpar();
  }
});
