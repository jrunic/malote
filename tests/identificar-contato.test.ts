import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identificarPorValor } from '../src/nucleo/identificar.js';
import {
  registrarConversa,
  registrarMensagem,
  registrarParticipacao,
} from '../src/nucleo/escrita.js';
import {
  acervoDeIdentidade,
  PRECEDENCIA,
  BASE,
  CARLA,
  CARLA_LID,
  minuto,
} from './ajuda/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('pelo numero e pelo opaco, o contato mostra as mesmas Conversas e Mensagens: as do contato, nao as da conta (#1465)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: CARLA_LID,
      coletiva: false,
      configuracao: CFG_WHATSAPP,
      bruto: '{}',
    });
    // o caso da spec: a Participacao esta sob o NUMERO e as Mensagens sob a forma opaca
    registrarParticipacao(acervo, {
      conversaId: conversa,
      identificadorId: s.carla,
      observadaEm: new Date(BASE).toISOString(),
    });
    const m = (i: number, autorId: string | undefined, direcao: 'enviada' | 'recebida'): void => {
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        conversaId: conversa,
        fonte: 'whatsapp',
        idExterno: `ic-${i}`,
        ...(autorId === undefined ? {} : { autorId }),
        conteudo: `x${i}`,
        ocorridaEm: minuto(50 + i),
        agora: Date.now(),
        direcao,
      });
    };
    for (let i = 0; i < 4; i += 1) m(i, s.carlaLid, 'recebida');
    for (let i = 4; i < 6; i += 1) m(i, undefined, 'enviada');

    const pelaOpaca = identificarPorValor(acervo, { valor: CARLA_LID }, PRECEDENCIA);
    const peloNumero = identificarPorValor(acervo, { valor: CARLA }, PRECEDENCIA);
    for (const r of [pelaOpaca, peloNumero]) {
      assert.equal(r.totais.conversas, 1, 'a Conversa contada uma vez');
      assert.equal(r.totais.mensagens, 4, 'so as que o contato escreveu');
      assert.equal(r.totais.primeiraMensagemEm, minuto(50));
      assert.equal(r.totais.ultimaMensagemEm, minuto(53));
    }
    assert.deepEqual(
      peloNumero.totais,
      pelaOpaca.totais,
      'os totais sao os mesmos pelas duas formas',
    );
    // os numeros por Identificador seguem como eram (acrescimo, sem quebra)
    const numero = peloNumero.identificadores.find((i) => i.valor === CARLA)!;
    assert.equal(numero.mensagens, 0);
    assert.equal(numero.conversas, 1);
  } finally {
    limpar();
  }
});

test('contato sem par: os totais do contato sao os do proprio Identificador', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const r = identificarPorValor(acervo, { valor: '5565444444444@s.whatsapp.net' }, PRECEDENCIA);
    const dani = r.identificadores.find((i) => i.id === s.dani)!;
    assert.equal(dani.mensagens, 2);
    assert.deepEqual(r.totais, {
      conversas: dani.conversas,
      mensagens: dani.mensagens,
      primeiraMensagemEm: dani.primeiraMensagemEm,
      ultimaMensagemEm: dani.ultimaMensagemEm,
    });
  } finally {
    limpar();
  }
});

test('valor sem Identificador nenhum: totais do contato zerados', () => {
  const { acervo, limpar } = acervoDeIdentidade();
  try {
    const r = identificarPorValor(acervo, { valor: 'x@nao-existe' }, PRECEDENCIA);
    assert.deepEqual(r.totais, {
      conversas: 0,
      mensagens: 0,
      primeiraMensagemEm: null,
      ultimaMensagemEm: null,
    });
  } finally {
    limpar();
  }
});
