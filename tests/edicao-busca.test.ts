import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarEdicao } from '../src/nucleo/edicao.js';
import { registrarContatosCompartilhados } from '../src/nucleo/contato-compartilhado.js';
import { buscarMensagens, buscarMensagensComCorte } from '../src/nucleo/consulta.js';
import { executar } from '../src/cli/index.js';
import { subirCenaDeIdentidade } from './ajuda/identidade.js';

const AGORA = Date.parse('2026-10-18T12:00:00Z');

function cena() {
  const c = cenario();
  const { acervo } = c.novoInquilino('Leia Organa');
  const conversa = (idExterno: string): string =>
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: false, configuracao: CFG_WHATSAPP });
  const mensagem = (cv: string, idExterno: string, minuto: number, conteudo?: string): string =>
    registrarMensagem(acervo, {
      conversaId: cv,
      fonte: 'whatsapp',
      idExterno,
      ocorridaEm: Date.parse('2026-10-01T10:00:00Z') + minuto * 60_000,
      agora: AGORA,
      direcao: 'recebida',
      ...(conteudo !== undefined ? { conteudo } : {}),
    });
  const editar = (mensagemId: string, idExterno: string, texto: string, minuto: number): void => {
    registrarEdicao(acervo, {
      mensagemId,
      fonte: 'whatsapp',
      idExterno,
      texto,
      editadaEm: Date.parse('2026-10-01T10:00:00Z') + minuto * 60_000,
      origem: 'cifrada',
      bruto: '{}',
      agora: AGORA,
    });
  };
  return { c, acervo, conversa, mensagem, editar };
}

const ids = (acervo: Acervo, texto: string): string[] => buscarMensagens(acervo, { texto }).map((x) => x.id);

test('acha a Mensagem pelo texto de uma edicao, com a origem marcada como edicao e as edicoes junto', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    const m = mensagem(cv, 'M1', 1, 'reuniao na terca');
    editar(m, 'EV-1', 'reuniao na quarta, palavraunica', 2);
    const achadas = buscarMensagens(acervo, { texto: 'palavraunica' });
    assert.equal(achadas.length, 1);
    assert.equal(achadas[0]?.id, m);
    assert.equal(achadas[0]?.origemDaCorrespondencia, 'edicao');
    assert.deepEqual(achadas[0]?.edicoes.map((e) => e.texto), ['reuniao na quarta, palavraunica']);
    assert.equal(achadas[0]?.textoAtual, 'reuniao na quarta, palavraunica');
    assert.equal(achadas[0]?.conteudo, 'reuniao na terca', 'o conteudo original segue como foi');
  } finally {
    c.limpar();
  }
});

test('continua achando pelo texto ORIGINAL de uma Mensagem editada', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    const m = mensagem(cv, 'M1', 1, 'reuniao na terca');
    editar(m, 'EV-1', 'reuniao na quarta', 2);
    const achadas = buscarMensagens(acervo, { texto: 'terca' });
    assert.deepEqual(achadas.map((x) => x.id), [m]);
    assert.equal(achadas[0]?.origemDaCorrespondencia, 'conteudo');
  } finally {
    c.limpar();
  }
});

test('a legenda de uma midia sem texto, editada, e achada pela edicao', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    const m = mensagem(cv, 'M1', 1);
    editar(m, 'EV-1', 'foto do churrasco', 2);
    assert.deepEqual(ids(acervo, 'churrasco'), [m]);
  } finally {
    c.limpar();
  }
});

test('o conteudo vence a edicao quando os dois casam, e duas edicoes com o termo contam a Mensagem uma vez', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    const ambos = mensagem(cv, 'M1', 1, 'termocomum no original');
    editar(ambos, 'EV-1', 'termocomum depois', 2);
    const duas = mensagem(cv, 'M2', 3, 'sem o termo');
    editar(duas, 'EV-2', 'termocomum um', 4);
    editar(duas, 'EV-3', 'termocomum dois', 5);
    const r = buscarMensagensComCorte(acervo, { texto: 'termocomum', ordem: 'cronologica' });
    assert.deepEqual(r.mensagens.map((x) => x.id), [ambos, duas]);
    assert.equal(r.mensagens[0]?.origemDaCorrespondencia, 'conteudo');
    assert.equal(r.mensagens[1]?.origemDaCorrespondencia, 'edicao');
    assert.equal(r.truncado, false);
  } finally {
    c.limpar();
  }
});

