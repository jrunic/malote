import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { listarConversas } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

/**
 * Os números são assimétricos de propósito: 2 já existentes contra 1 nova.
 * Com 1 e 1, trocar os dois contadores por engano passaria verde — é a mesma
 * armadilha do a=30/b=20 que o ciclo 3 pagou.
 */
test('a reimportação com sobreposição conta criado e existente por grandeza', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    const primeiro = backupFalso({
      conversas: [
        { pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 },
        { pk: 2, endereco: 'b@s.whatsapp.net', nome: 'Bea', tipoDeSessao: 0 },
      ],
      mensagens: [
        {
          stanzaId: 'a1',
          chatSessionPk: 1,
          texto: 'um',
          dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
          caminhoDeMidia: 'Media/a1.jpg',
        },
        {
          stanzaId: 'a2',
          chatSessionPk: 1,
          texto: 'dois',
          dataCoreData: paraCoreData('2026-01-10T12:01:00.000Z'),
        },
        {
          stanzaId: 'b1',
          chatSessionPk: 2,
          texto: 'tres',
          dataCoreData: paraCoreData('2026-01-10T13:00:00.000Z'),
        },
      ],
    });
    const r1 = importarMaterial(acervo, primeiro.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, reprocessar: true });
    assert.equal(r1.conversasCriadas, 2);
    assert.equal(r1.conversasJaExistentes, 0);
    assert.equal(r1.mensagensCriadas, 3);
    assert.equal(r1.anexosCriados, 1);
    primeiro.limpar();

    const segundo = backupFalso({
      conversas: [
        { pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 },
        { pk: 2, endereco: 'b@s.whatsapp.net', nome: 'Bea', tipoDeSessao: 0 },
        { pk: 3, endereco: 'c@s.whatsapp.net', nome: 'Cid', tipoDeSessao: 0 },
      ],
      mensagens: [
        {
          stanzaId: 'a1',
          chatSessionPk: 1,
          texto: 'um',
          dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
          caminhoDeMidia: 'Media/a1.jpg',
        },
        {
          stanzaId: 'a3',
          chatSessionPk: 1,
          texto: 'cinco',
          dataCoreData: paraCoreData('2026-01-11T12:00:00.000Z'),
        },
        {
          stanzaId: 'c1',
          chatSessionPk: 3,
          texto: 'quatro',
          dataCoreData: paraCoreData('2026-01-12T12:00:00.000Z'),
          caminhoDeMidia: 'Media/c1.mp4',
        },
      ],
    });
    const r2 = importarMaterial(acervo, segundo.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(r2.conversasCriadas, 1, 'só a Conversa de Cid é nova');
    assert.equal(r2.conversasJaExistentes, 2, 'as de Ana e Bea já estavam lá');
    assert.equal(r2.mensagensCriadas, 2, 'a3 e c1');
    assert.equal(r2.mensagensJaExistentes, 1, 'a1');
    assert.ok(r2.participacoesJaExistentes > 0, 'a Participação de Ana foi reobservada');
    assert.equal(r2.anexosCriados, 1, 'o anexo de c1 é novo');
    assert.equal(r2.anexosJaExistentes, 1, 'o anexo de a1 já estava lá');
    segundo.limpar();

    // O critério 1 fixa o método: conferir no ACERVO, não na saída do comando.
    assert.equal(listarConversas(acervo, {}).length, 3, 'Ana, Bea e Cid — a união');
    const total = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
    assert.equal(total.n, 5, 'a1 a2 b1 a3 c1, sem duplicata');
    const distintas = acervo.db
      .prepare("SELECT COUNT(DISTINCT fonte || '|' || id_externo) AS n FROM mensagens")
      .get() as { n: number };
    assert.equal(distintas.n, total.n, 'nenhuma Referência Externa repetida');
  } finally {
    c.limpar();
  }
});

test('reimportar o mesmo material não cria nada e diz isso', () => {
  const c = cenario();
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'a1',
        chatSessionPk: 1,
        texto: 'um',
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
      },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, reprocessar: true });
    const r = importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(r.conversasCriadas, 0);
    assert.equal(r.conversasJaExistentes, 1);
    assert.equal(r.mensagensCriadas, 0);
    assert.equal(r.mensagensJaExistentes, 1);
  } finally {
    b.limpar();
    c.limpar();
  }
});
