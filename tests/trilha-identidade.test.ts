import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  desfazerMesclagem,
  desvincularIdentificador,
  mesclarPessoas,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import { listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';

test('vincular grava a Operação com o valor ANTERIOR, que hoje se perde', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565900000001',
    });
    const pessoa = criarPessoa(acervo);

    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'catalogo',
    });

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'vincular');
    assert.equal(operacoes.length, 1);
    assert.equal(operacoes[0]?.reversibilidade, 'por-efeito');

    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    const porCampo = new Map(linhas.map((l) => [l.campo, l]));

    assert.equal(porCampo.get('pessoa_id')?.antes, null, 'não pertencia a ninguém');
    assert.equal(porCampo.get('pessoa_id')?.depois, pessoa);
    assert.equal(porCampo.get('procedencia')?.antes, null);
    assert.equal(porCampo.get('procedencia')?.depois, 'catalogo');
    assert.equal(porCampo.get('vinculado_em')?.antes, null);
    assert.match(porCampo.get('vinculado_em')?.depois ?? '', /^\d{4}-\d{2}-\d{2}T/);
    for (const l of linhas) assert.equal(l.tabela, 'identificadores');
  } finally {
    c.limpar();
  }
});

test('reafirmar o vínculo com procedência MENOR não inventa mudança que não houve', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565900000002',
    });
    const pessoa = criarPessoa(acervo);

    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'material',
    });

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'vincular');
    assert.equal(operacoes.length, 2, 'os dois atos aconteceram e os dois ficam na trilha');

    // A mais recente é a primeira da lista. A segunda chamada não mudou nada:
    // mesma Pessoa, procedência menor, data preservada.
    const daSegunda = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    assert.equal(daSegunda.length, 0, 'ato sem mudança grava Operação sem linha de efeito');
  } finally {
    c.limpar();
  }
});

test('vínculo recusado não deixa Operação', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565900000003',
    });
    const certa = criarPessoa(acervo);
    const errada = criarPessoa(acervo);

    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: certa,
      procedencia: 'humano',
    });
    const antes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'vincular').length;

    assert.throws(() =>
      vincularIdentificador(acervo, {
        identificadorId: ident,
        pessoaId: errada,
        procedencia: 'material',
      }),
    );

    const depois = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'vincular').length;
    assert.equal(depois, antes, 'recusa não é ato');
  } finally {
    c.limpar();
  }
});

test('criar Pessoa grava a Operação, com a linha criada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('R2-D2');
    const pessoa = criarPessoa(acervo);

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'criar-pessoa');
    assert.equal(operacoes.length, 1);
    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.tabela, 'pessoas');
    assert.equal(linhas[0]?.chave, pessoa);
    assert.equal(linhas[0]?.antes, null, 'antes ausente significa linha criada');
    assert.equal(linhas[0]?.depois, pessoa);
  } finally {
    c.limpar();
  }
});

test('desvincular grava UMA Operação para as duas escritas que faz', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565900000004',
    });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });

    desvincularIdentificador(acervo, ident);

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'desvincular');
    assert.equal(operacoes.length, 1, 'duas escritas, uma Operação');

    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    const tabelas = linhas.map((l) => l.tabela);
    assert.ok(tabelas.includes('desvinculos'), 'a linha de desvínculo criada');
    assert.ok(tabelas.includes('identificadores'), 'o vínculo removido');

    const doVinculo = linhas.filter((l) => l.tabela === 'identificadores');
    const pessoaIdLinha = doVinculo.find((l) => l.campo === 'pessoa_id');
    assert.equal(pessoaIdLinha?.antes, pessoa);
    assert.equal(pessoaIdLinha?.depois, null, 'depois ausente significa valor removido');
  } finally {
    c.limpar();
  }
});

test('desvincular o que não tem vínculo não é ato e não grava Operação', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565900000005',
    });

    desvincularIdentificador(acervo, ident);

    assert.equal(
      listarOperacoesCruas(acervo).filter((o) => o.natureza === 'desvincular').length,
      0,
    );
  } finally {
    c.limpar();
  }
});

test('registrar nome novo grava Operação; nome repetido não', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565900000006',
    });

    const primeira = registrarNome(acervo, { autoridade: 'terceiro',
      identificadorId: ident,
      nome: 'Han',
      origem: 'material',
    });
    const segunda = registrarNome(acervo, { autoridade: 'terceiro',
      identificadorId: ident,
      nome: 'Han',
      origem: 'material',
    });

    assert.equal(primeira, true);
    assert.equal(segunda, false);

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'registrar-nome');
    assert.equal(operacoes.length, 2, 'os dois atos aconteceram');

    const comEfeito = operacoes.filter(
      (o) => linhasDaOperacao(acervo, o.id).length > 0,
    );
    assert.equal(comEfeito.length, 1, 'INSERT OR IGNORE que não muda nada não grava efeito');
    assert.equal(linhasDaOperacao(acervo, comEfeito[0]?.id ?? '')[0]?.tabela, 'atribuicoes_de_nome');
  } finally {
    c.limpar();
  }
});

test('mesclar aponta para o ato e NÃO duplica o conteúdo dele', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);

    const resultado = mesclarPessoas(acervo, { pessoaA: a, pessoaB: b });

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'mesclar');
    assert.equal(operacoes.length, 1);
    assert.equal(operacoes[0]?.reversibilidade, 'por-delegacao');

    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.natureza, 'referencia');
    assert.equal(linhas[0]?.tabela, 'atos_de_mesclagem');
    assert.equal(linhas[0]?.chave, resultado.atoId);

    // Critério 5, verificado por AUSÊNCIA: nada reproduz o que o ato já guarda.
    const duplicatas = linhas.filter((l) => l.tabela === 'pessoas');
    assert.equal(duplicatas.length, 0, 'a Operação não copia absorvida_por');
  } finally {
    c.limpar();
  }
});

test('desfazer mesclagem também aponta para o seu próprio ato', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const { absorvidaId } = mesclarPessoas(acervo, { pessoaA: a, pessoaB: b });

    desfazerMesclagem(acervo, { absorvidaId });

    const operacoes = listarOperacoesCruas(acervo).filter(
      (o) => o.natureza === 'desfazer-mesclagem',
    );
    assert.equal(operacoes.length, 1);
    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0]?.natureza, 'referencia');
    assert.equal(linhas[0]?.tabela, 'atos_de_mesclagem');
  } finally {
    c.limpar();
  }
});
