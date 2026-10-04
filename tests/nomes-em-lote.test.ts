import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enriquecerPresenca, nomesEmLote } from '../src/nucleo/nomes-em-lote.js';
import { quemEstavaEm } from '../src/nucleo/presenca.js';
import { registrarTransicao } from '../src/nucleo/escrita.js';
import { acervoDeIdentidade, PRECEDENCIA, ANA, BRUNO, EDU, minuto } from './ajuda/identidade.js';

test('nomesEmLote devolve o nome corrente e a origem de cada Identificador do conjunto (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const m = nomesEmLote(acervo, [s.ana, s.bruno, s.edu, s.carla], PRECEDENCIA);
    assert.deepEqual(m.get(s.ana), { nome: 'Ana WhatsApp', origem: 'whatsapp' });
    assert.deepEqual(m.get(s.bruno), { nome: 'Bruno Contato', origem: 'contatos' });
    assert.equal(m.get(s.edu), undefined, 'sem Atribuicao, sem entrada');
    assert.deepEqual(m.get(s.carla), { nome: 'Carla Souza', origem: 'whatsapp' });
    assert.equal(nomesEmLote(acervo, [], PRECEDENCIA).size, 0);
  } finally {
    limpar();
  }
});

test('nomesEmLote usa UMA consulta, e nao uma por Identificador (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    let chamadas = 0;
    const original = acervo.preparar.bind(acervo);
    (acervo as unknown as { preparar: unknown }).preparar = (sql: string) => {
      if (/FROM atribuicoes_de_nome/.test(sql)) chamadas += 1;
      return original(sql);
    };
    nomesEmLote(acervo, [s.ana, s.bruno, s.carla, s.dani, s.edu, s.solto], PRECEDENCIA);
    assert.equal(chamadas, 1, 'uma consulta de Atribuicoes para o conjunto inteiro');
  } finally {
    limpar();
  }
});

test('participantes ganham valor, nome, origemDoNome e pessoaId, e os campos antigos ficam iguais (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const pura = quemEstavaEm(acervo, { conversaId: s.grupo, em: Date.now() });
    const rica = enriquecerPresenca(acervo, pura, PRECEDENCIA);
    // Sem Alcance (nenhuma Transicao gravada), todos caem em semInformacao.
    assert.equal(rica.presentes.length, 0);
    assert.equal(rica.semInformacao.length, 3, 'a fixture produz os tres participantes do grupo');
    const por = (valor: string) => rica.semInformacao.find((p) => p.valor === valor)!;
    assert.deepEqual(
      [por(ANA).nome, por(ANA).origemDoNome, por(ANA).pessoaId],
      ['Ana WhatsApp', 'whatsapp', s.pessoaDeAna],
      'o nome do participante e o do PROPRIO Identificador, nao o da Pessoa',
    );
    assert.deepEqual([por(BRUNO).nome, por(BRUNO).origemDoNome, por(BRUNO).pessoaId], ['Bruno Contato', 'contatos', null]);
    assert.deepEqual([por(EDU).nome, por(EDU).origemDoNome, por(EDU).pessoaId], [null, null, null]);
    // Compatibilidade: os campos que ja existiam seguem presentes e com o mesmo valor.
    for (const p of rica.semInformacao) {
      const antiga = pura.semInformacao.find((x) => x.identificadorId === p.identificadorId)!;
      assert.equal(p.identificadorId, antiga.identificadorId);
      assert.equal(p.situacao, antiga.situacao);
    }
    assert.deepEqual(rica.ressalva, pura.ressalva);
    assert.equal(rica.conversaId, pura.conversaId);
    assert.equal(rica.dentroDoAlcance, pura.dentroDoAlcance);
  } finally {
    limpar();
  }
});

test('com Alcance, presentes e saidos trazem entrouEm e saiuEm, e o enriquecimento nao os perde (#1126)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    // Ana entra e fica; Bruno entra e sai; Edu nunca tem evento (cai em sem-informacao dentro do Alcance).
    const evento = (identificadorId: string, natureza: 'entrou' | 'saiu', quando: number, n: string) =>
      registrarTransicao(acervo, {
        conversaId: s.grupo,
        identificadorId,
        natureza,
        ocorridaEm: quando,
        fonte: 'whatsapp',
        idExterno: `ev-${n}`,
        codigoDaFonte: natureza === 'entrou' ? '27' : '32',
      });
    evento(s.ana, 'entrou', minuto(1), 'a');
    evento(s.bruno, 'entrou', minuto(2), 'b1');
    evento(s.bruno, 'saiu', minuto(8), 'b2');
    const pura = quemEstavaEm(acervo, { conversaId: s.grupo, em: minuto(8) });
    assert.equal(pura.dentroDoAlcance, true, 'a fixture produz um Alcance que cobre a data');
    assert.equal(pura.presentes.length, 1, 'a fixture produz um presente (Ana)');
    assert.equal(pura.sairamAntes.length, 1, 'a fixture produz um que saiu (Bruno)');
    const rica = enriquecerPresenca(acervo, pura, PRECEDENCIA);
    const ana = rica.presentes[0]!;
    assert.equal(ana.valor, ANA);
    assert.equal(ana.entrouEm, minuto(1), 'o campo antigo entrouEm sobrevive');
    assert.equal(ana.situacao, 'presente');
    const bruno = rica.sairamAntes[0]!;
    assert.equal(bruno.valor, BRUNO);
    assert.equal(bruno.saiuEm, minuto(8), 'o campo antigo saiuEm sobrevive');
    assert.equal(rica.semInformacao.find((p) => p.valor === EDU)?.situacao, 'sem-informacao');
  } finally {
    limpar();
  }
});
