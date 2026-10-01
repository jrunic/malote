import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { extrairDuracoesDoBruto } from '../src/adaptadores/whatsapp/duracao-do-anexo.js';

function anexoDeAudio(acervo: Parameters<typeof registrarAnexo>[0], bruto: string, duracao?: number) {
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp', idExterno: `conv-${Math.random()}`, coletiva: false, configuracao: CFG_WHATSAPP,
  });
  const mensagem = registrarMensagem(acervo, {
    direcao: 'recebida', conversaId: conversa, fonte: 'whatsapp', idExterno: `msg-${Math.random()}`,
    ocorridaEm: Date.now(), agora: Date.now(),
  });
  return registrarAnexo(acervo, {
    mensagemId: mensagem, tipo: 'audio', presenca: 'presente', caminho: 'a.opus',
    bruto, ...(duracao !== undefined ? { duracao } : {}),
  });
}

test('extrai de seconds (ao vivo) e de ZMOVIEDURATION (backup), e é idempotente', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const doVivo = anexoDeAudio(acervo, '{"seconds":42,"mimetype":"audio/ogg"}');
    const doBackup = anexoDeAudio(acervo, '{"Z_PK":1,"ZMOVIEDURATION":8,"ZFILESIZE":34565}');
    const semChave = anexoDeAudio(acervo, '{"mimetype":"audio/ogg"}'); // nem seconds nem ZMOVIEDURATION
    const jaTinha = anexoDeAudio(acervo, '{"seconds":99}', 99); // já tem duração — não deve ser tocado

    const relatorio = extrairDuracoesDoBruto(acervo);
    assert.equal(relatorio.extraidas, 2);
    assert.equal(relatorio.semChaveConhecida, 1);

    const duracao = (id: string) =>
      (acervo.preparar('SELECT duracao FROM anexos WHERE id = ?').get(id) as { duracao: number | null })
        .duracao;
    assert.equal(duracao(doVivo), 42);
    assert.equal(duracao(doBackup), 8);
    assert.equal(duracao(semChave), null);
    assert.equal(duracao(jaTinha), 99);

    // Idempotente: segunda chamada não acha mais nada a extrair.
    const segunda = extrairDuracoesDoBruto(acervo);
    assert.equal(segunda.extraidas, 0);

    // Comando de decisão — grava Operação, mesmo grão de reenfileirarFalhas.
    const operacoes = acervo.db
      .prepare(`SELECT natureza FROM operacoes WHERE natureza = 'extrair-duracao-de-anexo'`)
      .all() as { natureza: string }[];
    assert.equal(operacoes.length, 1, 'uma só Operação para o lote inteiro');
    const efeitos = acervo.db
      .prepare(`SELECT chave, depois FROM linhas_de_efeito WHERE tabela = 'anexos' AND campo = 'duracao'`)
      .all() as { chave: string; depois: string }[];
    assert.equal(efeitos.length, 2);
  } finally {
    c.limpar();
  }
});
