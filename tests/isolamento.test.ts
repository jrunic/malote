import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
} from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  desvincularIdentificador,
  historicoDeNomes,
  lerVinculo,
  mesclarPessoas,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import {
  listarConversas,
  lerMensagens,
  buscarMensagens,
  contarAcervo,
} from '../src/nucleo/consulta.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-08-24T12:00:00Z');
const EM_USO = Date.parse('2021-06-15T10:00:00Z');

/**
 * Semeia material que se sobrepõe nos dois Acervos, com uma distinção que
 * custou uma rodada de verificação de poder em 26/08/2026:
 *
 * - O **endereço de origem é idêntico** nos dois. É isso que faz o teste de
 *   "Identificadores distintos" ter poder: num armazenamento compartilhado,
 *   a unicidade (fonte, valor) devolveria o MESMO id para os dois Inquilinos.
 *
 * - Os **ids externos de Conversa e Mensagem são próprios de cada um**. Se
 *   fossem iguais, num armazenamento compartilhado a idempotência
 *   DEDUPLICARIA em vez de somar — o material do segundo Inquilino seria
 *   descartado em silêncio, as contagens continuariam em 1 e os testes de
 *   listagem, leitura e busca passariam com o isolamento quebrado.
 *
 * - O **texto carrega a marca**, para que a leitura saiba de quem é.
 */
function semearIgual(acervo: Acervo, marca: string) {
  const { id: identificador } = registrarIdentificador(acervo, {
    fonte: 'whatsapp',
    valor: '+5565900000001',
  });
  const conversa = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: `conversa-de-${marca}`,
    coletiva: false, configuracao: CFG_WHATSAPP,
  });
  registrarMensagem(acervo, {
      direcao: 'recebida',
    conversaId: conversa,
    fonte: 'whatsapp',
    idExterno: `mensagem-de-${marca}`,
    autorId: identificador,
    conteudo: `relatorio de bordo ${marca}`,
    ocorridaEm: EM_USO,
    agora: AGORA,
  });
  return { identificador, conversa };
}

test('listar Conversas de um Inquilino não devolve as do outro', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    semearIgual(leia.acervo, 'leia');
    semearIgual(han.acervo, 'han');

    assert.equal(listarConversas(leia.acervo, {}).length, 1);
    assert.equal(listarConversas(han.acervo, {}).length, 1);
  } finally {
    c.limpar();
  }
});

test('ler Mensagens de um Inquilino devolve só o texto dele', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    const naLeia = semearIgual(leia.acervo, 'leia');
    semearIgual(han.acervo, 'han');

    const mensagens = lerMensagens(leia.acervo, { conversaId: naLeia.conversa });
    assert.equal(mensagens.length, 1);
    assert.match(mensagens[0]?.conteudo ?? '', /leia/);
    assert.ok(!(mensagens[0]?.conteudo ?? '').includes('han'));
  } finally {
    c.limpar();
  }
});

test('busca por termo comum aos dois Inquilinos devolve só o do Acervo consultado', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    semearIgual(leia.acervo, 'leia');
    semearIgual(han.acervo, 'han');

    // "relatorio" está nos dois. Vazamento dobraria para 2.
    assert.equal(buscarMensagens(leia.acervo, { texto: 'relatorio' }).length, 1);
    assert.equal(buscarMensagens(han.acervo, { texto: 'relatorio' }).length, 1);
  } finally {
    c.limpar();
  }
});

test('as contagens de cada Inquilino não somam as do outro', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    semearIgual(leia.acervo, 'leia');
    semearIgual(han.acervo, 'han');

    for (const acervo of [leia.acervo, han.acervo]) {
      const n = contarAcervo(acervo);
      assert.deepEqual(
        { conversas: n.conversas, mensagens: n.mensagens, identificadores: n.identificadores },
        { conversas: 1, mensagens: 1, identificadores: 1 },
      );
    }
  } finally {
    c.limpar();
  }
});

test('o mesmo endereço de origem em dois Inquilinos são Identificadores distintos', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    const naLeia = semearIgual(leia.acervo, 'leia');
    const noHan = semearIgual(han.acervo, 'han');

    assert.notEqual(
      naLeia.identificador,
      noHan.identificador,
      'mesmo número, Inquilinos diferentes: entidades distintas',
    );
  } finally {
    c.limpar();
  }
});

