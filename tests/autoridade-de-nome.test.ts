import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  registrarNome,
  nomesDoIdentificador,
  nomeDoIdentificador,
} from '../src/nucleo/identidade.js';
import { PRECEDENCIA_PADRAO } from '../src/registro/precedencia-de-nome.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';

test('a Atribuicao guarda quem afirmou o nome', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990000@s.whatsapp.net',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'titular',
    });
    const nomes = nomesDoIdentificador(acervo, id);
    assert.equal(nomes.length, 1);
    assert.equal(nomes[0]?.autoridade, 'titular');
  } finally {
    c.limpar();
  }
});

// GUARDA DE VACUIDADE, a mesma de `chave-de-nome.test.ts`: se o escape virar
// string vazia, os dois testes abaixo comparam nomes IGUAIS e passam sem
// exercitar a normalizacao.
const LRE = '\u202A';
const PDF = '\u202C';

test('a fixture com marca e mesmo diferente da sem marca', () => {
  assert.notEqual(LRE + 'Ana Prado' + PDF, 'Ana Prado');
});

test('marca invisivel nao cria linha gemea', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990001@s.whatsapp.net',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'terceiro',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: LRE + 'Ana Prado' + PDF,
      autoridade: 'terceiro',
    });
    assert.equal(nomesDoIdentificador(acervo, id).length, 1);
  } finally {
    c.limpar();
  }
});

test('o texto GRAVADO continua sendo o que a Fonte entregou', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990002@s.whatsapp.net',
    });
    const comMarca = LRE + 'Ana Prado' + PDF;
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: comMarca,
      autoridade: 'terceiro',
    });
    assert.equal(nomesDoIdentificador(acervo, id)[0]?.nome, comMarca);
  } finally {
    c.limpar();
  }
});

test('indeterminado sobe para titular quando o material reafirma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990003@s.whatsapp.net',
    });
    // Linha como as anteriores ao ciclo 18: gravada quando nao havia campo.
    acervo.db
      .prepare(
        `INSERT INTO atribuicoes_de_nome
           (id, pessoa_id, identificador_id, origem, configuracao_id, nome,
            atribuido_em, ultimo_avistamento, autoridade)
         VALUES ('a1', NULL, ?, 'whatsapp', NULL, 'Ana Prado',
                 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`,
      )
      .run(id);

    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'titular',
    });

    const nomes = nomesDoIdentificador(acervo, id);
    assert.equal(nomes.length, 1, 'atualiza a linha, nao cria gemea');
    assert.equal(nomes[0]?.autoridade, 'titular');
  } finally {
    c.limpar();
  }
});

test('indeterminado tambem se resolve para terceiro — e isso NAO e rebaixamento', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990004@s.whatsapp.net',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'terceiro',
    });
    assert.equal(nomesDoIdentificador(acervo, id)[0]?.autoridade, 'terceiro',
                 'a linha nasceu declarada');

    // Rebaixa a mao para o estado das linhas antigas. WHERE por Identificador:
    // sem ele o UPDATE atinge o acervo inteiro do cenario.
    acervo.db
      .prepare('UPDATE atribuicoes_de_nome SET autoridade = NULL WHERE identificador_id = ?')
      .run(id);

    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'terceiro',
    });
    assert.equal(nomesDoIdentificador(acervo, id)[0]?.autoridade, 'terceiro');
  } finally {
    c.limpar();
  }
});

test('titular NUNCA desce para terceiro', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990005@s.whatsapp.net',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'titular',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'terceiro',
    });
    assert.equal(nomesDoIdentificador(acervo, id)[0]?.autoridade, 'titular');
  } finally {
    c.limpar();
  }
});

test('subir a Autoridade grava efeito na trilha, com antes e depois', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990009@s.whatsapp.net',
    });
    acervo.db
      .prepare(
        `INSERT INTO atribuicoes_de_nome
           (id, pessoa_id, identificador_id, origem, configuracao_id, nome,
            atribuido_em, ultimo_avistamento, autoridade)
         VALUES ('a9', NULL, ?, 'whatsapp', NULL, 'Ana Prado',
                 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`,
      )
      .run(id);

    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'titular',
    });

    const op = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'registrar-nome')[0];
    assert.ok(op !== undefined, 'a Operacao existe');
    const linhas = linhasDaOperacao(acervo, op.id).filter((l) => l.campo === 'autoridade');
    assert.equal(linhas.length, 1, 'a subida e escrita que a trilha tem de registrar');
    assert.equal(linhas[0]?.antes, null);
    assert.equal(linhas[0]?.depois, 'titular');
  } finally {
    c.limpar();
  }
});

test('reavistamento PURO nao grava efeito — so a subida grava', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990010@s.whatsapp.net',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'titular',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'titular',
    });

    const op = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'registrar-nome')[0];
    assert.ok(op !== undefined);
    assert.equal(linhasDaOperacao(acervo, op.id).length, 0);
  } finally {
    c.limpar();
  }
});

const PRECEDENCIA = { porOrigem: PRECEDENCIA_PADRAO, catalogoPreferido: null };

test('titular vence terceiro dentro da mesma Fonte, mesmo sendo mais antigo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990006@s.whatsapp.net',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Prado',
      autoridade: 'titular',
      atribuidoEm: '2020-01-01T00:00:00.000Z',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: '+55 11 99999-0006',
      autoridade: 'terceiro',
      atribuidoEm: '2026-09-01T00:00:00.000Z',
    });
    assert.equal(nomeDoIdentificador(acervo, id, PRECEDENCIA), 'Ana Prado');
  } finally {
    c.limpar();
  }
});

test('a Autoridade NAO atravessa Fonte: terceiro de contatos vence titular de whatsapp', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990007@s.whatsapp.net',
    });
    // AS DATAS SAO O QUE DA PODER A ESTE TESTE. A lista chega ordenada por
    // instante DESC, entao o `contatos` (mais recente) e visto primeiro e o
    // `whatsapp` depois — que e a unica ordem em que o nivel 3 chega a ser
    // avaliado contra um vencedor de peso maior. Sem data explicita os dois
    // podem cair no mesmo milissegundo, a ordem fica indefinida, e o teste
    // passa sem exercitar a guarda de peso.
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana W',
      autoridade: 'titular',
      atribuidoEm: '2020-01-01T00:00:00.000Z',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'contatos',
      nome: 'Ana C',
      autoridade: 'terceiro',
      configuracaoId: 'cfg-1',
      atribuidoEm: '2026-09-01T00:00:00.000Z',
    });
    assert.equal(nomeDoIdentificador(acervo, id, PRECEDENCIA), 'Ana C');
  } finally {
    c.limpar();
  }
});

test('entre autoridades IGUAIS a recencia continua decidindo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '551199990011@s.whatsapp.net',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Antiga',
      autoridade: 'terceiro',
      atribuidoEm: '2020-01-01T00:00:00.000Z',
    });
    registrarNome(acervo, {
      identificadorId: id,
      origem: 'whatsapp',
      nome: 'Ana Recente',
      autoridade: 'terceiro',
      atribuidoEm: '2026-09-01T00:00:00.000Z',
    });
    // A Autoridade e o TERCEIRO criterio, nao o unico: empatada, quem decide
    // continua sendo o instante. E este teste que impede o desempate de virar
    // maior-ou-igual, que faria a mais antiga tomar o lugar da mais recente.
    assert.equal(nomeDoIdentificador(acervo, id, PRECEDENCIA), 'Ana Recente');
  } finally {
    c.limpar();
  }
});
