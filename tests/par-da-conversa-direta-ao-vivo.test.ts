import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { receberEvento, type ChaveRecebida, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';

/**
 * O par da Conversa DIRETA aprendido ao vivo (#1439): a Mensagem RECEBIDA de Conversa por endereco opaco traz o telefone
 * do companheiro (`senderPn`), e a recepcao grava o par (o opaco como alternativo, o telefone JA RESOLVIDO como canonico)
 * antes de qualquer escrita de endereco do lote. Tudo sintetico: os numeros e os enderecos opacos sao ficticios.
 */

const AGORA = Date.parse('2026-11-08T12:00:00Z');
const QUANDO = Math.floor(AGORA / 1000);
const OPCOES = { origemDaChegada: 'ao-vivo' as const, agora: AGORA, configuracao: CFG_WHATSAPP };
const OPACO = '200000000000001@lid';
const OUTRO_OPACO = '200000000000002@lid';
const COM_NOVE = '5565988887777@s.whatsapp.net';
const SEM_NOVE = '556588887777@s.whatsapp.net';
const FIXO = '556533334444@s.whatsapp.net';
const DE_OUTRO_PAIS = '14155550100@s.whatsapp.net';
const DA_PROPRIA_CONTA = '5565911110000@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

function evento(id: string, chave: Partial<ChaveRecebida> = {}): MensagemRecebida {
  return {
    key: { remoteJid: OPACO, id, fromMe: false, ...chave },
    messageTimestamp: QUANDO,
    pushName: 'Contato de Teste',
    message: { conversation: 'texto sintetico' },
  };
}

const contar = (acervo: Acervo, sql: string, ...args: string[]): number =>
  (acervo.db.prepare(sql).get(...args) as { n: number }).n;

const pares = (acervo: Acervo): Array<{ alternativo: string; canonico: string }> =>
  acervo.db
    .prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo')
    .all() as Array<{ alternativo: string; canonico: string }>;

const conversa = (acervo: Acervo, idExterno: string): { id: string; bruto: string | null } | undefined =>
  acervo.db.prepare('SELECT id, bruto FROM conversas WHERE id_externo = ?').get(idExterno) as
    | { id: string; bruto: string | null }
    | undefined;

const mensagensNaConversa = (acervo: Acervo, idExterno: string): number =>
  contar(
    acervo,
    'SELECT COUNT(*) AS n FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE c.id_externo = ?',
    idExterno,
  );

test('a direta recebida com o campo grava o par: o opaco aponta para o telefone, e o celular ganha o par das duas formas', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE })], OPCOES);

    assert.deepEqual(pares(acervo), [
      { alternativo: OPACO, canonico: COM_NOVE },
      { alternativo: SEM_NOVE, canonico: COM_NOVE },
    ]);
    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 1);
    assert.equal(conversa(acervo, OPACO), undefined, 'o opaco nao vira Conversa quando o par chega no proprio evento');
  });
});

test('o canonico e o telefone JA RESOLVIDO: com a outra forma gravada como Identificador, o par aponta para ela', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE })], OPCOES);

    assert.deepEqual(pares(acervo), [
      { alternativo: OPACO, canonico: SEM_NOVE },
      { alternativo: COM_NOVE, canonico: SEM_NOVE },
    ]);
    assert.equal(mensagensNaConversa(acervo, SEM_NOVE), 1);
  });
});

test('o telefone sem o nono digito, sem nada gravado: o canonico e a forma que chegou', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1', { senderPn: SEM_NOVE })], OPCOES);

    assert.deepEqual(pares(acervo), [
      { alternativo: OPACO, canonico: SEM_NOVE },
      { alternativo: COM_NOVE, canonico: SEM_NOVE },
    ]);
  });
});

test('fixo e numero de outro pais: so o par do opaco, sem par de celular', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1', { senderPn: FIXO }), evento('M2', { remoteJid: OUTRO_OPACO, senderPn: DE_OUTRO_PAIS })], OPCOES);

    assert.deepEqual(pares(acervo), [
      { alternativo: OPACO, canonico: FIXO },
      { alternativo: OUTRO_OPACO, canonico: DE_OUTRO_PAIS },
    ]);
  });
});

