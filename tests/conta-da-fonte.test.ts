import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { listarConversas } from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const DOMINIO_BUSINESS = 'AppDomainGroup-group.net.whatsapp.WhatsAppSMB.shared';

/**
 * Um backup, duas contas — que é o que o backup real do aparelho faz. Testar
 * com dois backups de um domínio cada exercitaria o mapa conta->domínio, não
 * o critério, que fala em "um backup que contenha as duas contas".
 */
function backupDeDuasContas(): { raiz: string; limpar: () => void } {
  return backupFalso({
    conversas: [{ pk: 1, endereco: '5511000000001@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      {
        stanzaId: 'p1',
        chatSessionPk: 1,
        texto: 'da conta pessoal',
        dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z'),
      },
    ],
    contas: [
      {
        dominio: DOMINIO_BUSINESS,
        conversas: [
          { pk: 1, endereco: '5511000000002@s.whatsapp.net', nome: 'Bea', tipoDeSessao: 0 },
        ],
        mensagens: [
          {
            stanzaId: 'b1',
            chatSessionPk: 1,
            texto: 'da conta business',
            dataCoreData: paraCoreData('2026-01-11T12:00:00.000Z'),
          },
        ],
      },
    ],
  });
}

test('as duas contas do mesmo backup entram, cada uma pela sua', () => {
  const c = cenario();
  const b = backupDeDuasContas();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    const pessoal = importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, conta: 'pessoal' });
    const business = importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, conta: 'business' });

    assert.equal(pessoal.conversasCriadas, 1);
    assert.equal(business.conversasCriadas, 1, 'a business traz Conversa que a pessoal nao viu');

    const conversas = listarConversas(acervo, {});
    assert.equal(conversas.length, 2, 'as duas contas do MESMO backup entram');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('sem conta declarada, lê a pessoal — e não a business', () => {
  const c = cenario();
  const b = backupDeDuasContas();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP });
    assert.equal(listarConversas(acervo, {}).length, 1, 'so a conta pessoal');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('conta desconhecida é recusada, e a recusa diz quais existem', () => {
  const c = cenario();
  const b = backupDeDuasContas();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    assert.throws(
      () => importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, conta: 'inexistente' }),
      /Conta desconhecida para a Fonte whatsapp: inexistente/,
    );
  } finally {
    b.limpar();
    c.limpar();
  }
});
