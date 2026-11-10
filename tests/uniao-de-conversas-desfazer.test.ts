import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import {
  registrarAnexo,
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
} from '../src/nucleo/escrita.js';
import { registrarNome } from '../src/nucleo/identidade.js';
import { registrarEdicao } from '../src/nucleo/edicao.js';
import { registrarEnvio } from '../src/nucleo/envio.js';
import { desmarcarConversa, marcarConversa } from '../src/nucleo/marca-do-titular.js';
import { conferirSeDesfazivel, desfazerOperacao } from '../src/nucleo/desfazer.js';
import { emOperacao, lerOperacao, type Operacao } from '../src/nucleo/trilha.js';
import {
  levarMarcasDeConversa,
  moverMensagensDeConversa,
  registrarIdentificadorComEfeito,
  trocarEnderecoDeConversaDireta,
} from '../src/nucleo/uniao-de-conversas.js';

// #1440, Plano 1: o `desfazer` das quatro linhas da uniao. Cada uma volta SO enquanto o valor ainda e o que a Operacao gravou;
// os casos ficam ANTES do ramo generico da resolucao retroativa, que devolveria a Mensagem sem conferir.

const OPACO = '300000000000001@opaco.teste';
const NUMERO = '556500000001@numero.teste';
const OPACO_2 = '300000000000002@opaco.teste';
const NUMERO_2 = '556500000002@numero.teste';
const TERCEIRA = '556500000003@numero.teste';
const AGORA = 1_790_000_000_000;
const NATUREZA = 'unir-conversas-do-contato';

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

/** A Operacao da uniao como o Plano 2 a abre: sem transacao externa, uma transacao `immediate` por Conversa. */
function unir(acervo: Acervo, porConversa: Array<(op: Operacao) => void>): string {
  return emOperacao(acervo, { natureza: NATUREZA, reversibilidade: 'por-efeito', emTransacao: false }, (op) => {
    for (const passo of porConversa) acervo.db.transaction(() => passo(op)).immediate();
    return op.id;
  });
}

function direta(acervo: Acervo, endereco: string): string {
  return registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: endereco,
    coletiva: false,
    configuracao: CFG_WHATSAPP,
    bruto: JSON.stringify({ sintetico: endereco }),
  });
}

function mensagem(acervo: Acervo, conversaId: string, idExterno: string, ocorridaEm: number, autorId?: string): string {
  return registrarMensagem(acervo, {
    origemDaChegada: 'ao-vivo',
    direcao: autorId === undefined ? 'enviada' : 'recebida',
    conversaId,
    fonte: 'whatsapp',
    idExterno,
    ocorridaEm,
    agora: AGORA,
    conteudo: `texto sintetico ${idExterno}`,
    ...(autorId === undefined ? {} : { autorId }),
  });
}

const conversaDa = (acervo: Acervo, mensagemId: string): string =>
  (acervo.db.prepare('SELECT conversa_id FROM mensagens WHERE id = ?').get(mensagemId) as { conversa_id: string }).conversa_id;

const enderecoDa = (acervo: Acervo, conversaId: string): string =>
  (acervo.db.prepare('SELECT id_externo FROM conversas WHERE id = ?').get(conversaId) as { id_externo: string }).id_externo;

const TABELAS = [
  'conversas',
  'mensagens',
  'marcas_de_conversa',
  'identificadores',
  'participacoes',
  'chegadas',
  'anexos',
  'atribuicoes_de_nome',
  'edicoes',
  'envios',
];

/** O estado do Acervo, tabela por tabela, linha por linha (a linha inteira, em ordem estavel). */
function estado(acervo: Acervo): Record<string, string[]> {
  const saida: Record<string, string[]> = {};
  for (const t of TABELAS) {
    saida[t] = (acervo.db.prepare(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>)
      .map((l) => JSON.stringify(l))
      .sort();
  }
  return saida;
}

test('a Operacao da uniao e por-efeito e se desfaz; o desfazer devolve as Mensagens movidas', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const alvo = direta(acervo, NUMERO);
    const ids = [mensagem(acervo, opaca, 'o-1', AGORA - 3000), mensagem(acervo, opaca, 'o-2', AGORA - 2000)];
    const opId = unir(acervo, [(op) => void moverMensagensDeConversa(acervo, { de: opaca, para: alvo }, op)]);
    const vista = lerOperacao(acervo, opId)!;
    assert.equal(vista.natureza, NATUREZA);
    assert.equal(vista.reversibilidade, 'por-efeito');
    conferirSeDesfazivel(vista);

    const r = desfazerOperacao(acervo, opId);

    assert.equal(r.desfeitos, 2);
    assert.deepEqual(r.recusados, []);
    for (const id of ids) assert.equal(conversaDa(acervo, id), opaca);
  });
});

