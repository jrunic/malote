import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialInstagramFalso } from './ajuda/material-instagram-falso.js';
import { lerMaterial, NaturezaAmbiguaError } from '../src/adaptadores/instagram/material.js';

test('lê uma conversa direta com o número da conversa como identidade', () => {
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages: [
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' },
        { sender_name: 'Titular Sintetico', timestamp_ms: 1_700_000_060_000, content: 'ola' },
      ],
    },
  ]);
  try {
    const material = lerMaterial(m.raiz);
    assert.equal(material.conversas.length, 1);
    const c = material.conversas[0];
    assert.equal(c?.idExterno, '111111111111111');
    assert.equal(c?.coletiva, false);
    assert.equal(c?.caixa, 'inbox');
    assert.deepEqual(c?.participantesExibicao, ['Joana Prado', 'Titular Sintetico']);
    assert.equal(c?.mensagens.length, 2);
    assert.deepEqual(material.conversasSemArquivo, []);
  } finally {
    m.limpar();
  }
});

test('mensagem chega completa, em ordem crescente e com acento legível', () => {
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages: [
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'coração à João' },
        { sender_name: 'Titular Sintetico', timestamp_ms: 1_700_000_060_000, content: 'açaí' },
      ],
    },
  ]);
  try {
    const c = lerMaterial(m.raiz).conversas[0];
    assert.deepEqual(
      c?.mensagens.map((x) => x.ocorridaEm),
      [1_700_000_000_000, 1_700_000_060_000],
      'o material chega decrescente; a leitura entrega crescente',
    );
    assert.equal(c?.mensagens[0]?.texto, 'coração à João');
    assert.equal(c?.mensagens[0]?.autorExibicao, 'Joana Prado');
    assert.equal(c?.mensagens[1]?.texto, 'açaí');
    assert.ok((c?.mensagens[0]?.bruto.length ?? 0) > 0, 'o registro original é preservado');
  } finally {
    m.limpar();
  }
});

test('um registro com N mídias vira UMA mensagem com N anexos', () => {
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages: [
        {
          sender_name: 'Joana Prado',
          timestamp_ms: 1_700_000_000_000,
          content: 'olha isso',
          photos: [{ uri: 'x/photos/aaa.jpg' }, { uri: 'x/photos/bbb.jpg' }],
          videos: [{ uri: 'x/videos/ccc.mp4' }],
        },
      ],
    },
  ]);
  try {
    const c = lerMaterial(m.raiz).conversas[0];
    assert.equal(c?.mensagens.length, 1, 'uma mensagem, não três');
    assert.deepEqual(c?.mensagens[0]?.anexos, [
      { tipo: 'image', nomeNaOrigem: 'aaa.jpg' },
      { tipo: 'image', nomeNaOrigem: 'bbb.jpg' },
      { tipo: 'video', nomeNaOrigem: 'ccc.mp4' },
    ]);
  } finally {
    m.limpar();
  }
});

test('registros indistinguíveis recebem ordinal crescente; os demais ficam em zero', () => {
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages: [
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' },
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' },
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' },
        { sender_name: 'Joana Prado', timestamp_ms: 1_700_000_030_000, content: 'tudo bem' },
      ],
    },
  ]);
  try {
    const c = lerMaterial(m.raiz).conversas[0];
    assert.deepEqual(
      c?.mensagens.map((x) => x.ordinal),
      [0, 1, 2, 0],
    );
  } finally {
    m.limpar();
  }
});

test('conversa fatiada em vários message_N.json entrega todas as mensagens', () => {
  // A plataforma fatia conversa longa. Ler só o primeiro arquivo perde acervo
  // em silêncio, e ordenar por texto põe o 10 antes do 2 — daí as 12.
  const messages = Array.from({ length: 12 }, (_, i) => ({
    sender_name: 'Joana Prado',
    timestamp_ms: 1_700_000_000_000 + i * 1_000,
    content: `mensagem ${i}`,
  }));
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages,
      mensagensPorArquivo: 1,
    },
  ]);
  try {
    const c = lerMaterial(m.raiz).conversas[0];
    assert.equal(c?.mensagens.length, 12, 'todos os arquivos entram, não só o primeiro');
    assert.equal(c?.mensagens[0]?.texto, 'mensagem 0');
    assert.equal(c?.mensagens[11]?.texto, 'mensagem 11');
  } finally {
    m.limpar();
  }
});

test('conversa coletiva é reconhecida quando os três sinais concordam', () => {
  const m = materialInstagramFalso([
    {
      slug: 'turmadeviagem',
      numero: '222222222222222',
      title: 'Turma de Viagem',
      participants: ['Joana Prado', 'Marco Bueno', 'Titular Sintetico'],
      joinable_mode: { mode: 1, link: '' },
      messages: [{ sender_name: 'Marco Bueno', timestamp_ms: 1_700_000_000_000, content: 'bora' }],
    },
  ]);
  try {
    assert.equal(lerMaterial(m.raiz).conversas[0]?.coletiva, true);
  } finally {
    m.limpar();
  }
});

