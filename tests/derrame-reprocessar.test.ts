import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { caminhosDaConta } from '../src/cli/ouvir.js';
import { derramar, lerDerrame } from '../src/cli/derrame.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';

function instalacaoComConta(): { raiz: string; id: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Cassian' });
  resolverConfiguracao(registro, id, 'whatsapp', 'principal');
  registro.fechar();
  return { raiz, id, limpar };
}

function evento(idExterno: string, texto: string): unknown {
  return {
    key: { remoteJid: '5511000000007@s.whatsapp.net', id: idExterno, fromMe: false },
    messageTimestamp: Math.floor(Date.parse('2026-09-08T12:00:00Z') / 1000),
    message: { conversation: texto },
  };
}

test('reprocessar grava o que foi derramado e esvazia o arquivo', () => {
  const { raiz, id, limpar } = instalacaoComConta();
  try {
    const caminho = caminhosDaConta(raiz, 'principal').derrame;
    derramar(caminho, [evento('D1', 'primeira')]);
    derramar(caminho, [evento('D2', 'segunda'), evento('D3', 'terceira')]);

    const linhas: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'],
      // `ouvinteEscrevendo` e FRONTEIRA DE SISTEMA, e o default e honesto: sem
      // `systemctl` ou sem `/proc` ele devolve `true`, porque nao da para
      // AFIRMAR que ninguem escreve. Este teste mede o reprocessamento, nao o
      // guard — entao declara o estado em vez de depender do SO onde roda.
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false },
    );

    assert.equal(codigo, 0, linhas.join('\n'));
    assert.match(linhas.join('\n'), /2 lote\(s\) reprocessado\(s\), 3 gravada/);
    assert.equal(existsSync(caminho), false, 'o derrame sobreviveu ao reprocessamento completo');

    const acervo = abrirAcervoSomenteLeitura(`${raiz}/acervos`, id);
    try {
      const n = acervo.preparar('SELECT COUNT(*) AS n FROM mensagens').get() as { n: number };
      assert.equal(n.n, 3, 'as Mensagens derramadas nao chegaram ao Acervo');
    } finally {
      acervo.fechar();
    }
  } finally {
    limpar();
  }
});

test('reprocessar sem derrame nao inventa trabalho', () => {
  const { raiz, id, limpar } = instalacaoComConta();
  try {
    const linhas: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false },
    );
    assert.equal(codigo, 0);
    assert.match(linhas.join('\n'), /nada derramado/i);
  } finally {
    limpar();
  }
});

/**
 * O evento derramado PERTENCE a conta que o recebeu. Criar a Configuracao aqui
 * abriria um fio paralelo ao lado do real — o mesmo incidente que o acionador
 * da conversao evita ao nunca criar Inquilino.
 */
test('reprocessar RECUSA apelido que nao existe, em vez de criar', () => {
  const { raiz, id, limpar } = instalacaoComConta();
  try {
    const caminho = caminhosDaConta(raiz, 'principal').derrame;
    derramar(caminho, [evento('D9', 'nao deve entrar')]);
    const linhas: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'principal', '--configuracao', 'inexistente'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false },
    );
    assert.notEqual(codigo, 0);
    assert.match(linhas.join('\n'), /nao existe/i);
    assert.equal(existsSync(caminho), true, 'o derrame foi descartado sem ter sido gravado');
  } finally {
    limpar();
  }
});

/**
 * DOIS ESCRITORES NO MESMO ARQUIVO PERDEM DADO.
 *
 * `reprocessar` le tudo, processa, e descarta o arquivo. Um lote derramado pelo
 * ouvinte ENTRE a leitura e o descarte e destruido sem ter sido gravado — a
 * classe exata que o derrame existe para impedir. A corrida existe desde a
 * v0.8.0 e so nao mordeu porque nada derramou nas janelas em que o comando
 * rodou.
 *
 * A regra ja e doutrina desta casa: recurso com estado exclusivo tem UM dono por
 * vez. E a mesma do vinculo do dispositivo.
 */
test('reprocessar RECUSA com o ouvinte no ar, e nao toca no derrame', () => {
  const { raiz, id, limpar } = instalacaoComConta();
  try {
    const caminho = caminhosDaConta(raiz, 'principal').derrame;
    derramar(caminho, [evento('D1', 'nao pode sumir')]);
    const linhas: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => true },
    );
    assert.notEqual(codigo, 0);
    assert.match(linhas.join('\n'), /no ar|escrev/i);
    assert.equal(existsSync(caminho), true, 'recusar nao pode ter tocado no derrame');
    assert.equal(lerDerrame(caminho).length, 1, 'o lote sumiu');
  } finally {
    limpar();
  }
});

test('com o ouvinte parado, reprocessar segue funcionando como antes', () => {
  const { raiz, id, limpar } = instalacaoComConta();
  try {
    const caminho = caminhosDaConta(raiz, 'principal').derrame;
    derramar(caminho, [evento('D2', 'entra')]);
    const linhas: string[] = [];
    const codigo = executar(
      ['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'principal', '--configuracao', 'principal'],
      { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t), ouvinteEscrevendo: () => false },
    );
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.equal(existsSync(caminho), false, 'o derrame nao foi esvaziado');
  } finally {
    limpar();
  }
});
