import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cenario } from './ajuda/acervo.js';
import { VERSAO_SCHEMA_ACERVO } from '../src/nucleo/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import {
  criarPessoa,
  desvincularIdentificador,
  historicoDeNomes,
  nomeDaPessoa,
  nomesDoIdentificador,
  registrarNome,
  vincularIdentificador,
} from '../src/nucleo/identidade.js';

test('o schema do Acervo está na versão 18', () => {
  // v18 em 13/09/2026: a MARCA DO TITULAR entra em duas tabelas — favorito de
  // Mensagem e fixacao de Conversa. Duas e nao uma porque com coluna de tipo
  // de alvo nao ha chave estrangeira possivel, e apagar a Conversa deixaria
  // marca orfa. A coluna de Configuracao nao e redundante: coletiva e
  // compartilhada entre contas desde o ciclo 14, entao fixar numa nao afirma
  // nada sobre a outra.
  //
  // v17 em 12/09/2026: a Atribuicao de Nome declara a AUTORIDADE — quem
  // afirmou o nome, o dono da conta ou o dono do endereco. Fica FORA da chave
  // de unicidade: com ela na chave, reimportar o material criaria uma linha
  // declarada ao lado da indeterminada que ja existe, e o historico mostraria
  // o mesmo nome duas vezes. As linhas anteriores ficam com NULL, que e o
  // valor certo — quando foram gravadas nao havia campo, e ninguem sabe de
  // qual campo do material cada nome veio.
  //
  // v16 em 12/09/2026: a Configuracao de catalogo entra nas tres tabelas de
  // identidade, e o reavistamento ganha coluna propria. Com mais de uma base de
  // contatos, cada evidencia precisa dizer de onde veio — e o mesmo endereco no
  // mesmo cartao de duas bases sao duas evidencias, entao a Configuracao entra
  // na CHAVE do Cartao. A origem continua sendo a FONTE: gravar a Configuracao
  // colada nela faria o lookup exato da precedencia errar e o nome de catalogo
  // cair abaixo do nome de plataforma. O ultimo avistamento e coluna nova, e
  // nao o primeiro reaproveitado: mover o primeiro traria nome antigo de volta
  // ao topo do desempate. As duas tabelas sao RECRIADAS porque o SQLite recusa
  // ADD COLUMN NOT NULL sem valor padrao, e com valor padrao a forma migrada
  // divergiria da criada do zero.
  //
  // v15 em 08/09/2026: broadcast e status passam a ser Conversa coletiva, e o
  // dado antigo acompanha. Ate aqui a recepcao ao vivo classificava por
  // `endsWith('@g.us')` e a importacao por `ZSESSIONTYPE != 0`; os dois
  // discordavam, e o Acervo real guardava as duas respostas — 1.054 coletivas
  // contra 11 diretas, com 29.035 Mensagens nas 11. Inofensivo enquanto o
  // lookup ignorava a natureza; com a chave da v14 o mesmo endereco viraria
  // duas Conversas, e a guarda que impede isso bloqueou a importacao da
  // segunda conta. Tarefa #826.
  //
  // v14 em 08/09/2026: Conversa direta identificada pela Configuracao de
  // Adaptador. Duas contas do Inquilino que falam com o mesmo endereco eram um
  // fio so — 89 colisoes medidas ao importar a segunda conta. A chave vira
  // dois indices parciais, um por natureza, porque o SQLite trata NULL como
  // distinto e uma chave de tres colunas deixaria coletiva duplicada passar.
  //
  // v13 em 03/09/2026: o Ator na trilha — por ordem de QUEM cada Operacao
  // aconteceu. O ciclo 8 construiu a trilha sem ele porque nao havia
  // identidade verificavel; o ciclo 11 cria a Chave de Acesso e a verificacao
  // que devolve quem, e o campo passa a poder existir. Coluna, nao tabela:
  // linha anterior fica com NULL, que e o valor certo para ela.
  //
  // v12 em 02/09/2026: a correspondencia entre formas de endereco de uma
  // Fonte. E o PRIMEIRO passo de migracao causado por necessidade de produto —
  // o v11 criou a contabilidade da propria maquina. A recepcao ao vivo entrega
  // o endereco numa forma que o material exportado nao grava, e sem traduzir o
  // produto duplicaria Conversa e identidade: 53,7% dos enderecos vistos ao
  // vivo ja existiam no acervo, na outra forma.
  // v11 em 01/09/2026: a contabilidade da maquina de migracao. E a
  // primeira versao que NAO exige recriar — dela em diante, forma anterior
  // sobe por passos declarados. Todas as razoes abaixo terminam em
  // "recriar diz" porque foram escritas quando recriar era a unica saida;
  // isso mudou aqui, e as entradas antigas ficam como registro do que se
  // pensava entao.
  // v8 em 29/08/2026: as tabelas da trilha de auditoria — `operacoes` e
  // `linhas_de_efeito`. Tabela nova alcancaria instalacao existente, mas
  // Acervo escrito ANTES dela nao tem Operacao nenhuma, e a trilha leria
  // silencio como "nada foi feito" em vez de "nao havia trilha". Recriar diz.
  //
  // v7: a tabela de lacos de cartao de catalogo. A versao sobe
  // por razao SEMANTICA, nao mecanica — a tabela alcancaria instalacao
  // existente, mas catalogo importado ANTES dela nao tem laco nenhum, e o
  // produtor por multiplos enderecos leria esse acervo como se cada endereco
  // fosse de um contato diferente. Silencioso e errado; recriar e explicito.
  //
  // v6: tabela de atos de mesclagem e as duas guardas da estrela.
  //
  // v9: Transicao de Participacao como registro proprio, e a atividade que a
  // Fonte declara no retrato. Acervo v8 nao tem nem uma nem outra, e a
  // consulta de presenca leria silencio como ausencia.
  assert.equal(VERSAO_SCHEMA_ACERVO, 18);
});

