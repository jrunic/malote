import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anotarCorrespondencia, lerCorrespondencia, DIAS_GUARDADOS } from '../src/cli/vigilancia.js';
import { drenar } from '../src/cli/ouvir.js';
import { derramar, contarDerrame } from '../src/cli/derrame.js';
import { paraDrenar } from './ajuda/drenagem.js';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { caminhosDaConta } from '../src/cli/ouvir.js';
import { marcarUltimoEvento } from '../src/cli/ultimo-evento.js';

function pasta(): { caminho: string; limpar: () => void } {
  const raiz = mkdtempSync(join(tmpdir(), 'malote-vigilancia-'));
  return { caminho: join(raiz, 'correspondencia.json'), limpar: () => rmSync(raiz, { recursive: true, force: true }) };
}

const DIA = 86_400_000;
const NADA = { coletivaOpaca: 0, coletivaComPar: 0, diretaOpaca: 0, diretaComPar: 0 };

/**
 * BALDES DIARIOS, e a escolha tem medicao por tras.
 *
 * A #775 pedia "janela movel" e "linha de base propria". Medido em 12/09/2026, a
 * taxa diaria da Conversa direta oscila de 0% a 66% entre dias CONSECUTIVOS, com
 * o mesmo coletor e a mesma conta — um alarme por queda diaria dispararia quase
 * todo dia. Balde por dia UTC deixa a FROTA escolher a janela que quiser, e o
 * produto nao precisa carregar maquina de janela movel nem aprender linha de
 * base. O produto conta; quem alarma e quem vigia.
 */

test('soma no balde do dia, em UTC', () => {
  const p = pasta();
  try {
    anotarCorrespondencia(
      p.caminho,
      { coletivaOpaca: 3, coletivaComPar: 2, diretaOpaca: 1, diretaComPar: 0 },
      Date.parse('2026-09-12T23:59:00Z'),
    );
    assert.deepEqual(lerCorrespondencia(p.caminho), {
      '2026-09-12': { coletivaOpaca: 3, coletivaComPar: 2, diretaOpaca: 1, diretaComPar: 0 },
    });
  } finally {
    p.limpar();
  }
});

test('o MESMO dia acumula; dias diferentes ficam separados', () => {
  const p = pasta();
  try {
    const um = { coletivaOpaca: 1, coletivaComPar: 1, diretaOpaca: 0, diretaComPar: 0 };
    anotarCorrespondencia(p.caminho, um, Date.parse('2026-09-12T01:00:00Z'));
    anotarCorrespondencia(p.caminho, um, Date.parse('2026-09-12T22:00:00Z'));
    anotarCorrespondencia(p.caminho, um, Date.parse('2026-09-13T00:30:00Z'));

    const b = lerCorrespondencia(p.caminho);
    assert.equal(b['2026-09-12']?.coletivaOpaca, 2);
    assert.equal(b['2026-09-13']?.coletivaOpaca, 1);
  } finally {
    p.limpar();
  }
});

test('lote sem nada opaco NAO cria balde — zero visto e diferente de nada visto', () => {
  const p = pasta();
  try {
    anotarCorrespondencia(p.caminho, NADA, Date.parse('2026-09-12T10:00:00Z'));
    assert.equal(existsSync(p.caminho), false, 'nem o arquivo nasce');
    assert.deepEqual(lerCorrespondencia(p.caminho), {});
  } finally {
    p.limpar();
  }
});

test(`balde mais velho que ${DIAS_GUARDADOS} dias e podado`, () => {
  const p = pasta();
  try {
    const agora = Date.parse('2026-09-12T10:00:00Z');
    const um = { coletivaOpaca: 1, coletivaComPar: 1, diretaOpaca: 0, diretaComPar: 0 };
    anotarCorrespondencia(p.caminho, um, agora - (DIAS_GUARDADOS + 5) * DIA);
    anotarCorrespondencia(p.caminho, um, agora - 2 * DIA);
    anotarCorrespondencia(p.caminho, um, agora);

    const dias = Object.keys(lerCorrespondencia(p.caminho)).sort();
    assert.equal(dias.length, 2, 'o velho saiu, os dois recentes ficaram');
    assert.deepEqual(dias, ['2026-09-10', '2026-09-12']);
  } finally {
    p.limpar();
  }
});