test('Mensagem movida de novo depois da Operacao: o desfazer RECUSA com a causa, e ela fica onde esta (nao o ramo generico)', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const alvo = direta(acervo, NUMERO);
    const terceira = direta(acervo, TERCEIRA);
    const fica = mensagem(acervo, opaca, 'o-1', AGORA - 3000);
    const muda = mensagem(acervo, opaca, 'o-2', AGORA - 2000);
    const opId = unir(acervo, [(op) => void moverMensagensDeConversa(acervo, { de: opaca, para: alvo }, op)]);
    acervo.db.prepare('UPDATE mensagens SET conversa_id = ? WHERE id = ?').run(terceira, muda);

    const r = desfazerOperacao(acervo, opId);

    assert.equal(r.desfeitos, 1);
    assert.equal(r.recusados.length, 1);
    assert.match(r.recusados[0]!.causa, /ja nao esta na Conversa que a Operacao gravou/);
    assert.equal(conversaDa(acervo, fica), opaca);
    assert.equal(conversaDa(acervo, muda), terceira, 'a Mensagem movida de novo NAO volta');
  });
});

test('a opaca apagada depois da uniao: o desfazer recusa Mensagem e marca com a causa, sem erro do banco', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const alvo = direta(acervo, NUMERO);
    const ids = [mensagem(acervo, opaca, 'o-1', AGORA - 3000), mensagem(acervo, opaca, 'o-2', AGORA - 2000)];
    marcarConversa(acervo, { conversaId: opaca, marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: AGORA });
    const opId = unir(acervo, [
      (op) => {
        moverMensagensDeConversa(acervo, { de: opaca, para: alvo }, op);
        levarMarcasDeConversa(acervo, { de: opaca, para: alvo }, op);
      },
    ]);
    acervo.db.prepare('DELETE FROM conversas WHERE id = ?').run(opaca);

    const r = desfazerOperacao(acervo, opId);

    assert.equal(r.desfeitos, 0);
    assert.equal(r.recusados.length, 3, 'duas Mensagens e uma marca');
    for (const recusa of r.recusados) assert.equal(recusa.causa, 'a Conversa de origem ja nao existe');
    for (const id of ids) assert.equal(conversaDa(acervo, id), alvo, 'as Mensagens ficam no alvo');
  });
});

test('marca levada: o desfazer a devolve; desmarcada no alvo ou de volta na origem, recusa e nada se perde', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const alvo = direta(acervo, NUMERO);
    const marca = { marca: 'fixada' as const, configuracaoId: CFG_WHATSAPP.id };
    const contar = (conversaId: string): number =>
      (acervo.db.prepare('SELECT COUNT(*) AS n FROM marcas_de_conversa WHERE conversa_id = ?').get(conversaId) as { n: number }).n;

    marcarConversa(acervo, { conversaId: opaca, ...marca, observadaEm: AGORA });
    const op1 = unir(acervo, [(op) => void levarMarcasDeConversa(acervo, { de: opaca, para: alvo }, op)]);
    assert.deepEqual([contar(opaca), contar(alvo)], [0, 1]);
    assert.deepEqual(desfazerOperacao(acervo, op1).recusados, []);
    assert.deepEqual([contar(opaca), contar(alvo)], [1, 0], 'devolvida');

    const op2 = unir(acervo, [(op) => void levarMarcasDeConversa(acervo, { de: opaca, para: alvo }, op)]);
    desmarcarConversa(acervo, { conversaId: alvo, ...marca, observadaEm: AGORA });
    const r2 = desfazerOperacao(acervo, op2);
    assert.equal(r2.desfeitos, 0);
    assert.match(r2.recusados[0]!.causa, /marca ja nao esta na Conversa que a Operacao gravou/);
    assert.deepEqual([contar(opaca), contar(alvo)], [0, 0]);

    marcarConversa(acervo, { conversaId: opaca, ...marca, observadaEm: AGORA });
    const op3 = unir(acervo, [(op) => void levarMarcasDeConversa(acervo, { de: opaca, para: alvo }, op)]);
    marcarConversa(acervo, { conversaId: opaca, ...marca, observadaEm: AGORA + 1 });
    const r3 = desfazerOperacao(acervo, op3);
    assert.match(r3.recusados[0]!.causa, /origem ja tem essa marca/);
    assert.deepEqual([contar(opaca), contar(alvo)], [1, 1], 'as duas ficam');
  });
});

test('endereco promovido: o desfazer o devolve; mudado depois, ou o antigo ocupado por outra Conversa, recusa', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const trocar = (op: Operacao): void => trocarEnderecoDeConversaDireta(acervo, { conversaId: opaca, de: OPACO, para: NUMERO }, op);

    const op1 = unir(acervo, [trocar]);
    assert.equal(enderecoDa(acervo, opaca), NUMERO);
    assert.deepEqual(desfazerOperacao(acervo, op1).recusados, []);
    assert.equal(enderecoDa(acervo, opaca), OPACO);

    const op2 = unir(acervo, [trocar]);
    acervo.db.prepare('UPDATE conversas SET id_externo = ? WHERE id = ?').run(TERCEIRA, opaca);
    const r2 = desfazerOperacao(acervo, op2);
    assert.match(r2.recusados[0]!.causa, /ja nao tem o endereco que a Operacao gravou/);
    assert.equal(enderecoDa(acervo, opaca), TERCEIRA);

    acervo.db.prepare('UPDATE conversas SET id_externo = ? WHERE id = ?').run(OPACO, opaca);
    const op3 = unir(acervo, [trocar]);
    const nova = direta(acervo, OPACO);
    const r3 = desfazerOperacao(acervo, op3);
    assert.match(r3.recusados[0]!.causa, /endereco anterior ja e de outra Conversa/);
    assert.equal(enderecoDa(acervo, opaca), NUMERO);
    assert.equal(enderecoDa(acervo, nova), OPACO);
  });
});

