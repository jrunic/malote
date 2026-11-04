import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { receberEvento, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { mudancaDeEtiqueta } from './ajuda/etiqueta-ao-vivo.js';

const AGORA = Date.parse('2026-09-02T12:00:00Z');
const QUANDO = Math.floor(AGORA / 1000);
const OPCOES = { origemDaChegada: 'ao-vivo' as const, agora: AGORA, configuracao: CFG_WHATSAPP };
const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';
const LID = '109876543210987@lid';

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

const contar = (acervo: Acervo, sql: string, ...args: string[]): number =>
  (acervo.db.prepare(sql).get(...args) as { n: number }).n;

/** Quantos Identificadores de WhatsApp o MESMO celular tem, nas duas formas. */
const identificadoresDoCelular = (acervo: Acervo): number =>
  contar(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor IN (?, ?)', SEM_NOVE, COM_NOVE);

const pares = (acervo: Acervo): Array<{ alternativo: string; canonico: string }> =>
  acervo.db
    .prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo')
    .all() as Array<{ alternativo: string; canonico: string }>;

/** Estado de um Acervo que ja tinha o celular gravado na forma SEM_NOVE e nenhum par aprendido (o estoque de hoje). */
function celularJaGravado(acervo: Acervo): string {
  return registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE }).id;
}

function direta(id: string, remoteJid: string): MensagemRecebida {
  return { key: { remoteJid, id, fromMe: false }, messageTimestamp: QUANDO, pushName: 'Teste', message: { conversation: 'texto' } };
}

test('o mesmo celular chegando nas duas formas e UMA Conversa e UM Identificador, e o Diario nao ganha Chegada de correspondencia', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [direta('AAAA1111BBBB2222CCCC', COM_NOVE)], OPCOES);
    receberEvento(acervo, [direta('DDDD3333EEEE4444FFFF', SEM_NOVE)], OPCOES);

    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM conversas WHERE coletiva = 0'), 1);
    assert.equal(identificadoresDoCelular(acervo), 1);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM mensagens'), 2);
    assert.deepEqual(pares(acervo), [{ alternativo: SEM_NOVE, canonico: COM_NOVE }]);
    // Aprender correspondencia nao e Chegada: o Diario so tem as duas Mensagens (alem da semente).
    assert.equal(contar(acervo, "SELECT COUNT(*) AS n FROM chegadas WHERE tipo != 'inicio-do-diario'"), 2);
    assert.equal(contar(acervo, "SELECT COUNT(*) AS n FROM chegadas WHERE tipo = 'mensagem'"), 2);
  });
});

test('Conversa direta ja gravada na outra forma, sem par aprendido: a Mensagem nova entra nela', () => {
  comAcervo((acervo) => {
    celularJaGravado(acervo);
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: SEM_NOVE, coletiva: false, configuracao: CFG_WHATSAPP });

    receberEvento(acervo, [direta('AAAA1111BBBB2222CCCC', COM_NOVE)], OPCOES);

    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM conversas WHERE coletiva = 0'), 1);
    assert.equal(identificadoresDoCelular(acervo), 1);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM mensagens'), 1);
  });
});

test('o autor de uma Mensagem de grupo, na forma alternativa de um Identificador ja gravado, e o mesmo Identificador', () => {
  comAcervo((acervo) => {
    const existente = celularJaGravado(acervo);
    const doGrupo: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'GGGG5555HHHH6666IIII', fromMe: false, participant: COM_NOVE },
      messageTimestamp: QUANDO,
      pushName: 'Outro',
      message: { conversation: 'no grupo' },
    };
    receberEvento(acervo, [doGrupo], OPCOES);

    assert.equal(identificadoresDoCelular(acervo), 1);
    const autor = acervo.db.prepare('SELECT autor_id AS a FROM mensagens').get() as { a: string };
    assert.equal(autor.a, existente);
  });
});

test('participantPn na forma alternativa de um Identificador gravado: o par LID aponta para a gravada, sem cadeia', () => {
  comAcervo((acervo) => {
    celularJaGravado(acervo);
    const doGrupo: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'GGGG5555HHHH6666IIII', fromMe: false, participant: LID, participantPn: COM_NOVE },
      messageTimestamp: QUANDO,
      pushName: 'Outro',
      message: { conversation: 'no grupo' },
    };
    receberEvento(acervo, [doGrupo], OPCOES);

    const todos = pares(acervo);
    assert.deepEqual(todos, [
      { alternativo: LID, canonico: SEM_NOVE },
      { alternativo: COM_NOVE, canonico: SEM_NOVE },
    ]);
    const alternativos = new Set(todos.map((p) => p.alternativo));
    assert.equal(todos.filter((p) => alternativos.has(p.canonico)).length, 0, 'nenhum canonico pode ser alternativo');
    assert.equal(identificadoresDoCelular(acervo), 1);
  });
});

