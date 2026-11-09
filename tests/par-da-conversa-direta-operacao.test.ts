import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { receberEvento, type ChaveRecebida, type MensagemRecebida } from '../src/adaptadores/whatsapp/ao-vivo.js';

/**
 * O aprendizado da Conversa direta so abre Operacao com par NOVO (#1439, criterio 1), e o conflito e contado, nunca
 * Operacao (criterio 3). O motivo e medido: sem o pre-filtro, o aprendizado da coletiva abriu 21.655 Operacoes em 7 dias
 * para cerca de 126 pares, uma por evento. O pre-filtro e o do aprendizado da agenda (`estado-ao-vivo.ts`).
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
    message: { conversation: 'texto sintetico' },
  };
}

const contar = (acervo: Acervo, sql: string, ...args: string[]): number =>
  (acervo.db.prepare(sql).get(...args) as { n: number }).n;

const aprendizados = (acervo: Acervo): number =>
  contar(acervo, "SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'aprender-endereco-ao-vivo'");

const pares = (acervo: Acervo): Array<{ alternativo: string; canonico: string }> =>
  acervo.db
    .prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo')
    .all() as Array<{ alternativo: string; canonico: string }>;

const mensagensNaConversa = (acervo: Acervo, idExterno: string): number =>
  contar(
    acervo,
    'SELECT COUNT(*) AS n FROM mensagens m JOIN conversas c ON c.id = m.conversa_id WHERE c.id_externo = ?',
    idExterno,
  );

test('dois eventos iguais: UMA Operacao de aprendizado no primeiro e nenhuma no segundo', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE })], OPCOES);
    assert.equal(aprendizados(acervo), 1, 'o par do opaco e o do celular no mesmo envelope');

    const r = receberEvento(acervo, [evento('M2', { senderPn: COM_NOVE })], OPCOES);
    assert.equal(aprendizados(acervo), 1, 'o segundo evento so compara');
    assert.equal(r.conflitosDaDireta, 0);
    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 2);
  });
});

test('um lote com dois contatos novos abre UMA Operacao, nunca uma por contato', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE }), evento('M2', { remoteJid: OUTRO_OPACO, senderPn: '5565977776666@s.whatsapp.net' })], OPCOES);

    assert.equal(aprendizados(acervo), 1);
    assert.equal(pares(acervo).length, 4, 'os dois pares do opaco e os dois do celular');
  });
});

test('o par ja aprendido por outro caminho, sem o par do celular: nenhuma Operacao, nem com a outra forma do numero', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: COM_NOVE });

    const r1 = receberEvento(acervo, [evento('M1', { senderPn: COM_NOVE })], OPCOES);
    const r2 = receberEvento(acervo, [evento('M2', { senderPn: SEM_NOVE })], OPCOES);

    assert.equal(aprendizados(acervo), 0);
    assert.equal(r1.conflitosDaDireta + r2.conflitosDaDireta, 0, 'com e sem o nono digito sao o mesmo numero');
    assert.deepEqual(pares(acervo), [{ alternativo: OPACO, canonico: COM_NOVE }], 'a comparacao so le');
  });
});

test('a direta sem o campo e a enviada com o campo nao abrem Operacao', () => {
  comAcervo((acervo) => {
    receberEvento(acervo, [evento('M1'), evento('M2', { fromMe: true, senderPn: COM_NOVE })], OPCOES);
    assert.equal(aprendizados(acervo), 0);
  });
});

test('conflito entre lotes: o primeiro par fica, nao abre Operacao, conta UM, e a Mensagem entra na Conversa do primeiro', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: COM_NOVE });

    const r = receberEvento(acervo, [evento('M1', { senderPn: FIXO })], OPCOES);

    assert.equal(r.conflitosDaDireta, 1);
    assert.equal(aprendizados(acervo), 0);
    assert.deepEqual(pares(acervo), [{ alternativo: OPACO, canonico: COM_NOVE }]);
    assert.equal(r.gravados, 1);
    assert.equal(mensagensNaConversa(acervo, COM_NOVE), 1);
    assert.deepEqual(r.conflitos, [], 'o conflito da direta e so contagem, sem endereco');
  });
});

test('conflito no MESMO lote: o primeiro telefone fica, o segundo conta, e as duas Mensagens entram', () => {
  comAcervo((acervo) => {
    const r = receberEvento(acervo, [evento('M1', { senderPn: FIXO }), evento('M2', { senderPn: DE_OUTRO_PAIS })], OPCOES);

    assert.equal(r.conflitosDaDireta, 1);
    assert.deepEqual(pares(acervo), [{ alternativo: OPACO, canonico: FIXO }]);
    assert.equal(mensagensNaConversa(acervo, FIXO), 2);
    assert.equal(aprendizados(acervo), 1);
  });
});

test('conflito no mesmo lote com um celular como segundo numero: o par das duas formas DELE fica, e o do opaco e o primeiro', () => {
  comAcervo((acervo) => {
    const r = receberEvento(acervo, [evento('M1', { senderPn: FIXO }), evento('M2', { senderPn: COM_NOVE })], OPCOES);

    assert.equal(r.conflitosDaDireta, 1);
    assert.deepEqual(pares(acervo), [
      { alternativo: OPACO, canonico: FIXO },
      { alternativo: SEM_NOVE, canonico: COM_NOVE },
    ]);
  });
});

test('o conflito conta EVENTOS, nao pares: tres lotes do mesmo contato com outro numero contam tres', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: COM_NOVE });

    let soma = 0;
    for (const id of ['M1', 'M2', 'M3']) soma += receberEvento(acervo, [evento(id, { senderPn: FIXO })], OPCOES).conflitosDaDireta;

    assert.equal(soma, 3);
    assert.equal(aprendizados(acervo), 0);
  });
});

test('o conflito da coletiva continua em `conflitos`, e nao conta como da direta', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OUTRO_OPACO, canonico: FIXO });
    const doGrupo = evento('G1', { remoteJid: GRUPO, participant: OUTRO_OPACO, participantPn: DE_OUTRO_PAIS });

    const r = receberEvento(acervo, [doGrupo], OPCOES);

    assert.equal(r.conflitos.length, 1);
    assert.equal(r.conflitosDaDireta, 0);
  });
});
