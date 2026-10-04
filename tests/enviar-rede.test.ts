import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { executarEnviarRede, type RedeDeEnvio } from '../src/cli/enviar-rede.js';
import { subirCenaDeEnvio, subirServidorContador } from './ajuda/servidor-de-envio.js';

const BASE = ['enviar', '--configuracao', 'hera', '--para', '5511999990000@s.whatsapp.net'];

function rede(
  url: string,
  chave: string | undefined,
  extra: Partial<RedeDeEnvio> = {},
): { rede: RedeDeEnvio; saida: () => string } {
  const linhas: string[] = [];
  return {
    rede: { servidor: url, chave, env: {}, escrever: (t) => linhas.push(t), ...extra },
    saida: () => linhas.join('\n'),
  };
}

test('texto: aceito, Envio pendente no Inquilino da chave, com o Ator da chave', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = rede(cena.url, cena.chave.valor);
    const codigo = await executarEnviarRede([...BASE, '--texto', 'oi pela rede'], r.rede);
    assert.equal(codigo, 0, r.saida());
    assert.match(r.saida(), /Envio aceito: \S+/);
    const envios = cena.lerEnvios();
    assert.equal(envios.length, 1);
    assert.equal(envios[0]!.estado, 'pendente');
    assert.equal(envios[0]!.conteudo_texto, 'oi pela rede');
    assert.equal(cena.atorDoEnvio(), `acesso:${cena.chave.id}`);
  } finally {
    cena.encerrar();
  }
});

test('--json devolve o corpo da resposta, e so ele', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = rede(cena.url, cena.chave.valor);
    const codigo = await executarEnviarRede([...BASE, '--texto', 'oi', '--json'], r.rede);
    assert.equal(codigo, 0);
    const corpo = JSON.parse(r.saida()) as { aceita: boolean; envioId: string };
    assert.equal(corpo.aceita, true);
    assert.ok(corpo.envioId.length > 0);
  } finally {
    cena.encerrar();
  }
});

test('recusas locais saem 2 e NAO abrem conexao nenhuma', async () => {
  const s = await subirServidorContador();
  try {
    const casos: Array<{ nome: string; args: string[]; casa: RegExp }> = [
      {
        nome: '--inquilino',
        args: [...BASE, '--texto', 'x', '--inquilino', 'qualquer'],
        casa: /Inquilino vem da Chave de Acesso.*env -u MALOTE_SERVIDOR/s,
      },
      { nome: 'sem --configuracao', args: ['enviar', '--para', 'a@s.whatsapp.net', '--texto', 'x'], casa: /Uso:/ },
      { nome: 'sem --para', args: ['enviar', '--configuracao', 'hera', '--texto', 'x'], casa: /Uso:/ },
      { nome: 'sem conteudo', args: [...BASE], casa: /--texto, --imagem ou --documento/ },
      {
        nome: 'imagem e documento',
        args: [...BASE, '--imagem', '/a.jpg', '--documento', '/b.pdf'],
        casa: /mutuamente exclusivos/,
      },
      {
        nome: 'para sem @',
        args: ['enviar', '--configuracao', 'hera', '--para', '5511999990000', '--texto', 'x'],
        casa: /endereco completo/,
      },
      { nome: 'arquivo inexistente', args: [...BASE, '--imagem', '/nao/existe.jpg'], casa: /Arquivo nao encontrado/ },
    ];
    for (const caso of casos) {
      const r = rede(s.url, 'chave-qualquer');
      const codigo = await executarEnviarRede(caso.args, r.rede);
      assert.equal(codigo, 2, `${caso.nome}: ${r.saida()}`);
      assert.match(r.saida(), caso.casa, caso.nome);
    }
    assert.equal(s.requisicoes(), 0, 'uma recusa local abriu conexao');
  } finally {
    s.fechar();
  }
});

test('chave ausente sai 2 e nao abre conexao', async () => {
  const s = await subirServidorContador();
  try {
    const r = rede(s.url, undefined);
    const codigo = await executarEnviarRede([...BASE, '--texto', 'x'], r.rede);
    assert.equal(codigo, 2);
    assert.match(r.saida(), /MALOTE_CHAVE_DE_ACESSO|--chave-em/);
    assert.equal(s.requisicoes(), 0);
  } finally {
    s.fechar();
  }
});

