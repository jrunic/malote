import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import {
  conferirTransicoes,
  conferirTransicoesEmDuasFormas,
  conferirTransicoesRepetidas,
} from '../src/nucleo/integridade.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import {
  registrarConversa,
  registrarIdentificador,
  registrarTransicao,
} from '../src/nucleo/escrita.js';

/** Conversa coletiva com um Identificador — o mínimo para uma Transição. */
function coletivaCom(acervo: Acervo, endereco: string) {
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'grupo-1@g.us',
    coletiva: true,
  });
  const { id: identificadorId } = registrarIdentificador(acervo, {
    fonte: 'whatsapp',
    valor: endereco,
  });
  return { conversaId, identificadorId };
}

test('registrar uma Transição a guarda com o instante que a Fonte declarou', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { conversaId, identificadorId } = coletivaCom(acervo, '5565911111');

    const nasceu = registrarTransicao(acervo, {
      conversaId,
      identificadorId,
      natureza: 'saiu',
      ocorridaEm: 1_600_000_000_000,
      fonte: 'whatsapp',
      idExterno: 'stanza-A',
      codigoDaFonte: '7',
    });

    assert.equal(nasceu, true, 'a linha nasceu nesta chamada');
    const linha = acervo.db
      .prepare('SELECT natureza, ocorrida_em, codigo_da_fonte FROM transicoes_de_participacao')
      .get() as { natureza: string; ocorrida_em: number; codigo_da_fonte: string };
    assert.equal(linha.natureza, 'saiu');
    assert.equal(linha.ocorrida_em, 1_600_000_000_000, 'o instante é o da Fonte, não o de agora');
    assert.equal(linha.codigo_da_fonte, '7', 'o código bruto sobrevive à classificação');
  } finally {
    c.limpar();
  }
});

test('registrar a MESMA Transição duas vezes não duplica, e o retorno diz isso', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { conversaId, identificadorId } = coletivaCom(acervo, '5565922222');
    const entrada = {
      conversaId,
      identificadorId,
      natureza: 'saiu' as const,
      ocorridaEm: 1_600_000_000_000,
      fonte: 'whatsapp' as const,
      idExterno: 'stanza-B',
      codigoDaFonte: '7',
    };

    assert.equal(registrarTransicao(acervo, entrada), true);
    assert.equal(
      registrarTransicao(acervo, entrada),
      false,
      'a segunda chamada NÃO criou nada — quem conta por chamada mentiria aqui',
    );

    const n = acervo.db.prepare('SELECT COUNT(*) n FROM transicoes_de_participacao').get() as {
      n: number;
    };
    assert.equal(n.n, 1, 'reimportar reencontra a linha, não cria outra');
  } finally {
    c.limpar();
  }
});

test('a Transição NÃO toca a Participação — as duas coexistem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const { conversaId, identificadorId } = coletivaCom(acervo, '5565933333');

    registrarTransicao(acervo, {
      conversaId,
      identificadorId,
      natureza: 'saiu',
      ocorridaEm: 1_600_000_000_000,
      fonte: 'whatsapp',
      idExterno: 'stanza-C',
      codigoDaFonte: '7',
    });

    const p = acervo.db.prepare('SELECT COUNT(*) n FROM participacoes').get() as { n: number };
    assert.equal(p.n, 0, 'registrar Transição não fabrica Participação');
  } finally {
    c.limpar();
  }
});

test('o detector acha Transição com instante impossível', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    const { conversaId, identificadorId } = coletivaCom(acervo, '5565988888');
    registrarTransicao(acervo, {
      conversaId,
      identificadorId,
      natureza: 'saiu',
      ocorridaEm: 1_600_000_000_000,
      fonte: 'whatsapp',
      idExterno: 'stanza-D',
      codigoDaFonte: '7',
    });

    assert.equal(conferirTransicoes(acervo).length, 0, 'acervo íntegro não acusa nada');

    // Zero é o sinal de data fabricada: nenhuma Fonte declara epoch.
    acervo.db.prepare('UPDATE transicoes_de_participacao SET ocorrida_em = 0').run();
    assert.equal(conferirTransicoes(acervo).length, 1, 'instante impossível é achado');
  } finally {
    c.limpar();
  }
});

