import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { listarConversas } from '../src/nucleo/consulta.js';
import { join } from 'node:path';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { importarMaterialDeInstagram } from '../src/adaptadores/instagram/importar.js';
import { materialJaEntrou, registrarMaterialConcluido } from '../src/nucleo/sincronizacao.js';
import { recriarAcervo } from '../src/nucleo/recriar.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP, CFG_INSTAGRAM } from './ajuda/configuracao.js';

/**
 * Estas guardas passam hoje: o código já está correto. Elas existem para o dia
 * em que alguém introduzir remoção — sem elas o defeito volta em silêncio, e é
 * o defeito que destruiria o acervo, porque o material é incremental.
 */

test('Conversa e Mensagem ausentes do material novo NÃO são removidas', () => {
  const c = cenario();
  const a = backupFalso({
    conversas: [
      { pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 },
      { pk: 2, endereco: 'b@s.whatsapp.net', nome: 'Bea', tipoDeSessao: 0 },
      { pk: 3, endereco: 'c@s.whatsapp.net', nome: 'Cid', tipoDeSessao: 0 },
    ],
    mensagens: [
      { stanzaId: 'a1', chatSessionPk: 1, texto: 'um', dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z') },
      { stanzaId: 'b1', chatSessionPk: 2, texto: 'dois', dataCoreData: paraCoreData('2026-01-10T13:00:00.000Z') },
      { stanzaId: 'c1', chatSessionPk: 3, texto: 'tres', dataCoreData: paraCoreData('2026-01-10T14:00:00.000Z') },
    ],
  });
  // Subconjunto proprio: so Ana. Um leitor que tratasse o material como
  // retrato completo marcaria Bea e Cid como removidas.
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'a@s.whatsapp.net', nome: 'Ana', tipoDeSessao: 0 }],
    mensagens: [
      { stanzaId: 'a1', chatSessionPk: 1, texto: 'um', dataCoreData: paraCoreData('2026-01-10T12:00:00.000Z') },
    ],
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    importarMaterial(acervo, a.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, reprocessar: true });
    importarMaterial(acervo, b.raiz, { agora: Date.now(), configuracao: CFG_WHATSAPP, reprocessar: true });

    assert.equal(listarConversas(acervo, {}).length, 3, 'as três Conversas continuam no Acervo');
    const mensagens = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
    assert.equal(mensagens.n, 3, 'nenhuma Mensagem some por ausência no material novo');
  } finally {
    a.limpar();
    b.limpar();
    c.limpar();
  }
});

test('Participação ausente do material novo permanece, com a data da última observação', () => {
  const c = cenario();
  const membros = [
    { pk: 10, endereco: 'm1@s.whatsapp.net', conversaPk: 1 },
    { pk: 11, endereco: 'm2@s.whatsapp.net', conversaPk: 1 },
    { pk: 12, endereco: 'm3@s.whatsapp.net', conversaPk: 1 },
  ];
  const a = backupFalso({
    conversas: [{ pk: 1, endereco: 'g@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
    mensagens: [],
    membros,
  });
  // O quadro ENCOLHEU: m3 saiu do material. Nao saiu da Conversa — o material
  // so nao o traz. Inferir saida daqui e o defeito que a guarda impede.
  const b = backupFalso({
    conversas: [{ pk: 1, endereco: 'g@g.us', nome: 'Grupo', tipoDeSessao: 1 }],
    mensagens: [],
    membros: membros.slice(0, 2),
  });
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const ANTES = Date.parse('2026-01-01T00:00:00.000Z');
    const DEPOIS = Date.parse('2026-06-01T00:00:00.000Z');
    importarMaterial(acervo, a.raiz, { agora: ANTES, configuracao: CFG_WHATSAPP, reprocessar: true });
    importarMaterial(acervo, b.raiz, { agora: DEPOIS, configuracao: CFG_WHATSAPP, reprocessar: true });

    const linhas = acervo.db
      .prepare(
        `SELECT i.valor, p.observada_em FROM participacoes p
           JOIN identificadores i ON i.id = p.identificador_id
          ORDER BY i.valor`,
      )
      .all() as Array<{ valor: string; observada_em: string }>;
    const porEndereco = new Map(linhas.map((l) => [l.valor, l.observada_em]));

    assert.equal(porEndereco.size, 3, 'as três Participações permanecem');
    assert.equal(porEndereco.get('m1@s.whatsapp.net'), new Date(DEPOIS).toISOString());
    assert.equal(porEndereco.get('m2@s.whatsapp.net'), new Date(DEPOIS).toISOString());
    assert.equal(
      porEndereco.get('m3@s.whatsapp.net'),
      new Date(ANTES).toISOString(),
      'quem saiu do material mantém a data em que foi visto pela última vez',
    );
  } finally {
    a.limpar();
    b.limpar();
    c.limpar();
  }
});

test('Conversa sem arquivo de mensagem é contabilizada e NÃO interrompe a importação', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages: [
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' },
      ],
    },
    {
      slug: 'vazia',
      numero: '444444444444444',
      title: 'Vazia',
      participants: ['Vazia', 'Titular Sintetico'],
      messages: [],
      semArquivo: true,
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = importarMaterialDeInstagram(acervo, m.raiz, {
      agora: Date.parse('2026-08-26T12:00:00Z'),
      configuracao: CFG_INSTAGRAM, reprocessar: true,
      titular: 'Titular Sintetico',
    });
    assert.equal(r.conversasSemArquivo, 1, 'a Conversa sem arquivo é contada');
    assert.equal(r.mensagensCriadas, 1, 'e a importação seguiu, gravando a outra');
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('recriar o Acervo apaga o registro de Materiais junto', () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    registrarMaterialConcluido(acervo, {
      configuracaoId: 'cfg-1',
      fonte: 'whatsapp',
      impressao: 'impressao-x',
      conversasCriadas: 1,
      mensagensCriadas: 1,
    });
    assert.ok(materialJaEntrou(acervo, 'cfg-1', 'impressao-x') !== null);
    acervo.fechar();

    const pasta = join(c.raiz, 'acervos');
    recriarAcervo(pasta, id);

    // A razao de a tabela morar no Acervo: o produto nunca pode afirmar que um
    // Material ja entrou contra um banco que nao o contem. Se algum dia ela
    // for para o Registro, esta guarda cai.
    const novo = abrirAcervo(pasta, id);
    try {
      assert.equal(
        materialJaEntrou(novo, 'cfg-1', 'impressao-x'),
        null,
        'Acervo recriado não pode lembrar de Material que ele não contém',
      );
    } finally {
      novo.fechar();
    }
  } finally {
    c.limpar();
  }
});
