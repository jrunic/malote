import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeEscolhido, montarNomes } from '../src/nucleo/identidade.js';
import {
  pareceValorSentinela,
  comDescarteDeNome,
} from '../src/adaptadores/whatsapp/nome-sentinela-de-contato.js';
import { PRECEDENCIA } from './ajuda/identidade.js';

// Os dois blocos medidos em campo (#1137): protobuf de metadado, sem texto, que a plataforma grava no lugar do nome.
const BLOCO_DE_29_10 = '+EAAYrP740wYgAQ==';
const BLOCO_DE_05_11 = '+CgAQ97ah0QY=';

const linha = (nome: string, origem: string, autoridade: 'titular' | 'terceiro' | null) => ({
  origem,
  nome,
  atribuido_em: '2026-11-05T00:00:00.000Z',
  autoridade,
  configuracao_id: null,
  pessoa_id: null,
});

test('os dois blocos medidos em campo sao reconhecidos pela forma', () => {
  assert.equal(pareceValorSentinela(BLOCO_DE_29_10), true);
  assert.equal(pareceValorSentinela(BLOCO_DE_05_11), true);
});

test('nome humano nunca e reconhecido como bloco (falso positivo)', () => {
  for (const nome of [
    'Guilherme',
    'Maria da Silva',
    '+55 65 99999',
    'Ana+Bia=',
    '😀',
    'A=',
    '+AB',
    '',
  ]) {
    assert.equal(pareceValorSentinela(nome), false, nome);
  }
});

test('sem descarte, o bloco de Autoridade titular vence o push name (o defeito de hoje)', () => {
  const historico = montarNomes([
    linha(BLOCO_DE_29_10, 'whatsapp', 'titular'),
    linha('Guilherme', 'whatsapp', 'terceiro'),
  ]);
  assert.equal(nomeEscolhido(historico, PRECEDENCIA)?.nome, BLOCO_DE_29_10);
});

test('com descarte, o push name vence e o bloco continua no historico', () => {
  const historico = montarNomes([
    linha(BLOCO_DE_29_10, 'whatsapp', 'titular'),
    linha('Guilherme', 'whatsapp', 'terceiro'),
  ]);
  const precedencia = comDescarteDeNome(PRECEDENCIA);
  assert.equal(nomeEscolhido(historico, precedencia)?.nome, 'Guilherme');
  assert.equal(historico.length, 2, 'o dado nao e tocado');
});

test('o bloco e a unica Atribuicao: segue sendo o nome escolhido (nenhuma saida muda sem nome real para o lugar dele)', () => {
  const historico = montarNomes([linha(BLOCO_DE_05_11, 'whatsapp', 'titular')]);
  assert.equal(nomeEscolhido(historico, comDescarteDeNome(PRECEDENCIA))?.nome, BLOCO_DE_05_11);
});

test('o emoji do push name e nome real (o caso medido em 05/11/2026)', () => {
  const historico = montarNomes([
    linha(BLOCO_DE_05_11, 'whatsapp', 'titular'),
    linha('🙂', 'whatsapp', 'terceiro'),
  ]);
  assert.equal(nomeEscolhido(historico, comDescarteDeNome(PRECEDENCIA))?.nome, '🙂');
});

test('com mais de um bloco e um nome real, o real vence; com so blocos, a regra de sempre decide entre eles', () => {
  const dois = montarNomes([
    linha(BLOCO_DE_29_10, 'whatsapp', 'titular'),
    linha(BLOCO_DE_05_11, 'whatsapp', 'terceiro'),
    linha('Guilherme', 'whatsapp', 'terceiro'),
  ]);
  // mesma origem e mesmo peso que os blocos: so o descarte faz o nome real vencer (o 'titular' do bloco venceria pelo rank)
  assert.equal(nomeEscolhido(dois, comDescarteDeNome(PRECEDENCIA))?.nome, 'Guilherme');
  const soBlocos = montarNomes([
    linha(BLOCO_DE_29_10, 'whatsapp', 'titular'),
    linha(BLOCO_DE_05_11, 'whatsapp', 'terceiro'),
  ]);
  assert.equal(nomeEscolhido(soBlocos, comDescarteDeNome(PRECEDENCIA))?.nome, BLOCO_DE_29_10);
});