test('a edicao vence a transcricao e o cartao quando casam a mesma Mensagem', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    const m = mensagem(cv, 'M1', 1, 'oi');
    editar(m, 'EV-1', 'termocomum na edicao', 2);
    const anexoId = registrarAnexo(acervo, { mensagemId: m, tipo: 'audio', presenca: 'presente', caminho: '/x/a1.opus' });
    acervo.preparar(`INSERT INTO transcricoes (anexo_id, estado, texto) VALUES (?, 'concluida', 'termocomum no audio')`).run(anexoId);
    registrarContatosCompartilhados(acervo, m, [{ nome: 'Termocomum Souza', organizacao: null, nomeComercial: null, valores: [] }]);
    const achadas = buscarMensagens(acervo, { texto: 'termocomum' });
    assert.equal(achadas.length, 1);
    assert.equal(achadas[0]?.origemDaCorrespondencia, 'edicao');
  } finally {
    c.limpar();
  }
});

test('os filtros da busca valem para a edicao: Conversa e periodo', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const a = conversa('a@s.whatsapp.net');
    const b = conversa('b@s.whatsapp.net');
    const ma = mensagem(a, 'M1', 1, 'x');
    const mb = mensagem(b, 'M2', 100, 'y');
    editar(ma, 'EV-1', 'termocomum a', 2);
    editar(mb, 'EV-2', 'termocomum b', 101);
    assert.deepEqual(buscarMensagens(acervo, { texto: 'termocomum', conversaId: a }).map((x) => x.id), [ma]);
    assert.deepEqual(buscarMensagens(acervo, { texto: 'termocomum', conversaId: b }).map((x) => x.id), [mb]);
    const corte = Date.parse('2026-10-01T10:00:00Z') + 50 * 60_000;
    assert.deepEqual(buscarMensagens(acervo, { texto: 'termocomum', de: corte }).map((x) => x.id), [mb]);
    assert.deepEqual(buscarMensagens(acervo, { texto: 'termocomum', ate: corte }).map((x) => x.id), [ma]);
  } finally {
    c.limpar();
  }
});

test('o corte e a ordem valem para a edicao, e truncado diz que ha mais', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    const feitas = [0, 1, 2, 3].map((i) => {
      const m = mensagem(cv, `M${i}`, i, 'x');
      editar(m, `EV-${i}`, `termocomum ${i}`, i + 10);
      return m;
    });
    const recentes = buscarMensagensComCorte(acervo, { texto: 'termocomum', limite: 2 });
    assert.deepEqual(recentes.mensagens.map((x) => x.id), [feitas[3], feitas[2]]);
    assert.equal(recentes.truncado, true);
    const antigas = buscarMensagensComCorte(acervo, { texto: 'termocomum', limite: 2, ordem: 'cronologica' });
    assert.deepEqual(antigas.mensagens.map((x) => x.id), [feitas[0], feitas[1]]);
    assert.equal(antigas.truncado, true);
    const exato = buscarMensagensComCorte(acervo, { texto: 'termocomum', limite: 4, ordem: 'cronologica' });
    assert.deepEqual(exato.mensagens.map((x) => x.id), feitas);
    assert.equal(exato.truncado, false);
  } finally {
    c.limpar();
  }
});

test('varias edicoes da mesma Mensagem nao gastam o corte: tres Mensagens com duas edicoes cada cabem num limite de tres', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    const feitas = [0, 1, 2].map((i) => {
      const m = mensagem(cv, `M${i}`, i, 'x');
      editar(m, `EV-${i}-a`, `termocomum primeira ${i}`, i + 10);
      editar(m, `EV-${i}-b`, `termocomum segunda ${i}`, i + 20);
      return m;
    });
    const r = buscarMensagensComCorte(acervo, { texto: 'termocomum', limite: 3, ordem: 'cronologica' });
    assert.deepEqual(r.mensagens.map((x) => x.id), feitas);
    assert.equal(r.truncado, false);
  } finally {
    c.limpar();
  }
});

test('a Mensagem removida leva a busca da edicao junto', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    const m = mensagem(cv, 'M1', 1, 'x');
    editar(m, 'EV-1', 'termocomum', 2);
    assert.deepEqual(ids(acervo, 'termocomum'), [m]);
    acervo.db.prepare('DELETE FROM mensagens WHERE id = ?').run(m);
    assert.deepEqual(ids(acervo, 'termocomum'), []);
  } finally {
    c.limpar();
  }
});

