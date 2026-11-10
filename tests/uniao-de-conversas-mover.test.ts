import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import {
  registrarAnexo,
  registrarConversa,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
} from '../src/nucleo/escrita.js';
import { registrarEdicao } from '../src/nucleo/edicao.js';
import { marcarConversa } from '../src/nucleo/marca-do-titular.js';
import { emOperacao, linhasDaOperacao, type Operacao } from '../src/nucleo/trilha.js';
import { levarMarcasDeConversa, moverMensagensDeConversa } from '../src/nucleo/uniao-de-conversas.js';

// #1440, Plano 1: mover as Mensagens da Conversa opaca para a do numero, e levar a marca. So a Conversa da Mensagem muda.

const OPACO = '300000000000001@opaco.teste';
const NUMERO = '556500000001@numero.teste';
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

function naOperacao<T>(acervo: Acervo, corpo: (op: Operacao) => T): { opId: string; valor: T } {
  let valor: T | undefined;
  const opId = emOperacao(acervo, { natureza: NATUREZA, reversibilidade: 'por-efeito', emTransacao: false }, (op) => {
    valor = acervo.db.transaction(() => corpo(op)).immediate();
    return op.id;
  });
  return { opId, valor: valor as T };
}

function direta(acervo: Acervo, endereco: string, cfg: { id: string; fonte: 'whatsapp' } = CFG_WHATSAPP): string {
  return registrarConversa(acervo, { fonte: 'whatsapp', idExterno: endereco, coletiva: false, configuracao: cfg });
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
    bruto: JSON.stringify({ sintetico: idExterno }),
    ...(autorId === undefined ? {} : { autorId }),
  });
}

/** Cada linha da tabela, por chave primaria, com as colunas dadas de fora. */
function linhas(acervo: Acervo, tabela: string, chave: string, fora: string[] = []): Map<string, string> {
  const saida = new Map<string, string>();
  for (const l of acervo.db.prepare(`SELECT * FROM ${tabela}`).all() as Array<Record<string, unknown>>) {
    const copia = { ...l };
    for (const c of fora) delete copia[c];
    saida.set(String(l[chave]), JSON.stringify(copia));
  }
  return saida;
}

const contar = (acervo: Acervo, conversaId: string): number =>
  (acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens WHERE conversa_id = ?').get(conversaId) as { n: number }).n;

test('move TODAS as Mensagens da opaca para o alvo; em cada uma so a Conversa muda; uma linha de efeito por Mensagem', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const alvo = direta(acervo, NUMERO);
    const autor = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: OPACO }).id;
    registrarParticipacao(acervo, { conversaId: opaca, identificadorId: autor, observadaEm: new Date(AGORA).toISOString() });
    const movidas = [
      mensagem(acervo, opaca, 'o-1', AGORA - 5000, autor),
      mensagem(acervo, opaca, 'o-2', AGORA - 3000),
      mensagem(acervo, opaca, 'o-3', AGORA - 1000, autor),
    ];
    mensagem(acervo, alvo, 'n-1', AGORA - 4000);
    mensagem(acervo, alvo, 'n-2', AGORA - 2000);
    registrarAnexo(acervo, { origemDaChegada: 'ao-vivo', mensagemId: movidas[0]!, tipo: 'imagem', presenca: 'nunca-obtido' });
    registrarEdicao(acervo, {
      origemDaChegada: 'ao-vivo',
      mensagemId: movidas[1]!,
      fonte: 'whatsapp',
      idExterno: 'edicao-1',
      texto: 'texto sintetico editado',
      editadaEm: AGORA - 2500,
      origem: 'aberta',
      bruto: JSON.stringify({ sintetico: 'edicao-1' }),
      agora: AGORA,
    });
    const edicoesAntes = linhas(acervo, 'edicoes', 'id');
    assert.equal(edicoesAntes.size, 1);
    const mensagensAntes = linhas(acervo, 'mensagens', 'id', ['conversa_id']);
    const anexosAntes = linhas(acervo, 'anexos', 'id');
    const chegadasAntes = linhas(acervo, 'chegadas', 'seq');
    const participacoesAntes = linhas(acervo, 'participacoes', 'conversa_id');

    const { opId, valor } = naOperacao(acervo, (op) => moverMensagensDeConversa(acervo, { de: opaca, para: alvo }, op));

    assert.equal(valor, 3);
    assert.equal(contar(acervo, alvo), 5);
    assert.equal(contar(acervo, opaca), 0);
    assert.deepEqual(linhas(acervo, 'mensagens', 'id', ['conversa_id']), mensagensAntes, 'so a Conversa muda');
    assert.deepEqual(linhas(acervo, 'anexos', 'id'), anexosAntes);
    assert.deepEqual(linhas(acervo, 'edicoes', 'id'), edicoesAntes, 'a Edicao pende da Mensagem e nao muda');
    assert.deepEqual(linhas(acervo, 'chegadas', 'seq'), chegadasAntes, 'nenhuma Chegada nova nem reescrita');
    assert.deepEqual(linhas(acervo, 'participacoes', 'conversa_id'), participacoesAntes, 'as Participacoes ficam na opaca');
    assert.ok(acervo.db.prepare('SELECT 1 FROM conversas WHERE id = ?').get(opaca), 'a opaca fica');
    assert.deepEqual(
      linhasDaOperacao(acervo, opId),
      [...movidas].sort().map((id) => ({
        natureza: 'valor',
        tabela: 'mensagens',
        chave: id,
        campo: 'conversa_id',
        antes: opaca,
        depois: alvo,
      })),
    );
  });
});

