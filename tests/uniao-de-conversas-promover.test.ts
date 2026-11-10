import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP, CFG_WHATSAPP_SEGUNDA } from './ajuda/configuracao.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import {
  registrarCartaoDeCatalogo,
  registrarConversa,
  registrarEtiqueta,
  registrarIdentificador,
  registrarMensagem,
  registrarParticipacao,
  registrarTransicao,
} from '../src/nucleo/escrita.js';
import { registrarChegada } from '../src/nucleo/chegada.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { criarPessoa, registrarNome, vincularIdentificador } from '../src/nucleo/identidade.js';
import { emOperacao, linhasDaOperacao, type Operacao } from '../src/nucleo/trilha.js';
import {
  EnderecoDeConversaOcupadoError,
  registrarIdentificadorComEfeito,
  removerIdentificadorSemUso,
  trocarEnderecoDeConversaDireta,
} from '../src/nucleo/uniao-de-conversas.js';

// #1440, Plano 1: promover a opaca (trocar o endereco, registrar o Identificador do numero) e a remocao sem uso do desfazer.

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
  return registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: endereco,
    coletiva: false,
    configuracao: cfg,
    bruto: JSON.stringify({ sintetico: endereco }),
  });
}

const conversa = (acervo: Acervo, id: string): Record<string, unknown> =>
  acervo.db.prepare('SELECT * FROM conversas WHERE id = ?').get(id) as Record<string, unknown>;

test('troca o endereco da Conversa direta; o id e o Conteudo Bruto ficam; uma linha de efeito', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    const antes = conversa(acervo, opaca);

    const { opId } = naOperacao(acervo, (op) =>
      trocarEnderecoDeConversaDireta(acervo, { conversaId: opaca, de: OPACO, para: NUMERO }, op),
    );

    assert.deepEqual(conversa(acervo, opaca), { ...antes, id_externo: NUMERO });
    assert.deepEqual(linhasDaOperacao(acervo, opId), [
      { natureza: 'valor', tabela: 'conversas', chave: opaca, campo: 'id_externo', antes: OPACO, depois: NUMERO },
    ]);
  });
});

test('endereco ocupado na mesma Configuracao: EnderecoDeConversaOcupadoError (nunca o erro do indice), sem escrever', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    direta(acervo, NUMERO);
    const antes = conversa(acervo, opaca);
    let erro: unknown;
    try {
      naOperacao(acervo, (op) => trocarEnderecoDeConversaDireta(acervo, { conversaId: opaca, de: OPACO, para: NUMERO }, op));
    } catch (e) {
      erro = e;
    }
    assert.ok(erro instanceof EnderecoDeConversaOcupadoError, `erro nomeado, veio ${String(erro)}`);
    assert.equal(erro.conversaId, opaca);
    assert.equal(erro.endereco, NUMERO);
    assert.deepEqual(conversa(acervo, opaca), antes);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM linhas_de_efeito').get() as { n: number }).n, 0);
  });
});

test('o mesmo endereco em OUTRA Configuracao nao ocupa; endereco atual diferente de `de` e coletiva sao recusados', () => {
  comAcervo((acervo) => {
    const opaca = direta(acervo, OPACO);
    direta(acervo, NUMERO, CFG_WHATSAPP_SEGUNDA);
    naOperacao(acervo, (op) => trocarEnderecoDeConversaDireta(acervo, { conversaId: opaca, de: OPACO, para: NUMERO }, op));
    assert.equal(conversa(acervo, opaca)['id_externo'], NUMERO);

    assert.throws(
      () => naOperacao(acervo, (op) => trocarEnderecoDeConversaDireta(acervo, { conversaId: opaca, de: OPACO, para: 'x' }, op)),
      RangeError,
    );
    const coletiva = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000009@grupo.teste', coletiva: true });
    assert.throws(
      () =>
        naOperacao(acervo, (op) =>
          trocarEnderecoDeConversaDireta(acervo, { conversaId: coletiva, de: '120363000000000009@grupo.teste', para: 'y' }, op),
        ),
      RangeError,
    );
  });
});

