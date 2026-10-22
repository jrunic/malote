import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { GRUPO, LID_DE_OUTRO, TEL_DE_OUTRO, LID_DA_CONTA, JID_DA_CONTA } from './ajuda/etiqueta-ao-vivo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import type { MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { declararEnderecosDaConta } from '../src/nucleo/endereco-da-conta.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import type { Acervo } from '../src/nucleo/acervo.js';

const QUANDO = Math.floor(Date.UTC(2026, 9, 21, 12) / 1000);
const AGORA = Date.UTC(2026, 9, 21, 13);
const COM_CONTA = { agora: AGORA, configuracao: CFG_WHATSAPP, enderecoDaConta: JID_DA_CONTA };
const SEM_CONTA = { agora: AGORA, configuracao: CFG_WHATSAPP };
const OUTRO_LID = '109876543210999@lid';

function original(id: string, quando = QUANDO): MensagemRecebida {
  return {
    key: { remoteJid: GRUPO, id, fromMe: false, participant: LID_DE_OUTRO, participantPn: TEL_DE_OUTRO },
    messageTimestamp: quando,
    pushName: 'Han Solo',
    message: { extendedTextMessage: { text: 'pergunta sintetica' } },
  };
}

function minha(id: string): MensagemRecebida {
  return { key: { remoteJid: GRUPO, id, fromMe: true }, messageTimestamp: QUANDO, message: { conversation: 'minha mensagem' } };
}

function resposta(id: string, contextInfo: Record<string, unknown> | undefined, extra: Partial<MensagemRecebida['key']> = {}): MensagemRecebida {
  return {
    key: { remoteJid: GRUPO, id, fromMe: false, participant: OUTRO_LID, ...extra },
    messageTimestamp: QUANDO + 5,
    message: { extendedTextMessage: { text: 'resposta sintetica', ...(contextInfo !== undefined ? { contextInfo } : {}) } },
  };
}

interface Linha {
  id: string;
  citada_id: string | null;
  citada_id_externo: string | null;
  citada_autor_id: string | null;
  citada_direcao: string | null;
}

function linha(acervo: Acervo, idExterno: string): Linha {
  return acervo
    .preparar('SELECT id, citada_id, citada_id_externo, citada_autor_id, citada_direcao FROM mensagens WHERE id_externo = ?')
    .get(idExterno) as Linha;
}

function idDe(acervo: Acervo, valor: string): string | undefined {
  return (acervo.preparar('SELECT id FROM identificadores WHERE valor = ?').get(valor) as { id: string } | undefined)?.id;
}

function contar(acervo: Acervo, tabela: string): number {
  return (acervo.preparar(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as { n: number }).n;
}

test('a resposta a uma Mensagem que o Acervo tem e vinculada, com o autor e a direcao da citada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    receberEvento(acervo, [original('ORIG1')], COM_CONTA);
    receberEvento(acervo, [resposta('RESP1', { stanzaId: 'ORIG1', participant: LID_DE_OUTRO, quotedMessage: { conversation: 'x' } })], COM_CONTA);
    const orig = linha(acervo, 'ORIG1');
    const r = linha(acervo, 'RESP1');
    assert.equal(r.citada_id, orig.id);
    assert.equal(r.citada_id_externo, 'ORIG1');
    assert.equal(r.citada_autor_id, idDe(acervo, TEL_DE_OUTRO), 'o autor e o da citada, na forma canonica');
    assert.equal(r.citada_direcao, 'recebida');
  } finally {
    c.limpar();
  }
});