test('opaca vazia: move zero e nao relata nada', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const alvo = direta(acervo, NUMERO);
    const { opId, valor } = naOperacao(acervo, (op) => moverMensagensDeConversa(acervo, { de: opaca, para: alvo }, op));
    assert.equal(valor, 0);
    assert.deepEqual(linhasDaOperacao(acervo, opId), []);
  });
});

test('recusa mover entre Configuracoes, para coletiva, para si mesma e de Conversa inexistente, sem escrever', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const outraCfg = direta(acervo, NUMERO, CFG_WHATSAPP_SEGUNDA);
    const coletiva = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000009@grupo.teste', coletiva: true });
    mensagem(acervo, opaca, 'o-1', AGORA - 1000);
    for (const para of [outraCfg, coletiva, opaca, 'conversa-que-nao-existe']) {
      assert.throws(
        () => naOperacao(acervo, (op) => moverMensagensDeConversa(acervo, { de: opaca, para }, op)),
        RangeError,
        `para ${para}`,
      );
    }
    assert.equal(contar(acervo, opaca), 1);
    assert.equal(
      (acervo.db.prepare('SELECT COUNT(*) AS n FROM linhas_de_efeito').get() as { n: number }).n,
      0,
      'nenhuma linha de efeito',
    );
  });
});

test('leva a marca de fixada so quando o alvo nao a tem; quando tem, a do alvo vale e a da opaca fica', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const alvo = direta(acervo, NUMERO);
    marcarConversa(acervo, { conversaId: opaca, marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: AGORA - 10 });

    const { opId, valor } = naOperacao(acervo, (op) => levarMarcasDeConversa(acervo, { de: opaca, para: alvo }, op));

    assert.equal(valor, 1);
    const marcas = acervo.db
      .prepare('SELECT conversa_id, marca, configuracao_id, observada_em FROM marcas_de_conversa ORDER BY conversa_id')
      .all();
    assert.deepEqual(marcas, [{ conversa_id: alvo, marca: 'fixada', configuracao_id: CFG_WHATSAPP.id, observada_em: AGORA - 10 }]);
    assert.deepEqual(linhasDaOperacao(acervo, opId), [
      {
        natureza: 'valor',
        tabela: 'marcas_de_conversa',
        chave: JSON.stringify([alvo, 'fixada', CFG_WHATSAPP.id]),
        campo: 'conversa_id',
        antes: opaca,
        depois: alvo,
      },
    ]);

    // O alvo ja tem a marca: a da opaca (marcada de novo) fica onde esta.
    marcarConversa(acervo, { conversaId: opaca, marca: 'fixada', configuracaoId: CFG_WHATSAPP.id, observadaEm: AGORA });
    const segunda = naOperacao(acervo, (op) => levarMarcasDeConversa(acervo, { de: opaca, para: alvo }, op));
    assert.equal(segunda.valor, 0);
    assert.deepEqual(linhasDaOperacao(acervo, segunda.opId), []);
    assert.equal(
      (acervo.db.prepare('SELECT COUNT(*) AS n FROM marcas_de_conversa').get() as { n: number }).n,
      2,
      'nada sai do Acervo',
    );
  });
});