test('promover so para a forma CANONICA: a forma alternativa de um par gravado e recusada, sem escrever', () => {
  comAcervo((acervo) => {
    const ALTERNATIVO = '55650000001@numero.teste';
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: ALTERNATIVO, canonico: NUMERO });
    const opaca = direta(acervo, OPACO);
    const antes = conversa(acervo, opaca);
    assert.throws(
      () =>
        naOperacao(acervo, (op) => trocarEnderecoDeConversaDireta(acervo, { conversaId: opaca, de: OPACO, para: ALTERNATIVO }, op)),
      /nao e a forma canonica/,
    );
    assert.deepEqual(conversa(acervo, opaca), antes);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM linhas_de_efeito').get() as { n: number }).n, 0);
    naOperacao(acervo, (op) => trocarEnderecoDeConversaDireta(acervo, { conversaId: opaca, de: OPACO, para: NUMERO }, op));
    assert.equal(conversa(acervo, opaca)['id_externo'], NUMERO, 'o canonico passa');
  });
});

test('registrarIdentificadorComEfeito cria sem Pessoa e sem nome, relata so o que criou, e e idempotente', () => {
  comAcervo((acervo) => {
    const ja = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: OPACO });
    const { opId, valor } = naOperacao(acervo, (op) => [
      registrarIdentificadorComEfeito(acervo, { fonte: 'whatsapp', valor: NUMERO }, op),
      registrarIdentificadorComEfeito(acervo, { fonte: 'whatsapp', valor: NUMERO }, op),
      registrarIdentificadorComEfeito(acervo, { fonte: 'whatsapp', valor: OPACO }, op),
    ]);
    const [criado, repetido, existente] = valor;
    assert.equal(criado!.criado, true);
    assert.deepEqual(repetido, { id: criado!.id, criado: false });
    assert.deepEqual(existente, { id: ja.id, criado: false });
    const linha = acervo.db.prepare('SELECT pessoa_id, procedencia, valor FROM identificadores WHERE id = ?').get(criado!.id);
    assert.deepEqual(linha, { pessoa_id: null, procedencia: null, valor: NUMERO });
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome').get() as { n: number }).n, 0);
    assert.deepEqual(linhasDaOperacao(acervo, opId), [
      { natureza: 'valor', tabela: 'identificadores', chave: criado!.id, campo: 'id', antes: null, depois: criado!.id },
    ]);
  });
});

test('removerIdentificadorSemUso: remove o que nada referencia; ja-nao-existe depois', () => {
  comAcervo((acervo) => {
    const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: NUMERO });
    assert.equal(removerIdentificadorSemUso(acervo, id), 'removido');
    assert.equal(acervo.db.prepare('SELECT 1 FROM identificadores WHERE id = ?').get(id), undefined);
    assert.equal(removerIdentificadorSemUso(acervo, id), 'ja-nao-existe');
  });
});