test('nenhuma Pessoa é compartilhada entre Inquilinos', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    const naLeia = semearIgual(leia.acervo, 'leia');
    const noHan = semearIgual(han.acervo, 'han');

    const pessoaNaLeia = criarPessoa(leia.acervo);
    vincularIdentificador(leia.acervo, {
      identificadorId: naLeia.identificador,
      pessoaId: pessoaNaLeia,
      procedencia: 'humano',
    });
    const pessoaNoHan = criarPessoa(han.acervo);
    vincularIdentificador(han.acervo, {
      identificadorId: noHan.identificador,
      pessoaId: pessoaNoHan,
      procedencia: 'humano',
    });

    assert.notEqual(pessoaNaLeia, pessoaNoHan);
    assert.equal(
      (leia.acervo.db.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number }).n,
      1,
    );
    assert.equal(
      (han.acervo.db.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number }).n,
      1,
    );
  } finally {
    c.limpar();
  }
});

test('a assinatura da consulta não admite dois Acervos — o isolamento é do tipo', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    semearIgual(leia.acervo, 'leia');
    semearIgual(han.acervo, 'han');

    // Cada função de consulta recebe UM Acervo. Não existe forma de pedir os
    // dois: nem sob flag, nem como opção. Este teste documenta o invariante e
    // falha se alguém acrescentar um caminho que aceite mais de um.
    assert.equal(listarConversas.length, 2, 'listarConversas(acervo, filtro)');
    assert.equal(lerMensagens.length, 2, 'lerMensagens(acervo, filtro)');
    assert.equal(buscarMensagens.length, 2, 'buscarMensagens(acervo, filtro)');
    assert.equal(contarAcervo.length, 1, 'contarAcervo(acervo)');
  } finally {
    c.limpar();
  }
});

test('mesclar num Inquilino não alcança Pessoa nem Identificador do outro', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    const naLeia = semearIgual(leia.acervo, 'leia');
    const noHan = semearIgual(han.acervo, 'han');

    const absorvidaNaLeia = criarPessoa(leia.acervo);
    const sobreviventeNaLeia = criarPessoa(leia.acervo);
    vincularIdentificador(leia.acervo, {
      identificadorId: naLeia.identificador,
      pessoaId: absorvidaNaLeia,
      procedencia: 'humano',
    });
    registrarNome(leia.acervo, { autoridade: 'terceiro',
      pessoaId: absorvidaNaLeia,
      origem: 'manual',
      nome: 'Chewbacca',
    });

    const pessoaNoHan = criarPessoa(han.acervo);
    vincularIdentificador(han.acervo, {
      identificadorId: noHan.identificador,
      pessoaId: pessoaNoHan,
      procedencia: 'humano',
    });

    mesclarPessoas(leia.acervo, {
      pessoaA: sobreviventeNaLeia,
      pessoaB: absorvidaNaLeia,
      mestreId: sobreviventeNaLeia,
    });

    // No Inquilino do Han nada mudou: nem a Pessoa dele foi absorvida, nem o
    // Identificador dele mudou de dono, nem o nome atravessou.
    assert.equal(lerVinculo(han.acervo, noHan.identificador)?.pessoaId, pessoaNoHan);
    assert.equal(contarAcervo(han.acervo).pessoas, 1);
    assert.equal(historicoDeNomes(han.acervo, pessoaNoHan).length, 0);
    const absorvidasNoHan = han.acervo.db
      .prepare('SELECT COUNT(*) AS n FROM pessoas WHERE absorvida_por IS NOT NULL')
      .get() as { n: number };
    assert.equal(absorvidasNoHan.n, 0);
  } finally {
    c.limpar();
  }
});

test('desvincular num Inquilino não registra desvínculo no outro', () => {
  const c = cenario();
  try {
    const leia = c.novoInquilino('Leia Organa');
    const han = c.novoInquilino('Han Solo');
    const naLeia = semearIgual(leia.acervo, 'leia');
    const noHan = semearIgual(han.acervo, 'han');

    for (const [acervo, ident] of [
      [leia.acervo, naLeia.identificador],
      [han.acervo, noHan.identificador],
    ] as const) {
      const p = criarPessoa(acervo);
      vincularIdentificador(acervo, {
        identificadorId: ident,
        pessoaId: p,
        procedencia: 'humano',
      });
    }

    desvincularIdentificador(leia.acervo, naLeia.identificador);

    assert.ok(lerVinculo(han.acervo, noHan.identificador), 'o vínculo do Han fica de pé');
    const noOutro = han.acervo.db.prepare('SELECT COUNT(*) AS n FROM desvinculos').get() as {
      n: number;
    };
    assert.equal(noOutro.n, 0);
  } finally {
    c.limpar();
  }
});
