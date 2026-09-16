import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { descartarAnexo, registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  lerVinculo,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import {
  desfazerOperacao,
  OperacaoIrreversivelError,
  OperacaoJaDesfeitaError,
} from '../src/nucleo/desfazer.js';
import { lerOperacao, listarOperacoes } from '../src/nucleo/trilha.js';

test('listar devolve o mais recente primeiro, com contagem e se foi desfeita', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const p = criarPessoa(acervo);
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565911111',
    });
    vincularIdentificador(acervo, { identificadorId: ident, pessoaId: p, procedencia: 'humano' });

    const lista = listarOperacoes(acervo);
    assert.equal(lista[0]?.natureza, 'vincular', 'o mais recente primeiro');
    assert.equal(lista[0]?.linhas, 3, 'pessoa_id, procedencia e vinculado_em');
    assert.equal(lista[0]?.desfeitaPor, null);
    assert.equal(lista[1]?.natureza, 'criar-pessoa');
  } finally {
    c.limpar();
  }
});

test('ver devolve a Operação com as linhas de efeito na ordem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const p = criarPessoa(acervo);

    const lista = listarOperacoes(acervo);
    const vista = lerOperacao(acervo, lista[0]?.id ?? '');
    assert.equal(vista?.natureza, 'criar-pessoa');
    assert.equal(vista?.efeito.length, 1);
    assert.equal(vista?.efeito[0]?.chave, p);
  } finally {
    c.limpar();
  }
});

test('ver Operação inexistente devolve nulo, não lança', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    assert.equal(lerOperacao(acervo, 'nao-existe'), null);
  } finally {
    c.limpar();
  }
});

test('desfazer um vínculo o desfaz, e ACRESCENTA uma Operação que aponta para ele', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const p = criarPessoa(acervo);
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565922222',
    });
    vincularIdentificador(acervo, { identificadorId: ident, pessoaId: p, procedencia: 'humano' });

    const alvo = listarOperacoes(acervo)[0]?.id ?? '';
    const antes = listarOperacoes(acervo, { limite: 999 }).length;

    const r = desfazerOperacao(acervo, alvo);
    assert.equal(r.recusados.length, 0, JSON.stringify(r.recusados));
    assert.ok(r.desfeitos >= 1);

    assert.equal(lerVinculo(acervo, ident), null, 'o vínculo saiu');

    const depois = listarOperacoes(acervo, { limite: 999 });
    assert.ok(depois.length > antes, 'a trilha NUNCA encolhe');
    assert.equal(depois[0]?.natureza, 'desfazer-operacao');
    assert.equal(lerOperacao(acervo, alvo)?.desfeitaPor, r.desfazerId);
  } finally {
    c.limpar();
  }
});

test('desfazer duas vezes é recusado com a causa nomeada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const p = criarPessoa(acervo);
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565933333',
    });
    vincularIdentificador(acervo, { identificadorId: ident, pessoaId: p, procedencia: 'humano' });
    const alvo = listarOperacoes(acervo)[0]?.id ?? '';

    desfazerOperacao(acervo, alvo);
    assert.throws(
      () => desfazerOperacao(acervo, alvo),
      (e: unknown) => {
        assert.ok(e instanceof OperacaoJaDesfeitaError);
        assert.match((e as Error).message, /ja foi desfeita/i);
        return true;
      },
    );
  } finally {
    c.limpar();
  }
});

test('desfazer o irreversível é recusado, e a causa diz o caminho', () => {
  const c = cenario();
  try {
    const { acervo } = c.inquilinoComArquivos();
    const anexo = acervo.db
      .prepare("SELECT id FROM anexos WHERE presenca = 'presente' LIMIT 1")
      .get() as { id: string };
    descartarAnexo(acervo, anexo.id, { politica: 'video-antigo' });
    const alvo = listarOperacoes(acervo).find((o) => o.natureza === 'descartar-anexo')?.id ?? '';

    assert.throws(
      () => desfazerOperacao(acervo, alvo),
      (e: unknown) => {
        assert.ok(e instanceof OperacaoIrreversivelError);
        assert.match((e as Error).message, /arquivo/i);
        return true;
      },
    );
  } finally {
    c.limpar();
  }
});

test('criar Pessoa e registrar nome recusam, porque não há porta que remova', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('R2-D2');
    criarPessoa(acervo);
    const daPessoa = listarOperacoes(acervo)[0]?.id ?? '';
    assert.throws(() => desfazerOperacao(acervo, daPessoa), /nunca remove Pessoa/i);

    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565944444',
    });
    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: ident, origem: 'material', nome: 'Han' });
    const doNome = listarOperacoes(acervo)[0]?.id ?? '';
    assert.throws(() => desfazerOperacao(acervo, doNome), /nome/i);
  } finally {
    c.limpar();
  }
});