test('Identificador registrado: o desfazer o remove sem uso; com nome ganho depois, recusa e ele fica com o nome', () => {
  comAcervo((acervo) => {
    let id = '';
    const registrar = (op: Operacao): void => {
      id = registrarIdentificadorComEfeito(acervo, { fonte: 'whatsapp', valor: NUMERO }, op).id;
    };
    const op1 = unir(acervo, [registrar]);
    assert.deepEqual(desfazerOperacao(acervo, op1).recusados, []);
    assert.equal(acervo.db.prepare('SELECT 1 FROM identificadores WHERE id = ?').get(id), undefined);

    const op2 = unir(acervo, [registrar]);
    registrarNome(acervo, { identificadorId: id, origem: 'whatsapp', nome: 'Nome Sintetico', autoridade: 'terceiro' });
    const r2 = desfazerOperacao(acervo, op2);
    assert.match(r2.recusados[0]!.causa, /Identificador ja tem uso/);
    assert.ok(acervo.db.prepare('SELECT 1 FROM identificadores WHERE id = ?').get(id));
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome').get() as { n: number }).n, 1);
  });
});

test('ponta a ponta: mover e promover numa Operacao, e o desfazer devolve o estado inicial linha por linha', () => {
  comAcervo((acervo) => {
    // Contato 1: opaca com Mensagens, Participacao, Anexo e marca; alvo com Mensagens. Contato 2: so a opaca (promover).
    const opaca = direta(acervo, OPACO);
    const alvo = direta(acervo, NUMERO);
    const autor = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: OPACO }).id;
    registrarParticipacao(acervo, { conversaId: opaca, identificadorId: autor, observadaEm: new Date(AGORA).toISOString() });
    const m1 = mensagem(acervo, opaca, 'o-1', AGORA - 5000, autor);
    mensagem(acervo, opaca, 'o-2', AGORA - 4000);
    mensagem(acervo, alvo, 'n-1', AGORA - 4500);
    registrarAnexo(acervo, { origemDaChegada: 'ao-vivo', mensagemId: m1, tipo: 'imagem', presenca: 'nunca-obtido' });
    marcarConversa(acervo, { conversaId: opaca, marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: AGORA - 1 });
    const m2 = mensagem(acervo, opaca, 'o-3', AGORA - 3500, autor);
    registrarEdicao(acervo, {
      origemDaChegada: 'ao-vivo',
      mensagemId: m2,
      fonte: 'whatsapp',
      idExterno: 'edicao-1',
      texto: 'texto sintetico editado',
      editadaEm: AGORA - 3400,
      origem: 'aberta',
      bruto: JSON.stringify({ sintetico: 'edicao-1' }),
      agora: AGORA,
    });
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { conversaId: opaca },
      conteudo: { tipo: 'texto', texto: 'texto sintetico enviado' },
    });
    const opaca2 = direta(acervo, OPACO_2);
    mensagem(acervo, opaca2, 'p-1', AGORA - 3000);
    const inicial = estado(acervo);
    assert.equal(inicial['edicoes']!.length, 1);
    assert.equal(inicial['envios']!.length, 1);

    const opId = unir(acervo, [
      (op) => {
        moverMensagensDeConversa(acervo, { de: opaca, para: alvo }, op);
        levarMarcasDeConversa(acervo, { de: opaca, para: alvo }, op);
      },
      (op) => {
        registrarIdentificadorComEfeito(acervo, { fonte: 'whatsapp', valor: NUMERO_2 }, op);
        trocarEnderecoDeConversaDireta(acervo, { conversaId: opaca2, de: OPACO_2, para: NUMERO_2 }, op);
      },
    ]);
    const unido = estado(acervo);
    assert.notDeepEqual(unido, inicial);
    assert.deepEqual(unido['chegadas'], inicial['chegadas'], 'a uniao nao toca o Diario de Chegadas');
    assert.deepEqual(unido['edicoes'], inicial['edicoes'], 'a Edicao nao muda');
    assert.deepEqual(unido['envios'], inicial['envios'], 'o Envio continua apontando para a opaca');
    assert.equal(unido['conversas']!.length, inicial['conversas']!.length, 'nenhuma Conversa sai nem nasce');
    // 3 Mensagens + 1 marca + 1 Identificador + 1 endereco.
    assert.equal(lerOperacao(acervo, opId)!.linhas, 6);

    const r = desfazerOperacao(acervo, opId);

    assert.equal(r.desfeitos, 6);
    assert.deepEqual(r.recusados, []);
    assert.deepEqual(estado(acervo), inicial);
  });
});