test('o membro de uma Transicao por stub, na forma alternativa de um Identificador ja gravado, e o mesmo Identificador', () => {
  comAcervo((acervo) => {
    celularJaGravado(acervo);
    const entrou: MensagemRecebida = {
      key: { remoteJid: GRUPO, id: 'STUB7777', fromMe: false, participant: '111@lid' },
      messageTimestamp: QUANDO,
      messageStubType: 27,
      messageStubParameters: [COM_NOVE],
    };
    receberEvento(acervo, [entrou], OPCOES);

    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM transicoes_de_participacao'), 1);
    assert.equal(identificadoresDoCelular(acervo), 1);
  });
});

test('a Etiqueta de um membro, na forma alternativa de um Identificador ja gravado, e do mesmo Identificador', () => {
  comAcervo((acervo) => {
    celularJaGravado(acervo);
    receberEvento(acervo, [mudancaDeEtiqueta({ id: 'ETIQ8888', texto: 'Lider', autor: COM_NOVE, messageTimestamp: QUANDO })], OPCOES);

    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM etiquetas_de_participacao'), 1);
    assert.equal(identificadoresDoCelular(acervo), 1);
  });
});

test('a Etiqueta de um membro nunca visto aprende o par: a outra forma, depois, e o mesmo Identificador', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [mudancaDeEtiqueta({ id: 'ETIQ8888', texto: 'Lider', autor: COM_NOVE, messageTimestamp: QUANDO })], OPCOES);
    assert.deepEqual(pares(acervo), [{ alternativo: SEM_NOVE, canonico: COM_NOVE }]);

    receberEvento(acervo, [direta('AAAA1111BBBB2222CCCC', SEM_NOVE)], OPCOES);
    assert.equal(identificadoresDoCelular(acervo), 1);
  });
});

test('o eco de uma Mensagem enviada (fromMe) para a forma errada de um numero desconhecido NAO vira a canonica', () => {
  comAcervo((acervo) => {
    const eco: MensagemRecebida = {
      key: { remoteJid: COM_NOVE, id: 'ECO9999', fromMe: true },
      messageTimestamp: QUANDO,
      message: { conversation: 'enviada' },
    };
    receberEvento(acervo, [eco], OPCOES);
    assert.deepEqual(pares(acervo), [], 'a forma que o operador digitou nao e evidencia da plataforma');

    // A resposta chega pela forma REAL da plataforma: e ela que fica com o Identificador, e o par aponta para ela.
    receberEvento(acervo, [direta('RESP1111', SEM_NOVE)], OPCOES);
    assert.deepEqual(pares(acervo), [{ alternativo: COM_NOVE, canonico: SEM_NOVE }]);
    const ids = acervo.db
      .prepare('SELECT valor FROM identificadores WHERE valor IN (?, ?)')
      .all(SEM_NOVE, COM_NOVE) as Array<{ valor: string }>;
    assert.deepEqual(ids.map((l) => l.valor), [SEM_NOVE]);
    // Escolha declarada: a Conversa do eco ficou na forma digitada e a da resposta nasce na forma real. Sao duas Conversas
    // diretas do mesmo celular (como ja era antes do plano); unir as duas e trabalho do estoque, nao da recepcao.
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM conversas WHERE coletiva = 0'), 2);
  });
});

test('a Etiqueta de um membro novo aprende DENTRO da Operacao do evento, sem envelope proprio (a decisao so le)', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [mudancaDeEtiqueta({ id: 'ETIQ8888', texto: 'Lider', autor: COM_NOVE, messageTimestamp: QUANDO })], OPCOES);
    const envelopes = contar(acervo, "SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'aprender-endereco-ao-vivo'");
    assert.equal(envelopes, 0);
    assert.equal(pares(acervo).length, 1, 'o par foi aprendido mesmo assim, na Operacao do evento');
  });
});

test('a Edicao que chega na outra forma do celular grava, porque a Conversa do original ja tem o par', () => {
  comAcervo((acervo) => {
    const agora = 1_791_300_000_000;
    const editadaEm = agora - 299_877;
    const opcoes = { origemDaChegada: 'ao-vivo' as const, agora, configuracao: CFG_WHATSAPP };
    const original: MensagemRecebida = {
      key: { remoteJid: COM_NOVE, id: 'ORIG-1', fromMe: false },
      messageTimestamp: Math.floor((agora - 600_000) / 1000),
      message: { conversation: 'texto original' },
    };
    const edicao: MensagemRecebida = {
      key: { remoteJid: SEM_NOVE, id: 'EV-1', fromMe: false },
      messageTimestamp: Math.floor(editadaEm / 1000),
      message: {
        protocolMessage: {
          type: 'MESSAGE_EDIT',
          key: { remoteJid: SEM_NOVE, fromMe: false, id: 'ORIG-1' },
          editedMessage: { conversation: 'texto corrigido' },
          timestampMs: editadaEm,
        },
      },
    };
    receberEvento(acervo, [original], opcoes);
    const r = receberEvento(acervo, [edicao], opcoes);

    assert.equal(r.edicoes, 1);
    assert.deepEqual(r.descartados, []);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM edicoes'), 1);
  });
});
