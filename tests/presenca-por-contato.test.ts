import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quemEstavaEm, type RespostaDePresenca } from '../src/nucleo/presenca.js';
import { enriquecerPresenca } from '../src/nucleo/nomes-em-lote.js';
import {
  registrarMensagem,
  registrarParticipacao,
  registrarTransicao,
} from '../src/nucleo/escrita.js';
import { executarConsultaRede } from '../src/cli/index.js';
import { rodar } from './ajuda/instalacao.js';
import {
  acervoDeIdentidade,
  subirCenaDeIdentidade,
  PRECEDENCIA,
  BASE,
  BRUNO,
  BRUNO_LID,
  CARLA,
  CARLA_LID,
  minuto,
} from './ajuda/identidade.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const depois = BASE + 3_600_000;

const todos = <T>(r: {
  presentes: T[];
  sairamAntes: T[];
  aindaNaoEntraram: T[];
  semInformacao: T[];
}): T[] => [...r.presentes, ...r.sairamAntes, ...r.aindaNaoEntraram, ...r.semInformacao];

let n = 0;
function escreverNoGrupo(
  acervo: Acervo,
  grupo: string,
  autorId: string,
  direcao: 'enviada' | 'recebida' = 'recebida',
): void {
  n += 1;
  registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId: grupo,
    fonte: 'whatsapp',
    idExterno: `pc-${n}`,
    autorId,
    conteudo: 'oi',
    ocorridaEm: minuto(40 + n),
    agora: Date.now(),
    direcao,
  });
}

function participaSobONumero(acervo: Acervo, grupo: string, carla: string): void {
  registrarParticipacao(acervo, {
    conversaId: grupo,
    identificadorId: carla,
    observadaEm: new Date(BASE).toISOString(),
  });
}

test('o autor so existe sob a forma opaca e a Participacao sob o numero: aparece, com as duas formas ligadas', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escreverNoGrupo(acervo, s.grupo, s.carlaLid);
    participaSobONumero(acervo, s.grupo, s.carla);
    const r = enriquecerPresenca(
      acervo,
      quemEstavaEm(acervo, { conversaId: s.grupo, em: depois }),
      PRECEDENCIA,
    );
    const carla = todos(r).find((p) => p.identificadorId === s.carla)!;
    const opaca = todos(r).find((p) => p.identificadorId === s.carlaLid);
    assert.ok(opaca, 'o autor sob a forma opaca aparece na lista');
    assert.equal(carla.endereco, CARLA);
    assert.equal(opaca.endereco, CARLA, 'a chave de agrupamento e a mesma');
    assert.deepEqual(opaca.formas, [CARLA]);
    assert.deepEqual(carla.formas, [CARLA_LID]);
    assert.equal(opaca.valor, CARLA_LID, 'cada linha mantem o proprio endereco');
    assert.equal(opaca.nome, null, 'e o proprio nome: o opaco nao tem Atribuicao');
    assert.equal(carla.situacao, opaca.situacao, 'as duas linhas dizem a mesma coisa do contato');
  } finally {
    limpar();
  }
});

test('sem par, o contato e o proprio endereco e nao ha outras formas; com par so em correspondencia, a forma aparece', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const r = quemEstavaEm(acervo, { conversaId: s.grupo, em: depois });
    const edu = todos(r).find((p) => p.identificadorId === s.edu)!;
    assert.deepEqual([edu.endereco, edu.formas], ['5565555555555@s.whatsapp.net', []]);
    const bruno = todos(r).find((p) => p.identificadorId === s.bruno)!;
    assert.deepEqual([bruno.endereco, bruno.formas], [BRUNO, [BRUNO_LID]]);
  } finally {
    limpar();
  }
});

test('a Transicao sob o numero decide a presenca da linha do endereco opaco', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escreverNoGrupo(acervo, s.grupo, s.carlaLid);
    registrarTransicao(acervo, {
      origemDaChegada: 'importacao',
      conversaId: s.grupo,
      identificadorId: s.carla,
      natureza: 'entrou',
      ocorridaEm: BASE,
      fonte: 'whatsapp',
      idExterno: 'pc-t1',
      codigoDaFonte: '',
    });
    registrarTransicao(acervo, {
      origemDaChegada: 'importacao',
      conversaId: s.grupo,
      identificadorId: s.dani,
      natureza: 'entrou',
      ocorridaEm: BASE + 1,
      fonte: 'whatsapp',
      idExterno: 'pc-t2',
      codigoDaFonte: '',
    });
    // O Alcance da Conversa e [MIN, MAX] das Transicoes: [BASE, BASE + 1]. Perguntar dentro dele.
    const r = quemEstavaEm(acervo, { conversaId: s.grupo, em: BASE + 1 });
    assert.equal(r.dentroDoAlcance, true);
    const opaca = r.presentes.find((p) => p.identificadorId === s.carlaLid);
    assert.ok(opaca, 'o opaco esta presente pelo evento do numero');
    assert.equal(opaca.entrouEm, BASE);
    assert.ok(r.presentes.some((p) => p.identificadorId === s.carla));
  } finally {
    limpar();
  }
});