test('o telefone com as duas formas gravadas como Identificador: o par do opaco aponta para a que chegou, e o celular fica sem par', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: COM_NOVE });
    receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE })], OPCOES);

    assert.deepEqual(pares(acervo), [{ alternativo: OPACO, canonico: COM_NOVE }]);
  });
});

test('a Mensagem ENVIADA nunca aprende, ainda que traga o campo: o telefone da propria conta apontaria o contato para o Titular', () => {
  comAcervo((acervo) => {
    const enviada = evento('M1', { fromMe: true, senderPn: DA_PROPRIA_CONTA });
    receberEvento(acervo, [enviada], OPCOES);

    assert.deepEqual(pares(acervo), []);
    assert.equal(mensagensNaConversa(acervo, OPACO), 1, 'a enviada fica na Conversa opaca');
  });
});

test('sem o campo, ou com o campo vazio, nao ha par', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1'), evento('M2', { remoteJid: OUTRO_OPACO, senderPn: '' })], OPCOES);

    assert.deepEqual(pares(acervo), []);
    assert.equal(mensagensNaConversa(acervo, OPACO), 1);
    assert.equal(mensagensNaConversa(acervo, OUTRO_OPACO), 1);
  });
});

test('so o telefone inteiro vira par: com sufixo de aparelho, sem numero ou vazio, nada, e a Mensagem fica na Conversa opaca', () => {
  comAcervo((acervo) => {
    const formasRecusadas = ['5565988887777:12@s.whatsapp.net', '@s.whatsapp.net', ''];
    receberEvento(
      acervo,
      formasRecusadas.map((senderPn, i) => evento(`M${String(i)}`, { senderPn })),
      OPCOES,
    );

    assert.deepEqual(pares(acervo), []);
    assert.equal(mensagensNaConversa(acervo, OPACO), 3);
    assert.equal(contar(acervo, "SELECT COUNT(*) AS n FROM identificadores WHERE valor LIKE '%:%'"), 0, 'nenhum Identificador de aparelho');
  });
});

test('o evento que nao se decifra e traz o campo ENSINA o par (a chave e montada antes da decifra), sem gravar Mensagem', () => {
  comAcervo((acervo) => {
    const cifrado: MensagemRecebida = {
      key: { remoteJid: OPACO, id: 'C1', fromMe: false, senderPn: COM_NOVE },
      messageTimestamp: QUANDO,
      messageStubType: 'CIPHERTEXT',
    };
    const r = receberEvento(acervo, [cifrado], OPCOES);

    assert.equal(r.ignorados['cifrada'], 1);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM mensagens'), 0);
    assert.deepEqual(pares(acervo), [
      { alternativo: OPACO, canonico: COM_NOVE },
      { alternativo: SEM_NOVE, canonico: COM_NOVE },
    ]);

    receberEvento(acervo, [evento('M1')], OPCOES);
    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 1, 'a Mensagem seguinte, sem o campo, ja vai para o telefone');
  });
});

test('a Conversa coletiva continua como hoje: o par vem do autor, e o campo da direta numa coletiva nao ensina nada', () => {
  comAcervo((acervo) => {
    const doGrupo = evento('G1', { remoteJid: GRUPO, participant: OUTRO_OPACO, participantPn: COM_NOVE, senderPn: FIXO });
    receberEvento(acervo, [doGrupo], OPCOES);

    assert.deepEqual(pares(acervo), [
      { alternativo: OUTRO_OPACO, canonico: COM_NOVE },
      { alternativo: SEM_NOVE, canonico: COM_NOVE },
    ]);
    assert.equal(mensagensNaConversa(acervo, GRUPO), 1);
  });
});