/** Cada uso que prende o Identificador, e a contagem que prova que o uso continua de pe depois da recusa. */
const USOS: Array<{ nome: string; usar: (acervo: Acervo, id: string) => void; contar: string }> = [
  {
    nome: 'Pessoa',
    usar: (acervo, id) => vincularIdentificador(acervo, { identificadorId: id, pessoaId: criarPessoa(acervo), procedencia: 'humano' }),
    contar: 'SELECT COUNT(*) AS n FROM identificadores WHERE id = ? AND pessoa_id IS NOT NULL',
  },
  {
    nome: 'nome',
    usar: (acervo, id) => registrarNome(acervo, { identificadorId: id, origem: 'whatsapp', nome: 'Nome Sintetico', autoridade: 'terceiro' }),
    contar: 'SELECT COUNT(*) AS n FROM atribuicoes_de_nome WHERE identificador_id = ?',
  },
  {
    nome: 'Participacao',
    usar: (acervo, id) =>
      registrarParticipacao(acervo, { conversaId: direta(acervo, OPACO), identificadorId: id, observadaEm: new Date(AGORA).toISOString() }),
    contar: 'SELECT COUNT(*) AS n FROM participacoes WHERE identificador_id = ?',
  },
  {
    nome: 'autor de Mensagem',
    usar: (acervo, id) =>
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        direcao: 'recebida',
        conversaId: direta(acervo, OPACO),
        fonte: 'whatsapp',
        idExterno: 'm-autor',
        ocorridaEm: AGORA - 1000,
        agora: AGORA,
        autorId: id,
      }),
    contar: 'SELECT COUNT(*) AS n FROM mensagens WHERE autor_id = ?',
  },
  {
    nome: 'autor da citada',
    usar: (acervo, id) =>
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        direcao: 'enviada',
        conversaId: direta(acervo, OPACO),
        fonte: 'whatsapp',
        idExterno: 'm-cita',
        ocorridaEm: AGORA - 1000,
        agora: AGORA,
        citacao: { idExterno: 'm-citada-ausente', autorId: id, direcao: 'recebida' },
      }),
    contar: 'SELECT COUNT(*) AS n FROM mensagens WHERE citada_autor_id = ?',
  },
  {
    nome: 'cartao de catalogo',
    usar: (acervo, id) => registrarCartaoDeCatalogo(acervo, id, 'cartao-sintetico', 'cfg-teste-contatos', new Date(AGORA).toISOString()),
    contar: 'SELECT COUNT(*) AS n FROM cartoes_de_catalogo WHERE identificador_id = ?',
  },
  {
    nome: 'Transicao',
    usar: (acervo, id) =>
      registrarTransicao(acervo, {
        origemDaChegada: 'importacao',
        conversaId: registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@grupo.teste', coletiva: true }),
        identificadorId: id,
        natureza: 'entrou',
        ocorridaEm: AGORA - 1000,
        fonte: 'whatsapp',
        idExterno: 't-1',
        codigoDaFonte: 'sintetico',
      }),
    contar: 'SELECT COUNT(*) AS n FROM transicoes_de_participacao WHERE identificador_id = ?',
  },
  {
    nome: 'Etiqueta',
    usar: (acervo, id) =>
      registrarEtiqueta(acervo, {
        origemDaChegada: 'importacao',
        conversaId: registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000002@grupo.teste', coletiva: true }),
        identificadorId: id,
        texto: 'etiqueta sintetica',
        ocorridaEm: AGORA - 1000,
        fonte: 'whatsapp',
        idExterno: 'e-1',
      }),
    contar: 'SELECT COUNT(*) AS n FROM etiquetas_de_participacao WHERE identificador_id = ?',
  },
  {
    // A Mensagem do numero saiu (Retencao, por exemplo) e a Chegada dela ficou: `chegadas.autor_id` nao tem chave estrangeira.
    nome: 'autor de Chegada',
    usar: (acervo, id) =>
      void registrarChegada(acervo, {
        tipo: 'mensagem',
        origem: 'ao-vivo',
        criadoEm: AGORA,
        ocorridaEm: AGORA - 1000,
        autorId: id,
        alvoId: 'mensagem-que-ja-saiu',
      }),
    contar: 'SELECT COUNT(*) AS n FROM chegadas WHERE autor_id = ?',
  },
];

for (const uso of USOS) {
  test(`removerIdentificadorSemUso recusa (em-uso) com ${uso.nome}, e o uso fica de pe`, () => {
    comAcervo((acervo) => {
      const { id } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: NUMERO });
      uso.usar(acervo, id);
      // Isola o uso: a Mensagem, a Transicao e a Etiqueta tambem gravam Chegada com o autor, e sem isto o NOT EXISTS de
      // `chegadas` prenderia o Identificador sozinho, escondendo a falta do NOT EXISTS da tabela medida.
      if (uso.nome !== 'autor de Chegada') acervo.db.prepare('DELETE FROM chegadas WHERE autor_id = ?').run(id);
      const antes = (acervo.db.prepare(uso.contar).get(id) as { n: number }).n;
      assert.ok(antes > 0, 'o uso existe');
      assert.equal(removerIdentificadorSemUso(acervo, id), 'em-uso');
      assert.ok(acervo.db.prepare('SELECT 1 FROM identificadores WHERE id = ?').get(id), 'o Identificador fica');
      assert.equal((acervo.db.prepare(uso.contar).get(id) as { n: number }).n, antes, 'o uso fica');
    });
  });
}