test('sinais em desacordo interrompem a leitura em vez de escolher natureza', () => {
  const m = materialInstagramFalso([
    {
      // Três participantes e título fora da lista dizem coletiva;
      // a ausência do modo de entrada diz direta. Ninguém decide.
      slug: 'turmadeviagem',
      numero: '222222222222222',
      title: 'Turma de Viagem',
      participants: ['Joana Prado', 'Marco Bueno', 'Titular Sintetico'],
      messages: [{ sender_name: 'Marco Bueno', timestamp_ms: 1_700_000_000_000, content: 'bora' }],
    },
  ]);
  try {
    assert.throws(() => lerMaterial(m.raiz), NaturezaAmbiguaError);
  } finally {
    m.limpar();
  }
});

test('coletiva sem participante algum é lida sem inventar natureza', () => {
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
    const c = lerMaterial(m.raiz).conversas[0];
    assert.equal(c?.coletiva, true);
    assert.deepEqual(c?.participantesExibicao, []);
  } finally {
    m.limpar();
  }
});

test('diretório de conversa sem arquivo de mensagem é observado, não lido', () => {
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '444444444444444',
      title: 'Joana Prado',
      participants: [],
      messages: [],
      semArquivo: true,
    },
  ]);
  try {
    const material = lerMaterial(m.raiz);
    assert.deepEqual(material.conversas, []);
    assert.deepEqual(material.conversasSemArquivo, ['444444444444444']);
  } finally {
    m.limpar();
  }
});

test('a caixa de solicitações entra, marcada como tal', () => {
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '111111111111111',
      title: 'Joana Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages: [{ sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' }],
    },
    {
      slug: 'marcobueno',
      numero: '555555555555555',
      title: 'Marco Bueno',
      participants: ['Marco Bueno', 'Titular Sintetico'],
      messages: [{ sender_name: 'Marco Bueno', timestamp_ms: 1_700_000_000_000, content: 'ola' }],
      caixa: 'message_requests',
    },
  ]);
  try {
    const { conversas } = lerMaterial(m.raiz);
    assert.equal(conversas.length, 2);
    assert.deepEqual(
      conversas.map((c) => c.caixa).sort(),
      ['inbox', 'message_requests'],
    );
  } finally {
    m.limpar();
  }
});

test('marca invisível de direção no título NÃO torna a natureza ambígua', () => {
  // MEDIDO EM 12/09/2026, no ensaio da adoção contra material real: de 815
  // conversas em 20 exports, DUAS eram recusadas como ambíguas — e as duas
  // casariam sem as marcas invisíveis. O título vem embrulhado em U+200E
  // (LEFT-TO-RIGHT MARK) que o nome do participante não tem, e
  // `participantes.includes(titulo)` falha por um caractere que ninguém vê.
  //
  // Acontece com nome em escrita da direita para a esquerda, e a plataforma
  // embrulha o título para que ele renderize na ordem certa. É Conversa
  // DIRETA normal, e a recusa derrubava o material INTEIRO.
  const nome = 'نقية السعادة';
  const m = materialInstagramFalso([
    {
      slug: 'nqytalsadt',
      numero: '1830258248379007',
      title: `‎${nome}‎`,
      participants: [nome, 'Titular Sintetico'],
      messages: [{ sender_name: nome, timestamp_ms: 1_700_000_000_000, content: 'ola' }],
    },
  ]);
  try {
    const material = lerMaterial(m.raiz);
    assert.equal(material.conversas.length, 1);
    assert.equal(material.conversas[0]?.coletiva, false, 'é direta, e não ambígua');
  } finally {
    m.limpar();
  }
});

test('o discriminante continua recusando ambiguidade de VERDADE', () => {
  // O outro lado, e ele é o que impede a correção de virar cegueira: título
  // que não é participante POR CONTEÚDO — e não por marca invisível —
  // continua sendo desacordo de sinais.
  const m = materialInstagramFalso([
    {
      slug: 'grupo',
      numero: '999999999999999',
      title: 'Nome de grupo que ninguem tem',
      participants: ['Alguem', 'Titular Sintetico'],
      messages: [{ sender_name: 'Alguem', timestamp_ms: 1_700_000_000_000, content: 'ola' }],
    },
  ]);
  try {
    assert.throws(() => lerMaterial(m.raiz), NaturezaAmbiguaError);
  } finally {
    m.limpar();
  }
});

test('a limpeza é ESTREITA: espaço a mais no título continua sendo desacordo', () => {
  // ESTE CASO NASCEU DE UM MUTANTE QUE SOBREVIVEU. Alargar a limpeza para
  // "tudo o que não é letra ou dígito" passava em todos os outros testes — e
  // passaria a colapsar diferenças que ninguém decidiu colapsar.
  //
  // A função promete tirar só o que é INVISÍVEL. Se um dia normalizar espaço,
  // acento ou caixa for desejável, é decisão a tomar e a medir; até lá o
  // discriminante RELATA o desacordo em vez de escolher, que é a filosofia
  // declarada deste módulo.
  const m = materialInstagramFalso([
    {
      slug: 'joanaprado',
      numero: '222222222222222',
      title: 'Joana  Prado',
      participants: ['Joana Prado', 'Titular Sintetico'],
      messages: [{ sender_name: 'Joana Prado', timestamp_ms: 1_700_000_000_000, content: 'oi' }],
    },
  ]);
  try {
    assert.throws(() => lerMaterial(m.raiz), NaturezaAmbiguaError);
  } finally {
    m.limpar();
  }
});