test('arquivo ausente le como vazio, sem erro', () => {
  const p = pasta();
  try {
    assert.deepEqual(lerCorrespondencia(p.caminho), {});
  } finally {
    p.limpar();
  }
});

/**
 * O CONSUMIDOR E O OUVINTE DE PRODUCAO, que roda por meses. Arquivo corrompido
 * — disco cheio no meio da escrita, queda de energia — nao pode derrubar a
 * captura: perder a serie de vigilancia e barato, perder Mensagem nao e.
 */
test('arquivo corrompido nao derruba: le como vazio e a serie recomeca', () => {
  const p = pasta();
  try {
    writeFileSync(p.caminho, '{isto nao e json', 'utf8');
    assert.deepEqual(lerCorrespondencia(p.caminho), {});

    anotarCorrespondencia(
      p.caminho,
      { coletivaOpaca: 1, coletivaComPar: 1, diretaOpaca: 0, diretaComPar: 0 },
      Date.parse('2026-09-12T10:00:00Z'),
    );
    assert.equal(lerCorrespondencia(p.caminho)['2026-09-12']?.coletivaOpaca, 1);
  } finally {
    p.limpar();
  }
});

/**
 * A release que levar isto REINICIA o ouvinte — o post_install faz isso. Se a
 * serie nao sobrevivesse ao restart, ela nasceria zerada em toda release e
 * nunca acumularia janela nenhuma.
 */
test('a serie sobrevive ao reinicio: o estado esta no arquivo, nao na memoria', () => {
  const p = pasta();
  try {
    const um = { coletivaOpaca: 5, coletivaComPar: 4, diretaOpaca: 2, diretaComPar: 1 };
    anotarCorrespondencia(p.caminho, um, Date.parse('2026-09-12T08:00:00Z'));

    // "Reiniciar" e exatamente isto: ninguem guardou nada em memoria entre as
    // duas chamadas, e a segunda so conhece o arquivo.
    anotarCorrespondencia(p.caminho, um, Date.parse('2026-09-12T09:00:00Z'));

    assert.deepEqual(lerCorrespondencia(p.caminho)['2026-09-12'], {
      coletivaOpaca: 10,
      coletivaComPar: 8,
      diretaOpaca: 4,
      diretaComPar: 2,
    });
  } finally {
    p.limpar();
  }
});

/**
 * O EVENTO DERRAMADO E CONTADO UMA VEZ, e o "uma" nao e obvio.
 *
 * `drenar` chama `receberEvento` de novo sobre o lote derramado — entao a
 * pergunta e se ele conta duas vezes. Nao conta: o que derrama e o lote cujo
 * `receberEvento` LANCOU, e a excecao sobe antes de o relato voltar; aquela
 * contagem nunca chegou a ser anotada. Contar na drenagem nao repete nada, e
 * NAO contar la perderia a evidencia de que a fonte estava viva durante a
 * disputa — justamente quando mais importa saber.
 */
test('a drenagem anota a serie do lote que havia derramado', async () => {
  const c = await paraDrenar();
  try {
    const vigia = join(c.raiz, 'ouvinte', 'drena', 'correspondencia.json');
    derramar(c.caminho, [
      {
        key: {
          remoteJid: '120363000000000001@g.us',
          id: 'D1',
          fromMe: false,
          participant: '109876543210987@lid',
          participantPn: '5565911110001@s.whatsapp.net',
        },
        messageTimestamp: Math.floor(Date.parse('2026-09-12T10:00:00Z') / 1000),
        message: { conversation: 'derramada' },
      },
    ]);

    assert.deepEqual(lerCorrespondencia(vigia), {}, 'antes de drenar, nada anotado');

    drenar(
      c.acervo,
      c.caminho,
      c.cfg,
      () => Date.parse('2026-09-12T11:00:00Z'),
      () => undefined,
      vigia,
    );

    assert.deepEqual(lerCorrespondencia(vigia)['2026-09-12'], {
      coletivaOpaca: 1,
      coletivaComPar: 1,
      diretaOpaca: 0,
      diretaComPar: 0,
    });
  } finally {
    c.limpar();
  }
});

