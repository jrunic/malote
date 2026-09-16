import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import {
  importarMaterialDeInstagram,
  TitularAusenteError,
} from '../src/adaptadores/instagram/importar.js';
import { CFG_INSTAGRAM } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-26T12:00:00Z');
const TITULAR = 'Titular Sintetico';

function umaConversa() {
  return materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', TITULAR],
      messages: [
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' },
        { sender_name: TITULAR, timestamp_ms: 1_700_000_060_000, content: 'ola' },
      ],
    },
  ]);
}

test('importa e reimportar não cria nada de novo', () => {
  const c = cenario();
  const m = umaConversa();
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    const primeira = importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });
    assert.equal(primeira.mensagensCriadas, 2);
    assert.equal(primeira.mensagensJaExistentes, 0);
    assert.equal(primeira.conversasCriadas, 1);

    // `reprocessar` porque o que este teste mede e a IDEMPOTENCIA DA ESCRITA,
    // e nao o pulo por material ja registrado. Sem ele o caminho nao roda e o
    // relatorio vem zerado — provando outra coisa.
    const segunda = importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR, reprocessar: true });
    assert.equal(segunda.mensagensCriadas, 0, 'a classificação é o critério, não o total');
    assert.equal(segunda.mensagensJaExistentes, 2);
    assert.equal(segunda.conversasCriadas, 0, '"criada" precisa querer dizer criada');
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('o título da Conversa nunca vira endereço', () => {
  const c = cenario();
  // Três conversas com o MESMO título — no material real, 22 compartilham o
  // marcador de conta indisponível.
  const m = materialInstagramFalso(
    ['111111111111111', '222222222222222', '333333333333333'].map((numero) => ({
      slug: 'usuariodoinstagram',
      numero,
      title: 'usuariodoinstagram',
      participants: ['usuariodoinstagram', TITULAR],
      messages: [
        { sender_name: 'usuariodoinstagram', timestamp_ms: 1_700_000_000_000, content: 'oi' },
      ],
    })),
  );
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });

    const valores = (
      acervo.db.prepare("SELECT valor FROM identificadores WHERE fonte = 'instagram'").all() as {
        valor: string;
      }[]
    ).map((l) => l.valor);

    // Sem assert de unicidade aqui: `identificadores` já declara
    // UNIQUE (fonte, valor), então a asserção passaria com qualquer lógica.
    assert.equal(valores.filter((v) => v.startsWith('conversa:')).length, 3);
    // A metade que dá poder ao teste: distintos por si só passaria com a
    // lógica errada, porque o número já difere. O que precisa cair é a
    // implementação que volta a derivar o endereço do nome do diretório.
    for (const v of valores) {
      assert.ok(!v.includes('usuariodoinstagram'), `Identificador carrega o título: ${v}`);
    }
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('participante de coletiva entra pelo nome de exibição, e o autor aponta para ele', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'turmadeviagem',
      numero: '222222222222222',
      title: 'Turma de Viagem',
      participants: ['Joana Prado', 'Marco Bueno', TITULAR],
      joinable_mode: { mode: 1, link: '' },
      messages: [{ sender_name: 'Marco Bueno', timestamp_ms: 1_700_000_000_000, content: 'bora' }],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });

    const autor = acervo.db
      .prepare(
        `SELECT i.valor FROM mensagens m
           JOIN identificadores i ON i.id = m.autor_id
          WHERE m.fonte = 'instagram'`,
      )
      .get() as { valor: string } | undefined;
    assert.equal(autor?.valor, 'nome-exibicao:Marco Bueno');

    const participacoes = acervo.db.prepare('SELECT COUNT(*) AS n FROM participacoes').get() as {
      n: number;
    };
    assert.equal(participacoes.n, 3, 'as três Participações que a Fonte informou');
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('Titular que não aparece em toda conversa direta é recusado antes de escrever', () => {
  const c = cenario();
  const m = umaConversa();
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    assert.throws(
      () => importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: 'Nome Errado' }),
      TitularAusenteError,
    );
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas').get() as { n: number };
    assert.equal(n.n, 0, 'a recusa acontece ANTES de qualquer escrita');
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('anexo nasce sem arquivo e SEM caminho, e reimportar não o duplica', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', TITULAR],
      messages: [
        {
          sender_name: 'Joana Prado',
          timestamp_ms: 1_700_000_000_000,
          content: 'olha',
          photos: [{ uri: 'x/photos/aaa.jpg' }, { uri: 'x/photos/bbb.jpg' }],
        },
      ],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    const r = importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });
    assert.equal(r.mensagensCriadas, 1, 'uma Mensagem');
    assert.equal(r.anexosCriados, 2, 'dois Anexos na mesma Mensagem');

    const anexos = acervo.db.prepare('SELECT presenca, caminho FROM anexos').all() as {
      presenca: string;
      caminho: string | null;
    }[];
    assert.deepEqual(
      anexos.map((a) => a.presenca),
      ['nunca-obtido', 'nunca-obtido'],
    );
    assert.deepEqual(
      anexos.map((a) => a.caminho),
      [null, null],
    );

    // Reimportar não dobra o Anexo. `anexos` não tem UNIQUE: sem o `continue`
    // em `jaExistia`, esta asserção cai — e é a única que cai.
    const r2 = importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });
    assert.equal(r2.anexosCriados, 0);
    const total = acervo.db.prepare('SELECT COUNT(*) AS n FROM anexos').get() as { n: number };
    assert.equal(total.n, 2, 'dois Anexos depois de duas importações');
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('instante anterior ao início da Fonte é recusado com motivo próprio', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', TITULAR],
      messages: [
        {
          sender_name: 'Joana Prado',
          timestamp_ms: Date.parse('2011-05-01T00:00:00Z'),
          content: 'antiga',
        },
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'recente' },
      ],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    const r = importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });
    assert.equal(r.mensagensCriadas, 1);
    assert.equal(r.mensagensRejeitadas, 1);
    assert.deepEqual(Object.keys(r.rejeicoesPorMotivo), [
      'instante anterior ao inicio da Fonte instagram',
    ]);
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('registros indistinguíveis viram duas Mensagens, e a colisão é contabilizada', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', TITULAR],
      messages: [
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' },
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' },
      ],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    const r = importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });
    assert.equal(r.mensagensCriadas, 2, 'as duas sobrevivem — colapsar perderia acervo em silêncio');
    assert.equal(r.colisoesDesempatadas, 1);
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
    assert.equal(n.n, 2);
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('coletiva sem participante algum é importada, sem Participação e sem data inventada', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'grupoantigo',
      numero: '333333333333333',
      title: 'Grupo Antigo',
      participants: [],
      joinable_mode: { mode: 1, link: '' },
      messages: [{ sender_name: 'Marco Bueno', timestamp_ms: 1_700_000_000_000, content: 'oi' }],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    const r = importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });
    assert.equal(r.conversasCriadas, 1);
    assert.equal(r.mensagensCriadas, 1);
    const p = acervo.db.prepare('SELECT COUNT(*) AS n FROM participacoes').get() as { n: number };
    assert.equal(p.n, 0, 'nenhuma Participação: a Fonte não informou o quadro');
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('acento atravessa a importação inteira e chega legível ao Acervo', () => {
  const c = cenario();
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', TITULAR],
      messages: [
        {
          sender_name: 'Joana Prado',
          timestamp_ms: 1_700_000_000_000,
          content: 'coração e açaí à noite',
        },
      ],
    },
  ]);
  try {
    const { acervo } = c.novoInquilino('Titular Sintetico');
    importarMaterialDeInstagram(acervo, m.raiz, { agora: AGORA, configuracao: CFG_INSTAGRAM, titular: TITULAR });
    const linha = acervo.db
      .prepare("SELECT conteudo FROM mensagens WHERE fonte = 'instagram'")
      .get() as { conteudo: string };
    assert.equal(linha.conteudo, 'coração e açaí à noite');
  } finally {
    m.limpar();
    c.limpar();
  }
});

