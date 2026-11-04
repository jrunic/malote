import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { gravarMaterialLido } from '../src/adaptadores/whatsapp/importar.js';

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';
const LID = '109876543210987@lid';
const OPCOES = { agora: Date.parse('2026-09-02T12:00:00Z'), configuracao: CFG_WHATSAPP };

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

const identificadoresDoCelular = (acervo: Acervo): number =>
  contar(acervo, 'SELECT COUNT(*) AS n FROM identificadores WHERE valor IN (?, ?)', SEM_NOVE, COM_NOVE);

const coletiva = (roster: string[]) => ({
  idExterno: GRUPO,
  nome: 'Grupo',
  coletiva: true,
  participantesConhecidos: roster.map((endereco) => ({ endereco })),
  bruto: '{}',
});

const mensagemDe = (autorExterno: string) => ({
  idExterno: 'M1',
  conversaIdExterno: GRUPO,
  texto: 'oi',
  ocorridaEm: Date.parse('2026-08-01T10:00:00Z'),
  daPropriaPessoa: false,
  autorExterno,
  favorita: false,
  bruto: '{}',
});

function material(parcial: {
  conversas?: Array<ReturnType<typeof coletiva> | { idExterno: string; nome: string | null; coletiva: boolean; participantesConhecidos: never[]; bruto: string }>;
  mensagens?: Array<ReturnType<typeof mensagemDe>>;
  eventos?: Array<{ idExterno: string; conversaIdExterno: string; membroExterno: string; codigo: number; ocorridoEm: number }>;
  correspondencias?: Array<{ alternativo: string; canonico: string }>;
}) {
  return {
    conversas: parcial.conversas ?? [],
    mensagens: parcial.mensagens ?? [],
    descartes: { mensagens: {}, eventos: {}, conversas: {} },
    linhasRepetidasNoMaterial: 0,
    fechar: () => {},
    eventos: parcial.eventos ?? [],
    correspondencias: parcial.correspondencias ?? [],
  };
}

test('o autor da Mensagem importada, na forma alternativa de um Identificador ja gravado, e o mesmo Identificador', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    gravarMaterialLido(acervo, material({ conversas: [coletiva([])], mensagens: [mensagemDe(COM_NOVE)] }), OPCOES);

    assert.equal(identificadoresDoCelular(acervo), 1);
    const autor = acervo.db.prepare('SELECT i.valor AS valor FROM mensagens m JOIN identificadores i ON i.id = m.autor_id').get() as { valor: string };
    assert.equal(autor.valor, SEM_NOVE);
  });
});

test('duas Conversas diretas do mesmo celular, em formas diferentes no material, viram UMA', () => {
  comAcervo((acervo) => {
    gravarMaterialLido(
      acervo,
      material({
        conversas: [
          { idExterno: SEM_NOVE, nome: 'Alguem', coletiva: false, participantesConhecidos: [], bruto: '{}' },
          { idExterno: COM_NOVE, nome: 'Alguem', coletiva: false, participantesConhecidos: [], bruto: '{}' },
        ],
      }),
      OPCOES,
    );
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM conversas WHERE coletiva = 0'), 1);
    assert.equal(identificadoresDoCelular(acervo), 1);
  });
});

test('o roster do grupo com o mesmo celular nas duas formas e UM Identificador', () => {
  comAcervo((acervo) => {
    gravarMaterialLido(acervo, material({ conversas: [coletiva([SEM_NOVE, COM_NOVE])] }), OPCOES);
    assert.equal(identificadoresDoCelular(acervo), 1);
  });
});

test('o membro do evento do material, na forma alternativa de um Identificador ja gravado, e o mesmo Identificador', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    gravarMaterialLido(
      acervo,
      material({
        conversas: [coletiva([])],
        eventos: [{ idExterno: 'EV1', conversaIdExterno: GRUPO, membroExterno: COM_NOVE, codigo: 15, ocorridoEm: Date.parse('2026-08-01T10:00:00Z') }],
      }),
      OPCOES,
    );
    assert.equal(contar(acervo, 'SELECT COUNT(*) AS n FROM transicoes_de_participacao'), 1);
    assert.equal(identificadoresDoCelular(acervo), 1);
  });
});

test('o par do material (LID para JID) aponta para a forma gravada do celular, nao para a crua', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    gravarMaterialLido(acervo, material({ correspondencias: [{ alternativo: LID, canonico: COM_NOVE }] }), OPCOES);
    assert.deepEqual(pares(acervo), [
      { alternativo: LID, canonico: SEM_NOVE },
      { alternativo: COM_NOVE, canonico: SEM_NOVE },
    ]);
  });
});
