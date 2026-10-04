import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoresDaConversa, SQL_DOS_AUTORES_DA_CONVERSA } from '../src/nucleo/autores-da-conversa.js';
import { registrarMensagem } from '../src/nucleo/escrita.js';
import { acervoDeIdentidade, PRECEDENCIA, minuto } from './ajuda/identidade.js';

test('autores: quem escreveu, uma vez cada, com valor, nome, origem e Pessoa; inclui quem nao e participante (#1129)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const autores = autoresDaConversa(acervo, s.grupo, PRECEDENCIA);
    assert.deepEqual(autores.map((a) => a.identificadorId).sort(), [s.ana, s.bruno, s.dani].sort());
    const por = new Map(autores.map((a) => [a.identificadorId, a]));
    const bruno = por.get(s.bruno)!;
    assert.deepEqual([bruno.nome, bruno.origemDoNome, bruno.pessoaId], ['Bruno Contato', 'contatos', null]);
    const dani = por.get(s.dani)!;
    assert.deepEqual([dani.nome, dani.origemDoNome], ['Dani', 'whatsapp'], 'Dani escreve e nao consta de participantes');
    const ana = por.get(s.ana)!;
    assert.deepEqual([ana.nome, ana.pessoaId], ['Ana WhatsApp', s.pessoaDeAna]);
    assert.ok(!por.has(s.edu), 'Edu e participante e nunca escreveu: nao e autor');
    assert.ok(autores.every((a) => a.valor.length > 0));
  } finally {
    limpar();
  }
});

test('Mensagem sem autor nao entra, e Conversa sem Mensagem devolve lista vazia (#1129)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    registrarMensagem(acervo, {
      conversaId: s.diretaDeBruno,
      fonte: 'whatsapp',
      idExterno: 'sistema-1',
      conteudo: 'evento',
      ocorridaEm: minuto(50),
      agora: Date.now(),
      direcao: 'recebida',
    });
    assert.deepEqual(
      autoresDaConversa(acervo, s.diretaDeBruno, PRECEDENCIA).map((a) => a.identificadorId),
      [s.bruno],
    );
    assert.deepEqual(autoresDaConversa(acervo, s.diretaDeEdu, PRECEDENCIA), []);
  } finally {
    limpar();
  }
});

test('o plano parte do indice da Conversa (#1129)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const plano = (
      acervo.preparar(`EXPLAIN QUERY PLAN ${SQL_DOS_AUTORES_DA_CONVERSA}`).all(s.grupo) as Array<{ detail: string }>
    )
      .map((l) => l.detail)
      .join(' | ');
    assert.match(plano, /idx_mensagens_conversa/, plano);
    assert.match(plano, /DISTINCT/, `sem DISTINCT o JSON dos ids leva uma linha por Mensagem (270 mil na maior Conversa): ${plano}`);
  } finally {
    limpar();
  }
});