test('a reimportação conta o par criado/já existente nas quatro grandezas', () => {
  const c = cenario();
  const m = umaConversa();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    const primeira = importarMaterialDeInstagram(acervo, m.raiz, {
      agora: AGORA, configuracao: CFG_INSTAGRAM, reprocessar: true,
      titular: TITULAR,
    });
    assert.equal(primeira.conversasCriadas, 1);
    assert.equal(primeira.conversasJaExistentes, 0);
    assert.ok(primeira.participacoesCriadas > 0, 'as Participações nasceram');
    assert.equal(primeira.participacoesJaExistentes, 0);

    const segunda = importarMaterialDeInstagram(acervo, m.raiz, {
      agora: AGORA, configuracao: CFG_INSTAGRAM, reprocessar: true,
      titular: TITULAR,
    });
    assert.equal(segunda.conversasCriadas, 0, 'nada de novo na segunda passagem');
    assert.equal(segunda.conversasJaExistentes, 1);
    assert.equal(segunda.mensagensCriadas, 0);
    assert.equal(segunda.mensagensJaExistentes, 2);
    assert.equal(segunda.participacoesCriadas, 0);
    assert.equal(
      segunda.participacoesJaExistentes,
      primeira.participacoesCriadas,
      'as mesmas Participações, agora reobservadas',
    );
  } finally {
    m.limpar();
    c.limpar();
  }
});