test('o contador da direta nao muda: conta o evento que trouxe o campo, aprendido ou nao', () => {
  comAcervo((acervo) => {
    const r = receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE }), evento('M2', { remoteJid: OUTRO_OPACO })], OPCOES);

    assert.deepEqual(r.correspondencia, { coletivaOpaca: 0, coletivaComPar: 0, diretaOpaca: 2, diretaComPar: 1 });
  });
});

test('o Diario de Chegadas nao ganha linha pelo par: so a Mensagem, com a origem do lote', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE })], OPCOES);

    assert.equal(contar(acervo, "SELECT COUNT(*) AS n FROM chegadas WHERE tipo != 'inicio-do-diario'"), 1);
    const c = conversa(acervo, COM_NOVE);
    assert.ok(c !== undefined);
    assert.equal(
      contar(acervo, "SELECT COUNT(*) AS n FROM chegadas WHERE tipo = 'mensagem' AND origem = 'ao-vivo' AND conversa_id = ?", c.id),
      1,
    );
  });
});

// O CORTE (criterio 7), fixado como COMPORTAMENTO ESPERADO: unir as duas Conversas do contato e a #1440.

test('corte: a partir do evento que traz o campo, inclusive ele, a Mensagem vai para a Conversa por telefone e a opaca congela', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1')], OPCOES);
    const opacaAntes = conversa(acervo, OPACO);
    assert.ok(opacaAntes !== undefined);

    receberEvento(acervo, [evento('M2', { senderPn: COM_NOVE })], OPCOES);
    receberEvento(acervo, [evento('M3')], OPCOES);

    assert.equal(mensagensNaConversa(acervo, OPACO), 1, 'a Conversa opaca deixa de receber');
    assert.deepEqual(conversa(acervo, OPACO), opacaAntes, 'o bruto da Conversa opaca nao e reescrito pelo evento');
    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 2, 'o evento do campo e o seguinte vao para a Conversa nova');
    const porTelefone = conversa(acervo, COM_NOVE);
    assert.ok(porTelefone !== undefined);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor = ?', COM_NOVE), 1);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM participacoes WHERE conversa_id = ?', porTelefone.id), 1);
    assert.equal(contar(acervo, "SELECT COUNT(*) AS n FROM chegadas WHERE tipo = 'mensagem' AND conversa_id = ?", porTelefone.id), 2);
  });
});

test('corte: a Mensagem ENVIADA depois do par tambem vai para a Conversa por telefone', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE })], OPCOES);
    receberEvento(acervo, [evento('M2', { fromMe: true })], OPCOES);

    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 2);
    assert.equal(conversa(acervo, OPACO), undefined);
  });
});

test('corte: com a Conversa por telefone ja existente, a Mensagem do evento do campo entra nela', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: COM_NOVE });
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno: COM_NOVE, coletiva: false, configuracao: CFG_WHATSAPP });

    receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE })], OPCOES);

    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM conversas WHERE coletiva = 0'), 1);
    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 1);
  });
});

test('corte: par e Mensagem no MESMO lote, o evento sem o campo que vem antes tambem vai para o telefone', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1'), evento('M2', { senderPn: COM_NOVE })], OPCOES);

    assert.equal(conversa(acervo, OPACO), undefined);
    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 2);
  });
});

test('corte: a reentrega de evento antigo depois do par nao cria Mensagem, mas cria a Conversa por telefone VAZIA', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1')], OPCOES);
    // O par aprendido por outro caminho (agenda ou coletiva), antes da reentrega do mesmo evento.
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: COM_NOVE });

    receberEvento(acervo, [evento('M1')], OPCOES);

    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM mensagens'), 1, 'idempotente por id externo');
    assert.equal(mensagensNaConversa(acervo, OPACO), 1);
    const vazia = conversa(acervo, COM_NOVE);
    assert.ok(vazia !== undefined, 'a Conversa por telefone nasce na reentrega');
    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 0);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor = ?', COM_NOVE), 1);
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM participacoes WHERE conversa_id = ?', vazia.id), 1);
  });
});