test('termo hostil nao derruba a busca com edicao no Acervo', () => {
  const { c, acervo, conversa, mensagem, editar } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    editar(mensagem(cv, 'M1', 1, 'x'), 'EV-1', 'texto qualquer', 2);
    for (const hostil of ['"', 'a"b', 'AND', 'OR NOT', '*', 'NEAR(a b)', "'; --", '%', '_']) {
      assert.doesNotThrow(() => buscarMensagens(acervo, { texto: hostil }), hostil);
    }
  } finally {
    c.limpar();
  }
});

const TEXTO_UNICO = 'palavraunicadaedicao';

function semearEdicao(acervo: Acervo, conversaId: string): string {
  const m = registrarMensagem(acervo, {
    conversaId,
    fonte: 'whatsapp',
    idExterno: 'editada-1',
    ocorridaEm: Date.parse('2026-10-01T10:00:00Z') + 500 * 60_000,
    agora: AGORA,
    direcao: 'recebida',
    conteudo: 'texto original',
  });
  registrarEdicao(acervo, {
    mensagemId: m,
    fonte: 'whatsapp',
    idExterno: 'EV-1',
    texto: `texto novo ${TEXTO_UNICO}`,
    editadaEm: Date.parse('2026-10-01T10:00:00Z') + 501 * 60_000,
    origem: 'cifrada',
    bruto: '{}',
    agora: AGORA,
  });
  return m;
}

test('GET /buscar acha o texto da edicao e marca a origem (rede)', async () => {
  const cena = await subirCenaDeIdentidade<string>({ semearMais: (acervo, s) => semearEdicao(acervo, s.diretaDeAna) });
  try {
    const r = await cena.pedir(`/buscar?texto=${TEXTO_UNICO}`, cena.chave.valor);
    assert.equal(r.status, 200, r.corpo);
    const corpo = JSON.parse(r.corpo) as {
      mensagens: Array<{ id: string; conteudo: string; textoAtual: string; origemDaCorrespondencia: string; edicoes: Array<{ texto: string }> }>;
    };
    assert.equal(corpo.mensagens.length, 1);
    assert.equal(corpo.mensagens[0]?.id, cena.extra);
    assert.equal(corpo.mensagens[0]?.origemDaCorrespondencia, 'edicao');
    assert.equal(corpo.mensagens[0]?.conteudo, 'texto original');
    assert.equal(corpo.mensagens[0]?.edicoes.length, 1);
  } finally {
    cena.encerrar();
  }
});

test('isolamento: a busca com a chave de OUTRO Inquilino nao acha o texto da edicao do Titular (rede)', async () => {
  const cena = await subirCenaDeIdentidade<string>({ semearMais: (acervo, s) => semearEdicao(acervo, s.diretaDeAna) });
  try {
    const doOutro = await cena.pedir(`/buscar?texto=${TEXTO_UNICO}`, cena.chaveDoOutro.valor);
    assert.equal(doOutro.status, 200, doOutro.corpo);
    assert.deepEqual((JSON.parse(doOutro.corpo) as { mensagens: unknown[] }).mensagens, []);
    // Contraprova: a mesma busca, com a chave do Titular, acha.
    const doTitular = await cena.pedir(`/buscar?texto=${TEXTO_UNICO}`, cena.chave.valor);
    assert.equal((JSON.parse(doTitular.corpo) as { mensagens: unknown[] }).mensagens.length, 1);
  } finally {
    cena.encerrar();
  }
});

test('buscar em texto (local) mostra a Mensagem achada pela edicao com o texto atual e a versao anterior', () => {
  const { c, acervo, conversa } = cena();
  try {
    const cv = conversa('a@s.whatsapp.net');
    semearEdicao(acervo, cv);
    const inquilino = acervo.inquilinoId;
    acervo.fechar();
    const linhas: string[] = [];
    const codigo = executar(['buscar', '--texto', TEXTO_UNICO, '--inquilino', inquilino], {
      dados: c.raiz,
      estado: c.raiz,
      escrever: (t: string) => linhas.push(t),
    });
    assert.equal(codigo, 0);
    assert.deepEqual(linhas, [`${new Date(Date.parse('2026-10-01T10:00:00Z') + 500 * 60_000).toISOString()}  texto novo ${TEXTO_UNICO} (editada)`, '    [antes] texto original']);
  } finally {
    c.limpar();
  }
});