test('a citada fora do Acervo: o autor vem do participant, resolvido para a forma canonica, e NAO vira membro, nome nem Pessoa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    // A correspondencia do autor da citada e aprendida por uma Mensagem dele (par na mesma chave).
    receberEvento(acervo, [original('ORIG0')], COM_CONTA);
    const participacoesAntes = contar(acervo, 'participacoes');
    const nomesAntes = contar(acervo, 'atribuicoes_de_nome');

    receberEvento(acervo, [resposta('RESP2', { stanzaId: 'ANTIGA', participant: LID_DE_OUTRO })], COM_CONTA);
    const r = linha(acervo, 'RESP2');
    assert.equal(r.citada_id, null);
    assert.equal(r.citada_id_externo, 'ANTIGA');
    assert.equal(r.citada_autor_id, idDe(acervo, TEL_DE_OUTRO));
    assert.equal(r.citada_direcao, 'recebida');
    // So a autora da resposta (OUTRO_LID) ganhou Participacao e nome; o autor da citada, nada alem do que ja tinha.
    assert.equal(contar(acervo, 'participacoes') - participacoesAntes, 1, 'o autor da citada ganhou Participacao');
    assert.equal(contar(acervo, 'atribuicoes_de_nome') - nomesAntes, 0, 'a resposta sem pushName nao cria nome, e a citada tambem nao');
  } finally {
    c.limpar();
  }
});

test('o autor da citada que o Acervo nunca viu vira Identificador, sem Participacao, sem nome e sem Pessoa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    const DESCONHECIDO = '108888888888888@lid';
    receberEvento(acervo, [resposta('RESP3', { stanzaId: 'ANTIGA', participant: DESCONHECIDO })], COM_CONTA);
    const id = idDe(acervo, DESCONHECIDO);
    assert.ok(id !== undefined, 'o Identificador do autor da citada tem de existir');
    assert.equal(linha(acervo, 'RESP3').citada_autor_id, id);
    const n = (tabela: string) =>
      (acervo.preparar(`SELECT COUNT(*) AS n FROM ${tabela} WHERE identificador_id = ?`).get(id) as { n: number }).n;
    assert.equal(n('participacoes'), 0, 'ninguem foi observado na Conversa so por ter sido citado');
    assert.equal(n('atribuicoes_de_nome'), 0);
    const pessoa = acervo.preparar('SELECT pessoa_id FROM identificadores WHERE id = ?').get(id) as { pessoa_id: string | null };
    assert.equal(pessoa.pessoa_id, null);
  } finally {
    c.limpar();
  }
});

test('a citada da propria conta: sem autor e com a direcao enviada, mesmo quando o participant e o LID dela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    receberEvento(acervo, [resposta('RESP4', { stanzaId: 'ANTIGA-MINHA', participant: LID_DA_CONTA })], COM_CONTA);
    const r = linha(acervo, 'RESP4');
    assert.equal(r.citada_autor_id, null);
    assert.equal(r.citada_direcao, 'enviada');
    assert.equal(r.citada_id_externo, 'ANTIGA-MINHA');
  } finally {
    c.limpar();
  }
});

test('a citada que a propria conta enviou e o Acervo tem: vinculada, sem autor, direcao enviada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    receberEvento(acervo, [minha('MINHA1')], COM_CONTA);
    receberEvento(acervo, [resposta('RESP5', { stanzaId: 'MINHA1', participant: LID_DA_CONTA })], COM_CONTA);
    const r = linha(acervo, 'RESP5');
    assert.equal(r.citada_id, linha(acervo, 'MINHA1').id);
    assert.equal(r.citada_autor_id, null);
    assert.equal(r.citada_direcao, 'enviada');
  } finally {
    c.limpar();
  }
});

test('sem o endereco da conta a direcao da citada fora do Acervo fica nula, e o autor segue sendo o Identificador', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    receberEvento(acervo, [resposta('RESP6', { stanzaId: 'ANTIGA', participant: LID_DE_OUTRO })], SEM_CONTA);
    const r = linha(acervo, 'RESP6');
    assert.equal(r.citada_direcao, null);
    assert.equal(r.citada_autor_id, idDe(acervo, LID_DE_OUTRO));
  } finally {
    c.limpar();
  }
});

test('citacao sem participant: so o id externo; Mensagem sem contexto: nada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    receberEvento(acervo, [resposta('RESP7', { stanzaId: 'ANTIGA' }), resposta('SEMCITA', undefined)], COM_CONTA);
    assert.deepEqual(
      { ...linha(acervo, 'RESP7'), id: '' },
      { id: '', citada_id: null, citada_id_externo: 'ANTIGA', citada_autor_id: null, citada_direcao: null },
    );
    assert.deepEqual(
      { ...linha(acervo, 'SEMCITA'), id: '' },
      { id: '', citada_id: null, citada_id_externo: null, citada_autor_id: null, citada_direcao: null },
    );
  } finally {
    c.limpar();
  }
});