test('Configuracao de outro Inquilino: 404 vira codigo 6 com a mensagem que nao adivinha', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = rede(cena.url, cena.chaveDoOutro.valor); // essa chave nao alcanca a `hera`
    const codigo = await executarEnviarRede([...BASE, '--texto', 'x'], r.rede);
    assert.equal(codigo, 6);
    assert.match(r.saida(), /nao existe neste Inquilino, ou a chave nao o alcanca/);
    assert.equal(cena.lerEnvios().length, 0);
  } finally {
    cena.encerrar();
  }
});

test('chave errada: codigo 3', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = rede(cena.url, 'chave-invalida');
    assert.equal(await executarEnviarRede([...BASE, '--texto', 'x'], r.rede), 3);
  } finally {
    cena.encerrar();
  }
});

test('servidor que erra (5xx): codigo 5', async () => {
  const s = await subirServidorContador(); // responde 500 a tudo, e conta
  try {
    const r = rede(s.url, 'k');
    const codigo = await executarEnviarRede([...BASE, '--texto', 'x'], r.rede);
    assert.equal(codigo, 5, r.saida());
    assert.equal(s.requisicoes(), 1, 'com argumentos validos, o pedido DEVE chegar ao servidor');
  } finally {
    s.fechar();
  }
});

test('servidor inalcancavel: codigo 4', async () => {
  const s = await subirServidorContador();
  const url = s.url;
  s.fechar();
  await new Promise((r) => setTimeout(r, 50));
  const r = rede(url, 'k');
  assert.equal(await executarEnviarRede([...BASE, '--texto', 'x'], r.rede), 4);
});

test('--chave-em usa a chave da variavel nomeada, e nao a padrao', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    // A padrao (sessao) e a do OUTRO Inquilino; a da Hera esta numa variavel nomeada.
    const r = rede(cena.url, cena.chaveDoOutro.valor, { env: { MALOTE_CHAVE_DE_ACESSO_HERA: cena.chave.valor } });
    const codigo = await executarEnviarRede(
      [...BASE, '--texto', 'pela hera', '--chave-em', 'MALOTE_CHAVE_DE_ACESSO_HERA'],
      r.rede,
    );
    assert.equal(codigo, 0, r.saida());
    assert.equal(cena.lerEnvios().length, 1);
    assert.equal(cena.atorDoEnvio(), `acesso:${cena.chave.id}`);
  } finally {
    cena.encerrar();
  }
});

test('--chave-em com variavel ausente ou vazia recusa SEM cair na chave padrao', async () => {
  const s = await subirServidorContador();
  try {
    for (const env of [{}, { MALOTE_CHAVE_DE_ACESSO_HERA: '' }, { MALOTE_CHAVE_DE_ACESSO_HERA: '   ' }]) {
      // chave padrao VALIDA presente no mesmo teste: se o codigo caisse nela, tentaria a rede
      const r = rede(s.url, 'chave-padrao-valida', { env });
      const codigo = await executarEnviarRede(
        [...BASE, '--texto', 'x', '--chave-em', 'MALOTE_CHAVE_DE_ACESSO_HERA'],
        r.rede,
      );
      assert.equal(codigo, 2);
      assert.match(r.saida(), /MALOTE_CHAVE_DE_ACESSO_HERA/);
    }
    assert.equal(s.requisicoes(), 0, 'caiu na chave padrao e abriu conexao');
  } finally {
    s.fechar();
  }
});

test('a chave nunca aparece na saida, nem em erro', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    for (const chave of [cena.chave.valor, cena.chaveDoOutro.valor]) {
      const r = rede(cena.url, chave);
      await executarEnviarRede([...BASE, '--texto', 'x'], r.rede);
      await executarEnviarRede(
        ['enviar', '--configuracao', 'inexistente', '--para', 'a@s.whatsapp.net', '--texto', 'x'],
        r.rede,
      );
      assert.equal(r.saida().includes(chave), false, 'a chave vazou na saida');
    }
  } finally {
    cena.encerrar();
  }
});

test('timeout: codigo 7, e a mensagem diz que repetir pode duplicar', async () => {
  const srv = createServer(() => undefined); // aceita e nunca responde
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  try {
    const r = rede(`http://127.0.0.1:${porta}`, 'k', { timeoutMs: 150 });
    const codigo = await executarEnviarRede([...BASE, '--texto', 'x'], r.rede);
    assert.equal(codigo, 7);
    assert.match(r.saida(), /DUPLICAR/);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