test('sem caminho de vigilancia, drenar drena e NAO escreve serie', async () => {
  // A drenagem continua funcionando para quem a chama sem vigilancia — a suite
  // inteira do ciclo 15 a chama assim, e quebra-la seria regressao.
  const c = await paraDrenar();
  try {
    const vigia = join(c.raiz, 'ouvinte', 'drena', 'correspondencia.json');
    derramar(c.caminho, [
      {
        key: {
          remoteJid: '120363000000000001@g.us',
          id: 'S1',
          fromMe: false,
          participant: '109876543210987@lid',
          participantPn: '5565911110001@s.whatsapp.net',
        },
        messageTimestamp: Math.floor(Date.parse('2026-09-12T10:00:00Z') / 1000),
        message: { conversation: 'derramada' },
      },
    ]);

    drenar(c.acervo, c.caminho, c.cfg, () => Date.parse('2026-09-12T11:00:00Z'), () => undefined);

    assert.equal(contarDerrame(c.caminho), 0, 'drenou');
    assert.equal(existsSync(vigia), false, 'e nao criou serie');
  } finally {
    c.limpar();
  }
});

/**
 * A SAIDA DEFAULT DE `ouvinte estado` E CONTRATO COM A FROTA, e este par de
 * testes existe por causa de um incidente medido.
 *
 * O watchdog do `jd-health-check` passa a saida INTEIRA para `date -u -d`. Uma
 * linha a mais e a conversao falha, o instante vira 0, a idade e contada desde
 * 1970 — e sai alarme de silencio em toda execucao, em todas as contas. Foi
 * medido em 09/09/2026 lendo o consumidor real antes de mexer na saida, e e por
 * isso que a serie de vigilancia entra SO no `--json`.
 */
test('a serie aparece no --json', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const caminhos = caminhosDaConta(raiz, 'c1');
    mkdirSync(join(raiz, 'ouvinte', 'c1'), { recursive: true });
    marcarUltimoEvento(caminhos.ultimoEvento, Date.parse('2026-09-12T10:00:00Z'));
    anotarCorrespondencia(
      caminhos.correspondencia,
      { coletivaOpaca: 4, coletivaComPar: 3, diretaOpaca: 1, diretaComPar: 0 },
      Date.parse('2026-09-12T10:00:00Z'),
    );

    const r = rodar(raiz, ['ouvinte', 'estado', '--conta', 'c1', '--json']);
    assert.equal(r.codigo, 0);
    const lido = JSON.parse(r.saida) as { correspondencia: Record<string, unknown> };
    assert.deepEqual(lido.correspondencia['2026-09-12'], {
      coletivaOpaca: 4,
      coletivaComPar: 3,
      diretaOpaca: 1,
      diretaComPar: 0,
    });
  } finally {
    limpar();
  }
});

test('e a saida DEFAULT continua sendo uma linha so, conversivel por date', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const caminhos = caminhosDaConta(raiz, 'c2');
    mkdirSync(join(raiz, 'ouvinte', 'c2'), { recursive: true });
    marcarUltimoEvento(caminhos.ultimoEvento, Date.parse('2026-09-12T10:00:00Z'));
    anotarCorrespondencia(
      caminhos.correspondencia,
      { coletivaOpaca: 4, coletivaComPar: 3, diretaOpaca: 1, diretaComPar: 0 },
      Date.parse('2026-09-12T10:00:00Z'),
    );

    const r = rodar(raiz, ['ouvinte', 'estado', '--conta', 'c2']);
    assert.equal(r.codigo, 0);
    assert.equal(r.saida.split('\n').length, 1, 'UMA linha — o watchdog converte a saida inteira');
    assert.equal(r.saida.trim(), '2026-09-12T10:00:00.000Z');
    // E o teste que decide: a serie NAO pode vazar para a saida default.
    assert.doesNotMatch(r.saida, /coletiva|correspondencia/);
  } finally {
    limpar();
  }
});
