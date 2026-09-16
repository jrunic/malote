import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import {
  listarMateriais,
  materialJaEntrou,
  registrarMaterialConcluido,
  ultimoMaterial,
} from '../src/nucleo/sincronizacao.js';

const CFG = 'cfg-1';

test('material desconhecido não entrou', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    assert.equal(materialJaEntrou(acervo, CFG, 'impressao-x'), null);
  } finally {
    c.limpar();
  }
});

test('material registrado é reconhecido, com a data e o que trouxe', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    registrarMaterialConcluido(acervo, {
      configuracaoId: CFG,
      fonte: 'whatsapp',
      impressao: 'impressao-x',
      conversasCriadas: 3,
      mensagensCriadas: 40,
    });
    const achado = materialJaEntrou(acervo, CFG, 'impressao-x');
    assert.ok(achado !== null);
    assert.equal(achado.mensagensCriadas, 40);
    assert.equal(achado.conversasCriadas, 3);
    assert.match(achado.registradoEm, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    c.limpar();
  }
});

test('registrar o mesmo Material duas vezes não duplica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const entrada = {
      configuracaoId: CFG,
      fonte: 'whatsapp' as const,
      impressao: 'impressao-x',
      conversasCriadas: 1,
      mensagensCriadas: 1,
    };
    registrarMaterialConcluido(acervo, entrada);
    registrarMaterialConcluido(acervo, entrada);
    assert.equal(listarMateriais(acervo, CFG).length, 1);
  } finally {
    c.limpar();
  }
});

test('o Estado de Sincronização não atravessa Configuração', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    registrarMaterialConcluido(acervo, {
      configuracaoId: 'cfg-a',
      fonte: 'whatsapp',
      impressao: 'impressao-x',
      conversasCriadas: 1,
      mensagensCriadas: 1,
    });
    assert.equal(materialJaEntrou(acervo, 'cfg-b', 'impressao-x'), null);
    assert.equal(listarMateriais(acervo, 'cfg-b').length, 0);
  } finally {
    c.limpar();
  }
});

test('o último Material é o mais recentemente registrado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    assert.equal(ultimoMaterial(acervo, CFG), null);
    for (const impressao of ['a', 'b', 'c']) {
      registrarMaterialConcluido(acervo, {
        configuracaoId: CFG,
        fonte: 'whatsapp',
        impressao,
        conversasCriadas: 1,
        mensagensCriadas: 1,
      });
    }
    assert.equal(ultimoMaterial(acervo, CFG)?.impressao, 'c');
  } finally {
    c.limpar();
  }
});

function backupDeUmaMensagem(): { raiz: string; limpar: () => void } {
  return backupFalso({
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
}

test('reencontrar Material registrado não percorre o material de novo', () => {
  const c = cenario();
  const b = backupDeUmaMensagem();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const primeira = importarMaterial(acervo, b.raiz, {
      agora: Date.now(),
      configuracao: { id: CFG, fonte: 'whatsapp' as const },
    });
    assert.equal(primeira.jaRegistrado, false);
    assert.equal(primeira.mensagensLidas, 1);

    const segunda = importarMaterial(acervo, b.raiz, {
      agora: Date.now(),
      configuracao: { id: CFG, fonte: 'whatsapp' as const },
    });
    assert.equal(segunda.jaRegistrado, true, 'o material foi reconhecido');
    assert.equal(segunda.mensagensLidas, 0, 'e NAO foi percorrido: nada foi lido');

    const forcada = importarMaterial(acervo, b.raiz, {
      agora: Date.now(),
      configuracao: { id: CFG, fonte: 'whatsapp' as const },
      reprocessar: true,
    });
    assert.equal(forcada.mensagensLidas, 1, 'a bandeira força a passagem completa');
    assert.equal(forcada.mensagensCriadas, 0, 'e continua não duplicando nada');
  } finally {
    b.limpar();
    c.limpar();
  }
});

test('importação interrompida não registra o Material', () => {
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
      {
        stanzaId: 'a2',
        chatSessionPk: 1,
        texto: 'dois',
        dataCoreData: paraCoreData('2026-01-10T12:01:00.000Z'),
      },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    assert.throws(() =>
      importarMaterial(acervo, b.raiz, {
        agora: Date.now(),
        configuracao: { id: CFG, fonte: 'whatsapp' as const },
        falharNoItem: 2,
      }),
    );
    assert.equal(listarMateriais(acervo, CFG).length, 0, 'interrompida não registra');

    const retomada = importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: { id: CFG, fonte: 'whatsapp' as const } });
    assert.equal(retomada.mensagensLidas, 2, 'a execução seguinte processa o material inteiro');
    assert.equal(listarMateriais(acervo, CFG).length, 1);
  } finally {
    b.limpar();
    c.limpar();
  }
});
