import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { instalacaoComInquilino, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { backupFalso } from './ajuda/material-falso.js';
import { gravarMaterialLido } from '../src/adaptadores/whatsapp/importar.js';
import type { Material } from '../src/adaptadores/whatsapp/material.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

function material(m: Partial<Material>): Material {
  return {
    conversas: [],
    mensagens: [],
    eventos: [],
    correspondencias: [],
    descartes: { mensagens: {}, eventos: {} },
    linhasRepetidasNoMaterial: 0,
    fechar: () => {},
    ...m,
  };
}

test('o relatório separa participante ativo de inativo, e não conta a Conversa direta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = gravarMaterialLido(
      acervo,
      material({
        conversas: [
          {
            idExterno: 'grupo-1@g.us',
            nome: 'Grupo',
            coletiva: true,
            bruto: '{}',
            participantesConhecidos: [
              { endereco: '5565911111', ativaNaFonte: true },
              { endereco: '5565922222', ativaNaFonte: false },
              { endereco: '5565933333', ativaNaFonte: false },
            ],
          },
          // Conversa direta: a Fonte não declara atividade nenhuma nela, e por
          // isso ela não entra em nenhum dos dois contadores.
          {
            idExterno: '5565944444',
            nome: 'Alguem',
            coletiva: false,
            bruto: '{}',
            participantesConhecidos: [],
          },
        ],
      }),
      { agora: 1_700_000_000_000, configuracao: CFG_WHATSAPP, reprocessar: true },
    );

    assert.equal(r.participantesAtivos, 1);
    assert.equal(r.participantesInativos, 2);
  } finally {
    c.limpar();
  }
});

test('a importação imprime as Transições e os códigos que não classificou', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const inquilino = instalacaoComInquilino(raiz);
    const backup = backupFalso({
      conversas: [{ pk: 1, endereco: 'grupo-1@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
      membros: [
        { pk: 10, endereco: '5565911111', conversaPk: 1, ativo: true },
        { pk: 11, endereco: '5565922222', conversaPk: 1, ativo: false },
      ],
      mensagens: [
        // Evento MAPEADO (codigo 7) e evento DESCONHECIDO (codigo 30 — o dos
        // oraculos divergentes, que segue fora do mapa de proposito).
        {
          stanzaId: 'ev-1',
          chatSessionPk: 1,
          texto: null,
          dataCoreData: 700_000_000,
          tipo: 6,
          codigoDeEvento: 7,
          grupoMembroPk: 11,
        },
        {
          stanzaId: 'ev-2',
          chatSessionPk: 1,
          texto: null,
          dataCoreData: 700_000_100,
          tipo: 6,
          codigoDeEvento: 30,
          grupoMembroPk: 10,
        },
      ],
    });
    try {
      const r = rodar(raiz, [
        'importar',
        '--configuracao',
        'teste',
        '--inquilino',
        inquilino,
        '--fonte',
        'whatsapp',
        '--material',
        backup.raiz,
      ]);
      assert.equal(r.codigo, 0, r.saida);
      assert.match(r.saida, /1 transic/i, 'diz quantas Transições entraram');
      // `codigo 15`, e não só `15`: um `/15/` solto casaria com qualquer outro
      // número da saída, e o teste passaria sem medir o que devia.
      assert.match(r.saida, /codigo 30/, 'e nomeia o código que não classificou');
      assert.match(r.saida, /1 ativos, 1 inativos/);
    } finally {
      backup.limpar();
    }
  } finally {
    limpar();
  }
});