test('a conferencia conta Transicao repetida sob identificadores de evento diferentes', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Mon Mothma');
    // O MESMO evento do mundo, visto por dois caminhos que o nomeiam de formas
    // diferentes. Medido em 02/09/2026: o identificador de evento
    // administrativo NAO converge entre a recepcao ao vivo e o material
    // exportado — 20 caracteres maiusculos la, 9 ou 10 minusculos aqui — e a
    // ponte que decidiria a questao nao e mensuravel: ha 3 eventos de
    // sobreposicao entre as duas fontes.
    //
    // Este detector e o que transforma uma assuncao nao verificavel numa
    // medicao futura: hoje ele responde zero, e no dia do primeiro backup
    // posterior ele responde o numero com que a troca da chave se decide.
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '120363000000000002@g.us',
      coletiva: true,
      bruto: '{}',
    });
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565911110002@s.whatsapp.net',
    });
    const comum = {
      conversaId,
      identificadorId: id,
      natureza: 'entrou' as const,
      fonte: 'whatsapp' as const,
    };
    const instante = Date.parse('2026-05-01T10:00:00Z');
    registrarTransicao(acervo, {
      ...comum,
      ocorridaEm: instante,
      idExterno: 'ao-vivo-1',
      codigoDaFonte: 'GROUP_PARTICIPANT_ADD',
    });
    // 693 ms de diferenca: o material guarda o instante num numero de ponto
    // flutuante, e 1.105 dos 16.041 eventos administrativos reais — 6,9% — tem
    // fracao de segundo. Agrupar pelo milissegundo deixaria o detector cego
    // justamente neles, e detector que responde zero com a duplicacao presente
    // e pior que nenhum: autoriza a conclusao errada.
    registrarTransicao(acervo, {
      ...comum,
      ocorridaEm: instante + 693,
      idExterno: 'DOMATERIAL0000000001',
      codigoDaFonte: '15',
    });

    assert.equal(conferirTransicoesRepetidas(acervo), 1);
  } finally {
    c.limpar();
  }
});

test('Transicoes distintas no mesmo segundo NAO sao contadas como repetidas', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Cassian');
    // Duas pessoas entrando no mesmo evento e o caso normal — ocorreu na
    // captura. Sem esta guarda, o detector acusaria todo evento com mais de um
    // membro, e o numero que ele produz deixaria de significar coisa alguma.
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '120363000000000003@g.us',
      coletiva: true,
      bruto: '{}',
    });
    const a = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110003@s.whatsapp.net' });
    const b = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565911110004@s.whatsapp.net' });
    const instante = Date.parse('2026-05-01T10:00:00Z');
    for (const quem of [a, b]) {
      registrarTransicao(acervo, {
        conversaId,
        identificadorId: quem.id,
        natureza: 'entrou',
        fonte: 'whatsapp',
        ocorridaEm: instante,
        idExterno: 'mesmo-evento',
        codigoDaFonte: 'GROUP_PARTICIPANT_ADD',
      });
    }
    assert.equal(conferirTransicoesRepetidas(acervo), 0);
  } finally {
    c.limpar();
  }
});

test('a conferencia enxerga a mesma pessoa registrada nas duas formas de endereco', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Cham');
    // O segundo angulo da duplicacao, e o primeiro detector NAO o enxerga: la o
    // identificador e igual e o evento difere; aqui o evento e igual e o
    // identificador difere, e a chave de unicidade inclui o identificador.
    //
    // A causa nao e reordenavel dentro do produto: um evento recebido as 10h
    // com o endereco ainda desconhecido grava a forma alternativa, e a
    // correspondencia que chega as 11h nao volta atras.
    const ALTERNATIVA = '109876543211000@lid';
    const TELEFONE = '5565911111000@s.whatsapp.net';
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '120363000000000004@g.us',
      coletiva: true,
      bruto: '{}',
    });
    const antes = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: ALTERNATIVA });
    const depois = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: TELEFONE });
    const comum = {
      conversaId,
      natureza: 'entrou' as const,
      fonte: 'whatsapp' as const,
      ocorridaEm: Date.parse('2026-05-01T10:00:00Z'),
      idExterno: 'evento-unico',
      codigoDaFonte: 'GROUP_PARTICIPANT_ADD',
    };
    registrarTransicao(acervo, { ...comum, identificadorId: antes.id });
    registrarTransicao(acervo, { ...comum, identificadorId: depois.id });

    // Sem a correspondencia, o produto NAO tem como saber que sao a mesma
    // pessoa — e o detector nao pode inventar o que nao lhe disseram.
    assert.equal(conferirTransicoesEmDuasFormas(acervo), 0, 'sem correspondencia, nao ha o que ligar');

    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: ALTERNATIVA,
      canonico: TELEFONE,
    });
    assert.equal(conferirTransicoesEmDuasFormas(acervo), 1);
    // E o primeiro detector continua cego a este caso, que e por que os dois
    // existem.
    assert.equal(conferirTransicoesRepetidas(acervo), 0);
  } finally {
    c.limpar();
  }
});
