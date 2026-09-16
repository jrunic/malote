import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarAnexo,
  descartarAnexo,
} from '../src/nucleo/escrita.js';
import { criarPessoa, vincularIdentificador } from '../src/nucleo/identidade.js';
import {
  listarConversas,
  lerMensagens,
  buscarMensagens,
  contarAcervo,
} from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP, CFG_INSTAGRAM } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-24T12:00:00Z');
const EM_USO = Date.parse('2021-06-15T10:00:00Z');

/** Povoa um Acervo com duas Conversas e três Mensagens. */
function povoar(acervo: Parameters<typeof listarConversas>[0]) {
  const { id: leia } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5565900000001' });
  const { id: han } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '+5565900000002' });

  const direta = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'direta-1',
    coletiva: false, configuracao: CFG_WHATSAPP,
  });
  const coletiva = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'grupo-1',
    coletiva: true,
    metadadosDeColetiva: { assunto: 'Conselho' },
  });

  registrarMensagem(acervo, {
    conversaId: direta,
    fonte: 'whatsapp',
    idExterno: 'm1',
    autorId: leia,
    conteudo: 'preciso do relatorio de bordo',
    ocorridaEm: EM_USO,
    agora: AGORA,
  });
  registrarMensagem(acervo, {
    conversaId: direta,
    fonte: 'whatsapp',
    idExterno: 'm2',
    autorId: han,
    conteudo: 'mando ainda hoje',
    ocorridaEm: EM_USO + 60_000,
    agora: AGORA,
  });
  const naColetiva = registrarMensagem(acervo, {
    conversaId: coletiva,
    fonte: 'whatsapp',
    idExterno: 'm3',
    autorId: han,
    conteudo: 'segue o video do bordo',
    ocorridaEm: EM_USO + 120_000,
    agora: AGORA,
  });

  return { leia, han, direta, coletiva, naColetiva };
}

test('listar Conversas devolve as duas, com a natureza correta', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    povoar(acervo);

    const conversas = listarConversas(acervo, {});
    assert.equal(conversas.length, 2);
    assert.equal(conversas.filter((x) => x.coletiva).length, 1);
    assert.equal(conversas.find((x) => x.coletiva)?.assunto, 'Conselho');
  } finally {
    c.limpar();
  }
});

test('ler Mensagens de uma Conversa devolve em ordem de ocorrência', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { direta } = povoar(acervo);

    const mensagens = lerMensagens(acervo, { conversaId: direta });
    assert.equal(mensagens.length, 2);
    assert.equal(mensagens[0]?.conteudo, 'preciso do relatorio de bordo');
    assert.equal(mensagens[1]?.conteudo, 'mando ainda hoje');
  } finally {
    c.limpar();
  }
});

test('busca por texto acha a Mensagem e ignora as que não casam', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    povoar(acervo);

    const achadas = buscarMensagens(acervo, { texto: 'relatorio' });
    assert.equal(achadas.length, 1);
    assert.match(achadas[0]?.conteudo ?? '', /relatorio/);

    assert.equal(buscarMensagens(acervo, { texto: 'sabre' }).length, 0);
  } finally {
    c.limpar();
  }
});

test('busca acha as duas Mensagens que compartilham o termo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    povoar(acervo);
    // "bordo" aparece na direta e na coletiva: um teste com um só resultado
    // passaria com a busca devolvendo sempre o primeiro match.
    assert.equal(buscarMensagens(acervo, { texto: 'bordo' }).length, 2);
  } finally {
    c.limpar();
  }
});

test('filtrar por Pessoa alcança todos os Identificadores dela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { han } = povoar(acervo);
    const { id: outroDoHan } = registrarIdentificador(acervo, { fonte: 'instagram', valor: 'han' });
    const conversaInsta = registrarConversa(acervo, {
      fonte: 'instagram',
      idExterno: 'dm-1',
      coletiva: false, configuracao: CFG_INSTAGRAM,
    });
    registrarMensagem(acervo, {
      conversaId: conversaInsta,
      fonte: 'instagram',
      idExterno: 'i1',
      autorId: outroDoHan,
      conteudo: 'aqui tambem',
      ocorridaEm: Date.parse('2021-07-01T10:00:00Z'),
      agora: AGORA,
    });

    const pessoa = criarPessoa(acervo);
    for (const ident of [han, outroDoHan]) {
      vincularIdentificador(acervo, {
        identificadorId: ident,
        pessoaId: pessoa,
        procedencia: 'humano',
      });
    }
    assert.ok(pessoa);

    // Três mensagens do Han: duas no WhatsApp, uma no Instagram. Um teste com
    // uma Fonte só passaria com o filtro alcançando apenas o Identificador dado.
    const doHan = lerMensagens(acervo, { pessoaId: pessoa });
    assert.equal(doHan.length, 3);
    assert.equal(new Set(doHan.map((m) => m.fonte)).size, 2);
  } finally {
    c.limpar();
  }
});

test('Mensagem com Anexo descartado continua no resultado, com a Presença explícita', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { coletiva, naColetiva } = povoar(acervo);
    const anexo = registrarAnexo(acervo, {
      mensagemId: naColetiva,
      tipo: 'video',
      tamanho: 41_000_000,
      presenca: 'presente',
      caminho: 'videos/ab/cd.mp4',
    });
    descartarAnexo(acervo, anexo, { politica: 'teste' });

    const mensagens = lerMensagens(acervo, { conversaId: coletiva });
    assert.equal(mensagens.length, 1, 'a Mensagem não some por o arquivo ter saído');
    assert.equal(mensagens[0]?.anexos[0]?.presenca, 'descartado');
    assert.equal(mensagens[0]?.anexos[0]?.tamanho, 41_000_000);
  } finally {
    c.limpar();
  }
});

test('contar Acervo devolve os números por natureza', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    povoar(acervo);
    const contagem = contarAcervo(acervo);
    assert.equal(contagem.conversas, 2);
    assert.equal(contagem.mensagens, 3);
    assert.equal(contagem.identificadores, 2);
  } finally {
    c.limpar();
  }
});