test('o nome pendura em Identificador, sem Pessoa nenhuma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000001' });

    acervo.db
      .prepare(
        `INSERT INTO atribuicoes_de_nome
           (id, identificador_id, origem, nome, atribuido_em, ultimo_avistamento)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(), ident, 'whatsapp', 'Han Solo',
        new Date().toISOString(), new Date().toISOString(),
      );

    const linha = acervo.db
      .prepare('SELECT nome FROM atribuicoes_de_nome WHERE identificador_id = ?')
      .get(ident) as { nome: string };
    assert.equal(linha.nome, 'Han Solo');
    const pessoas = acervo.db.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number };
    assert.equal(pessoas.n, 0, 'gravar nome de endereço não inventa Pessoa');
  } finally {
    c.limpar();
  }
});

test('o nome pendura em exatamente uma âncora — nunca nas duas, nunca em nenhuma', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000002' });
    const pessoa = criarPessoa(acervo);
    const agora = new Date().toISOString();

    const inserir = (p: string | null, i: string | null): void => {
      acervo.db
        .prepare(
          `INSERT INTO atribuicoes_de_nome
             (id, pessoa_id, identificador_id, origem, nome, atribuido_em, ultimo_avistamento)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(randomUUID(), p, i, 'manual', 'Han', agora, agora);
    };

    assert.throws(() => inserir(pessoa, ident), /CHECK constraint failed/, 'as duas âncoras');
    assert.throws(() => inserir(null, null), /CHECK constraint failed/, 'nenhuma âncora');
  } finally {
    c.limpar();
  }
});

test('o mesmo nome, mesma origem e mesmo endereço não duplica', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000003' });
    const agora = new Date().toISOString();
    const inserir = acervo.db.prepare(
      `INSERT OR IGNORE INTO atribuicoes_de_nome
         (id, identificador_id, origem, nome, atribuido_em, ultimo_avistamento)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    inserir.run(randomUUID(), ident, 'whatsapp', 'Han', agora, agora);
    inserir.run(randomUUID(), ident, 'whatsapp', 'Han', agora, agora);
    inserir.run(randomUUID(), ident, 'whatsapp', 'Han Solo', agora, agora);

    const n = acervo.db
      .prepare('SELECT COUNT(*) AS n FROM atribuicoes_de_nome WHERE identificador_id = ?')
      .get(ident) as { n: number };
    assert.equal(n.n, 2, 'idempotência do endereço vale como a da Pessoa');
  } finally {
    c.limpar();
  }
});

test('registrar nome de endereço não cria Pessoa, e a leitura devolve', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000004' });

    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: ident, origem: 'whatsapp', nome: 'Han Solo' });

    const nomes = nomesDoIdentificador(acervo, ident);
    assert.equal(nomes.length, 1);
    assert.equal(nomes[0]?.nome, 'Han Solo');
    assert.equal(
      (acervo.db.prepare('SELECT COUNT(*) AS n FROM pessoas').get() as { n: number }).n,
      0,
    );
  } finally {
    c.limpar();
  }
});

test('o nome corrente da Pessoa junta o dela com o dos endereços dela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Rey');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000005' });
    // O nome chega ANTES de existir Pessoa — é a ordem real da importação.
    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: ident, origem: 'whatsapp', nome: 'Han' });

    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });

    // Só com o nome do endereço, ele é o nome corrente.
    assert.equal(nomeDaPessoa(acervo, pessoa, {
      porOrigem: { whatsapp: 100, manual: 300 },
      catalogoPreferido: null,
    }), 'Han');

    // Nome de origem mais alta na própria Pessoa vence o do endereço.
    registrarNome(acervo, { autoridade: 'terceiro', pessoaId: pessoa, origem: 'manual', nome: 'Han Solo' });
    assert.equal(nomeDaPessoa(acervo, pessoa, {
      porOrigem: { whatsapp: 100, manual: 300 },
      catalogoPreferido: null,
    }), 'Han Solo');

    // E o histórico mostra os dois, sem escolher.
    assert.equal(historicoDeNomes(acervo, pessoa).length, 2);
  } finally {
    c.limpar();
  }
});

test('desvincular leva o nome do endereço junto — ele nunca foi da Pessoa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Wedge');
    const { id: ident } = registrarIdentificador(acervo, { fonte: 'whatsapp', valor: '5565900000006' });
    registrarNome(acervo, { autoridade: 'terceiro', identificadorId: ident, origem: 'whatsapp', nome: 'Han' });
    const pessoa = criarPessoa(acervo);
    vincularIdentificador(acervo, {
      identificadorId: ident,
      pessoaId: pessoa,
      procedencia: 'humano',
    });
    assert.equal(historicoDeNomes(acervo, pessoa).length, 1);

    desvincularIdentificador(acervo, ident);

    assert.equal(historicoDeNomes(acervo, pessoa).length, 0, 'a Pessoa fica sem nome');
    assert.equal(nomesDoIdentificador(acervo, ident).length, 1, 'e o endereço continua nomeado');
  } finally {
    c.limpar();
  }
});