test('a citada que chega DEPOIS completa o vinculo da resposta ao vivo; reentregar o evento nao muda nada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    const evento = resposta('RESP8', { stanzaId: 'ORIG2', participant: LID_DE_OUTRO });
    receberEvento(acervo, [evento], COM_CONTA);
    assert.equal(linha(acervo, 'RESP8').citada_id, null);

    receberEvento(acervo, [original('ORIG2', QUANDO - 10)], COM_CONTA);
    const orig = linha(acervo, 'ORIG2');
    const antes = linha(acervo, 'RESP8');
    assert.equal(antes.citada_id, orig.id);
    assert.equal(antes.citada_autor_id, idDe(acervo, TEL_DE_OUTRO));
    assert.equal(antes.citada_direcao, 'recebida');

    receberEvento(acervo, [evento, original('ORIG2', QUANDO - 10)], COM_CONTA);
    assert.deepEqual(linha(acervo, 'RESP8'), antes);
    assert.equal(contar(acervo, 'mensagens'), 2);
  } finally {
    c.limpar();
  }
});

test('a Mensagem que a propria conta envia citando outra tambem grava a Citacao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    receberEvento(acervo, [original('ORIG3')], COM_CONTA);
    const enviada: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'ENV1', fromMe: true },
      messageTimestamp: QUANDO + 9,
      message: { extendedTextMessage: { text: 'de volta', contextInfo: { stanzaId: 'ORIG3', participant: LID_DE_OUTRO } } },
    };
    receberEvento(acervo, [enviada], COM_CONTA);
    assert.equal(linha(acervo, 'ENV1').citada_id, linha(acervo, 'ORIG3').id);
  } finally {
    c.limpar();
  }
});

test('a citada que o Acervo tem fala por si: o participant que ele nao conhece NAO vira Identificador', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
    receberEvento(acervo, [original('ORIG4')], COM_CONTA);
    const SEM_CORRESPONDENCIA = '107777777777777@lid';
    receberEvento(acervo, [resposta('RESP9', { stanzaId: 'ORIG4', participant: SEM_CORRESPONDENCIA })], COM_CONTA);
    assert.equal(idDe(acervo, SEM_CORRESPONDENCIA), undefined, 'o participant de uma citada que o Acervo tem virou Identificador orfao');
    assert.equal(linha(acervo, 'RESP9').citada_autor_id, idDe(acervo, TEL_DE_OUTRO), 'o autor e o da citada que o Acervo tem');
  } finally {
    c.limpar();
  }
});

test('reentregar o evento nao cria Identificador a toa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const DESCONHECIDO = '106666666666666@lid';
    const evento = resposta('RESP10', { stanzaId: 'ANTIGA', participant: DESCONHECIDO });
    receberEvento(acervo, [evento], COM_CONTA);
    // A correspondencia so e aprendida DEPOIS da primeira entrega: se a reentrega relesse a Citacao, resolveria o participant
    // para o endereco canonico e criaria um Identificador novo para uma Mensagem que ja estava gravada.
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: DESCONHECIDO, canonico: '5565911110077@s.whatsapp.net' });
    const antes = contar(acervo, 'identificadores');
    receberEvento(acervo, [evento], COM_CONTA);
    assert.equal(contar(acervo, 'identificadores'), antes);
  } finally {
    c.limpar();
  }
});

test('o participant @broadcast (resposta a status) grava so o id externo: nenhum autor', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    receberEvento(acervo, [resposta('RESP11', { stanzaId: 'STATUS1', participant: 'status@broadcast' })], COM_CONTA);
    const r = linha(acervo, 'RESP11');
    assert.equal(r.citada_id_externo, 'STATUS1');
    assert.equal(r.citada_autor_id, null);
    assert.equal(r.citada_direcao, null);
    assert.equal(idDe(acervo, 'status@broadcast'), undefined);
  } finally {
    c.limpar();
  }
});