test('autor sem Participacao nem Transicao em forma nenhuma NAO entra na lista (presenca nunca se infere de ter escrito)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escreverNoGrupo(acervo, s.grupo, s.solto);
    // a Dani escreve no grupo (fixture) e nao participa sob forma nenhuma
    const r = quemEstavaEm(acervo, { conversaId: s.grupo, em: depois });
    const ids = todos(r).map((p) => p.identificadorId);
    assert.ok(!ids.includes(s.solto));
    assert.ok(!ids.includes(s.dani));
    assert.equal(ids.length, 3, 'so os tres participantes da fixture');
  } finally {
    limpar();
  }
});

test('a Mensagem ENVIADA sob a forma opaca nao poe o opaco na lista', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escreverNoGrupo(acervo, s.grupo, s.carlaLid, 'enviada');
    participaSobONumero(acervo, s.grupo, s.carla);
    const ids = todos(quemEstavaEm(acervo, { conversaId: s.grupo, em: depois })).map(
      (p) => p.identificadorId,
    );
    assert.ok(ids.includes(s.carla));
    assert.ok(!ids.includes(s.carlaLid));
  } finally {
    limpar();
  }
});

test('o filtro por endereco acha o contato por qualquer das formas', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escreverNoGrupo(acervo, s.grupo, s.carlaLid);
    participaSobONumero(acervo, s.grupo, s.carla);
    const ids = (endereco: string): string[] =>
      todos(
        quemEstavaEm(acervo, { conversaId: s.grupo, em: depois, endereco }) as RespostaDePresenca,
      )
        .map((p) => p.identificadorId)
        .sort();
    for (const endereco of [CARLA, CARLA_LID])
      assert.deepEqual(ids(endereco), [s.carla, s.carlaLid].sort(), endereco);
    assert.deepEqual(
      ids(BRUNO_LID),
      [s.bruno],
      'a forma que so existe como correspondencia acha a linha do numero',
    );
    assert.deepEqual(ids('nao-existe@lid'), [], 'endereco desconhecido devolve nada, nunca tudo');
  } finally {
    limpar();
  }
});

interface LinhaDaResposta {
  identificadorId: string;
  endereco: string | null;
  formas: string[];
}

test('por rede e na CLI local: participantes traz contato e formas, e --endereco filtra pelo contato', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo, s) => {
      escreverNoGrupo(acervo, s.grupo, s.carlaLid);
      participaSobONumero(acervo, s.grupo, s.carla);
    },
  });
  try {
    const ler = async (caminho: string): Promise<LinhaDaResposta[]> => {
      const r = await cena.pedir(caminho, cena.chave.valor);
      assert.equal(r.status, 200, r.corpo);
      return todos(
        (
          JSON.parse(r.corpo) as {
            presenca: {
              presentes: LinhaDaResposta[];
              sairamAntes: LinhaDaResposta[];
              aindaNaoEntraram: LinhaDaResposta[];
              semInformacao: LinhaDaResposta[];
            };
          }
        ).presenca,
      );
    };
    const tudo = await ler(`/conversas/${cena.s.grupo}/participantes`);
    const opaca = tudo.find((p) => p.identificadorId === cena.s.carlaLid);
    assert.deepEqual([opaca?.endereco, opaca?.formas], [CARLA, [CARLA]]);
    const filtrado = await ler(
      `/conversas/${cena.s.grupo}/participantes?endereco=${encodeURIComponent(CARLA_LID)}`,
    );
    assert.deepEqual(
      filtrado.map((p) => p.identificadorId).sort(),
      [cena.s.carla, cena.s.carlaLid].sort(),
    );

    // a CLI local (sem enriquecer nomes) traz os mesmos campos e o mesmo filtro
    const local = rodar(cena.raiz, [
      'participantes',
      '--inquilino',
      cena.inquilinoId,
      '--conversa',
      cena.s.grupo,
      '--endereco',
      CARLA,
    ]);
    assert.equal(local.codigo, 0, local.saida);
    const linhasLocais = todos(
      JSON.parse(local.saida) as {
        presentes: LinhaDaResposta[];
        sairamAntes: LinhaDaResposta[];
        aindaNaoEntraram: LinhaDaResposta[];
        semInformacao: LinhaDaResposta[];
      },
    );
    assert.deepEqual(
      linhasLocais.map((p) => p.identificadorId).sort(),
      [cena.s.carla, cena.s.carlaLid].sort(),
    );
    assert.ok(linhasLocais.every((p) => p.endereco === CARLA));
  } finally {
    cena.encerrar();
  }
});

test('o cliente de rede repassa --endereco ao servidor', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo, s) => {
      escreverNoGrupo(acervo, s.grupo, s.carlaLid);
      participaSobONumero(acervo, s.grupo, s.carla);
    },
  });
  try {
    const saida: string[] = [];
    const codigo = await executarConsultaRede(
      ['participantes', '--conversa', cena.s.grupo, '--endereco', CARLA_LID, '--json'],
      { servidor: cena.url, chave: cena.chave.valor, escrever: (t) => saida.push(t) },
    );
    assert.equal(codigo, 0, saida.join('\n'));
    const ids = saida.join('\n').match(/"identificadorId": "[^"]+"/g) ?? [];
    assert.equal(ids.length, 2, saida.join('\n'));
  } finally {
    cena.encerrar();
  }
});
