import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { conversasMarcadas } from '../src/nucleo/marca-do-titular.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { processarEstadoDeConversa } from '../src/adaptadores/whatsapp/estado-ao-vivo.js';

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';
const LID = '109876543210987@lid';
const QUANDO = Date.parse('2026-09-02T12:00:00Z');
const FIXADA_EM = 1789506000000;

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

const pares = (acervo: Acervo): Array<{ alternativo: string; canonico: string }> =>
  acervo.db
    .prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo')
    .all() as Array<{ alternativo: string; canonico: string }>;

const nomesDoCelular = (acervo: Acervo): number =>
  contar(
    acervo,
    'SELECT COUNT(*) AS n FROM atribuicoes_de_nome a JOIN identificadores i ON i.id = a.identificador_id WHERE i.valor IN (?, ?)',
    SEM_NOVE,
    COM_NOVE,
  );

const identificadoresDoCelular = (acervo: Acervo): number =>
  contar(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor IN (?, ?)', SEM_NOVE, COM_NOVE);

test('contacts.upsert com o JID na forma alternativa: o par LID aponta para a gravada e o nome vai para o Identificador existente', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    processarEstadoDeConversa(acervo, {
      fluxo: 'contacts.upsert',
      dado: [{ id: LID, jid: COM_NOVE, lid: LID, name: 'Nome Sintetico' }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });

    assert.deepEqual(pares(acervo), [
      { alternativo: LID, canonico: SEM_NOVE },
      { alternativo: COM_NOVE, canonico: SEM_NOVE },
    ]);
    assert.equal(identificadoresDoCelular(acervo), 1);
    assert.equal(nomesDoCelular(acervo), 1, 'o nome ficou no Identificador gravado');
  });
});

test('contacts.upsert so com o JID (sem LID), na forma alternativa de um Identificador gravado: o nome vai para o existente', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    processarEstadoDeConversa(acervo, {
      fluxo: 'contacts.upsert',
      dado: [{ id: COM_NOVE, name: 'Nome Sintetico' }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });

    assert.equal(identificadoresDoCelular(acervo), 1);
    assert.equal(nomesDoCelular(acervo), 1);
  });
});

test('chats.update na forma alternativa de uma Conversa ja gravada, sem par aprendido, marca a Conversa existente', () => {
  comAcervo((acervo) => {
    const conversa = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: SEM_NOVE,
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const r = processarEstadoDeConversa(acervo, {
      fluxo: 'chats.update',
      dado: [{ id: COM_NOVE, pinned: FIXADA_EM, archived: false }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });

    assert.equal(r.opacosPulados, 0);
    assert.deepEqual(conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }), [conversa]);
  });
});

test('chats.update de numeros SEM Conversa nao abre Operacao nem aprende par (a decisao so le)', () => {
  comAcervo((acervo) => {
    const dado = Array.from({ length: 30 }, (_x, i) => ({
      id: `55659${String(1_000_000 + i).padStart(7, '0')}@s.whatsapp.net`,
      pinned: FIXADA_EM,
      archived: false,
    }));
    const antes = listarOperacoesCruas(acervo).length;
    const r = processarEstadoDeConversa(acervo, {
      fluxo: 'chats.update',
      dado,
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.equal(r.opacosPulados, 30);
    assert.deepEqual(pares(acervo), []);
    assert.equal(listarOperacoesCruas(acervo).length - antes <= 1, true, 'no maximo a Operacao do retrato, nenhuma por numero');
  });
});

test('contacts.upsert com N contatos novos abre UM envelope de aprendizado, nao um por contato', () => {
  comAcervo((acervo) => {
    const dado = Array.from({ length: 30 }, (_x, i) => ({
      id: `55659${String(1_000_000 + i).padStart(7, '0')}@s.whatsapp.net`,
      name: `Nome Sintetico ${i}`,
    }));
    processarEstadoDeConversa(acervo, {
      fluxo: 'contacts.upsert',
      dado,
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.equal(contar(acervo, "SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'aprender-endereco-ao-vivo'"), 1);
    assert.equal(pares(acervo).length, 30);
  });
});

test('chats.update por LID: a Conversa gravada na outra forma do celular canonico do par tambem e marcada', () => {
  comAcervo((acervo) => {
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE });
    const conversa = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: COM_NOVE, coletiva: false, configuracao: CFG_WHATSAPP });
    const r = processarEstadoDeConversa(acervo, {
      fluxo: 'chats.update',
      dado: [{ id: LID, pinned: FIXADA_EM, archived: false }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.equal(r.opacosPulados, 0);
    assert.deepEqual(conversasMarcadas(acervo, { marca: 'fixada', configuracaoId: CFG_WHATSAPP.id }), [conversa]);
  });
});

test('o mesmo contacts.upsert de novo nao abre outro envelope: so se abre quando ha par a aprender', () => {
  comAcervo((acervo) => {
    const dado = Array.from({ length: 30 }, (_x, i) => ({
      id: `55659${String(1_000_000 + i).padStart(7, '0')}@s.whatsapp.net`,
      name: `Nome Sintetico ${i}`,
    }));
    const evento = { fluxo: 'contacts.upsert', dado, configuracaoId: CFG_WHATSAPP.id, observadaEm: QUANDO };
    processarEstadoDeConversa(acervo, evento);
    processarEstadoDeConversa(acervo, evento);
    assert.equal(contar(acervo, "SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'aprender-endereco-ao-vivo'"), 1);
  });
});

test('o contato cujo nome repete o numero nao ganha Identificador nem aprende par', () => {
  comAcervo((acervo) => {
    processarEstadoDeConversa(acervo, {
      fluxo: 'contacts.upsert',
      dado: [{ id: COM_NOVE, name: '5565999991234' }],
      configuracaoId: CFG_WHATSAPP.id,
      observadaEm: QUANDO,
    });
    assert.deepEqual(pares(acervo), []);
    assert.equal(identificadoresDoCelular(acervo), 0);
    assert.equal(contar(acervo, "SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'aprender-endereco-ao-vivo'"), 0);
  });
});
