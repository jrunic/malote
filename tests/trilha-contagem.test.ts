import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { importarCatalogo } from '../src/adaptadores/contatos/importar.js';
import { descartarAnexo, registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  desfazerMesclagem,
  desvincularIdentificador,
  mesclarPessoas,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';
import { registrarMaterialConcluido } from '../src/nucleo/sincronizacao.js';
import { emOperacao, listarOperacoesCruas, linhasDaOperacao } from '../src/nucleo/trilha.js';

test('descartar Anexo grava Operação IRREVERSÍVEL, com o caminho que se perdeu', () => {
  const c = cenario();
  try {
    const { acervo } = c.inquilinoComArquivos();
    const anexo = acervo.db
      .prepare("SELECT id FROM anexos WHERE presenca = 'presente' LIMIT 1")
      .get() as { id: string };

    descartarAnexo(acervo, anexo.id, { politica: 'video-antigo' });

    const operacoes = listarOperacoesCruas(acervo).filter((o) => o.natureza === 'descartar-anexo');
    assert.equal(operacoes.length, 1);
    assert.equal(operacoes[0]?.reversibilidade, 'irreversivel', 'arquivo descartado não volta');

    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    const presenca = linhas.find((l) => l.campo === 'presenca');
    assert.equal(presenca?.antes, 'presente');
    assert.equal(presenca?.depois, 'descartado');
    const caminho = linhas.find((l) => l.campo === 'caminho');
    assert.ok((caminho?.antes ?? '').length > 0, 'o caminho anterior fica registrado');
    assert.equal(caminho?.depois, null);
  } finally {
    c.limpar();
  }
});

test('a INGESTÃO não gera Operação por Mensagem — só uma por Material', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    // Três Conversas, três Mensagens e três Anexos, todos pela porta.
    for (let i = 0; i < 3; i += 1) {
      c.registrarAnexo(acervo, {
        tipo: 'image',
        tamanho: 1000,
        ocorridaEm: Date.UTC(2026, 0, 1 + i),
      });
    }

    const mensagens = acervo.db.prepare('SELECT COUNT(*) AS n FROM mensagens').get() as {
      n: number;
    };
    assert.equal(mensagens.n, 3);

    assert.equal(listarOperacoesCruas(acervo).length, 0, 'ingestão não abre Operação por linha');
  } finally {
    c.limpar();
  }
});

test('importar material com N nomes grava UMA Operação, não N', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    // É o contrato que a task 7B instala nos três importadores: a Operação é
    // do Material, e os nomes registrados por dentro se juntam a ela.
    emOperacao(
      acervo,
      { natureza: 'importar-material', reversibilidade: 'irreversivel', registraEfeito: false },
      () => {
        for (let i = 0; i < 50; i += 1) {
          const { id } = registrarIdentificador(acervo, {
            fonte: 'whatsapp',
            valor: `55659000001${i}`,
          });
          registrarNome(acervo, { autoridade: 'terceiro',
            identificadorId: id,
            origem: 'whatsapp',
            nome: `Contato ${i}`,
          });
        }
      },
    );

    const operacoes = listarOperacoesCruas(acervo);
    assert.equal(operacoes.length, 1, '50 nomes, uma Operação');
    assert.equal(operacoes[0]?.natureza, 'importar-material');
    assert.equal(
      linhasDaOperacao(acervo, operacoes[0]?.id ?? '').length,
      0,
      'ingestão não grava efeito de valor',
    );

    // E os nomes entraram de verdade — a supressão é do EFEITO, não da escrita.
    const nomes = acervo.db.prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome').get() as {
      n: number;
    };
    assert.equal(nomes.n, 50);
  } finally {
    c.limpar();
  }
});

test('os 8 comandos de decisão do Acervo gravam Operação — nem mais, nem menos', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');

    const a = criarPessoa(acervo);
    const b = criarPessoa(acervo);
    const { id: ident } = registrarIdentificador(acervo, {
      fonte: 'whatsapp',
      valor: '5565900000009',
    });
    vincularIdentificador(acervo, { identificadorId: ident, pessoaId: a, procedencia: 'humano' });
    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: ident, nome: 'Han', origem: 'material' });
    desvincularIdentificador(acervo, ident);
    const { absorvidaId } = mesclarPessoas(acervo, { pessoaA: a, pessoaB: b });
    desfazerMesclagem(acervo, { absorvidaId });
    const anexoId = c.registrarAnexo(acervo, {
      tipo: 'video',
      tamanho: 10,
      ocorridaEm: Date.UTC(2020, 0, 1),
    });
    descartarAnexo(acervo, anexoId, { politica: 'video-antigo' });
    registrarMaterialConcluido(acervo, {
      configuracaoId: 'cfg-1',
      fonte: 'whatsapp',
      impressao: 'imp-1',
      conversasCriadas: 1,
      mensagensCriadas: 1,
    });

    const naturezas = listarOperacoesCruas(acervo)
      .map((o) => o.natureza)
      .sort();
    assert.deepEqual(naturezas, [
      'criar-pessoa',
      'criar-pessoa',
      'descartar-anexo',
      'desfazer-mesclagem',
      'desvincular',
      'importar-material',
      'mesclar',
      'registrar-nome',
      'vincular',
    ]);
    assert.equal(new Set(naturezas).size, 8, 'os oito comandos de decisão do Acervo');
  } finally {
    c.limpar();
  }
});

test('o IMPORTADOR de catálogo grava uma Operação por Material, não uma por nome', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const cartoes: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      cartoes.push(
        ['BEGIN:VCARD', `FN:Contato ${i}`, `TEL;TYPE=cell:+55 11 9123400${i}`, 'END:VCARD'].join(
          '\r\n',
        ),
      );
    }
    const caminho = join(c.raiz, 'catalogo-trilha.vcf');
    writeFileSync(caminho, cartoes.join('\r\n'));

    // COM configuracaoId: sem ele o Material nao e registrado e nao ha o que
    // referenciar — foi o que o primeiro corte deste teste deixou passar.
    importarCatalogo(acervo, caminho, {
      agora: Date.parse('2026-08-29T12:00:00Z'),
      configuracaoId: 'cfg-catalogo',
    });

    // 30 Cartões, 30 nomes registrados — e UMA Operação, a do Material.
    const nomes = acervo.db.prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome').get() as {
      n: number;
    };
    assert.equal(nomes.n, 30, 'os nomes entraram');

    const operacoes = listarOperacoesCruas(acervo);
    assert.equal(operacoes.length, 1, 'uma Operação para o Material inteiro');
    assert.equal(operacoes[0]?.natureza, 'importar-material');

    const linhas = linhasDaOperacao(acervo, operacoes[0]?.id ?? '');
    assert.equal(linhas.length, 1, 'só a referência ao Material');
    assert.equal(linhas[0]?.natureza, 'referencia');
    assert.equal(linhas[0]?.tabela, 'materiais');
  } finally {
    c.limpar();
  }
});
