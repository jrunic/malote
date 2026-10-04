import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executarEnviarRede,
  LIMITE_DO_CORPO_DE_ENVIO,
  type RedeDeEnvio,
} from '../src/cli/enviar-rede.js';
import { TAMANHO_MAXIMO_DO_CORPO_DE_ENVIO } from '../src/rede/rotas.js';
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

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

test('timeout: codigo 7, a saida traz o identificador e diz que repetir com ele e seguro', async () => {
  const srv = createServer(() => undefined); // aceita e nunca responde
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  try {
    const r = rede(`http://127.0.0.1:${porta}`, 'k', { timeoutMs: 150 });
    const codigo = await executarEnviarRede([...BASE, '--texto', 'x'], r.rede);
    assert.equal(codigo, 7);
    const identificador = UUID.exec(r.saida())?.[0];
    assert.ok(identificador, 'a saida traz o identificador do pedido');
    assert.match(r.saida(), new RegExp(`--identificador ${identificador}`));
    assert.doesNotMatch(r.saida(), /DUPLICAR/);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('repetir com o mesmo --identificador nao cria segundo Envio (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const id = '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f';
    const a = rede(cena.url, cena.chave.valor);
    const b = rede(cena.url, cena.chave.valor);
    assert.equal(await executarEnviarRede([...BASE, '--texto', 'oi', '--identificador', id], a.rede), 0);
    assert.equal(await executarEnviarRede([...BASE, '--texto', 'oi', '--identificador', id], b.rede), 0);
    assert.equal(cena.lerEnvios().length, 1);
    assert.match(a.saida(), /Envio aceito/);
    assert.match(b.saida(), /Envio ja registrado/);
  } finally {
    cena.encerrar();
  }
});

test('sem --identificador o cliente gera um, manda e o imprime no sucesso (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const r = rede(cena.url, cena.chave.valor);
    assert.equal(await executarEnviarRede([...BASE, '--texto', 'oi'], r.rede), 0);
    // O primeiro UUID da saida e o envioId: o identificador vem depois da palavra.
    const impresso = /identificador ([0-9a-f-]{36})/.exec(r.saida())?.[1];
    assert.ok(impresso, 'a saida traz o identificador');
    assert.equal(cena.lerEnvios()[0]!.identificador_de_envio, impresso);
  } finally {
    cena.encerrar();
  }
});

test('--identificador malformado: recusa local, exit 2, sem rede (#1117)', async () => {
  const contador = await subirServidorContador();
  try {
    const r = rede(contador.url, 'k');
    assert.equal(await executarEnviarRede([...BASE, '--texto', 'x', '--identificador', 'nao-e-uuid'], r.rede), 2);
    assert.equal(contador.requisicoes(), 0);
  } finally {
    contador.fechar();
  }
});

test('409: o identificador ja foi usado para outro pedido, e o texto diz isso (#1117)', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const id = '3f2b8c1e-5d4a-4e7b-9c10-1a2b3c4d5e6f';
    await executarEnviarRede([...BASE, '--texto', 'oi', '--identificador', id], rede(cena.url, cena.chave.valor).rede);
    const r = rede(cena.url, cena.chave.valor);
    const codigo = await executarEnviarRede([...BASE, '--texto', 'outro', '--identificador', id], r.rede);
    assert.equal(codigo, 6);
    assert.match(r.saida(), /ja foi usado para outro pedido/);
    assert.equal(cena.lerEnvios().length, 1);
  } finally {
    cena.encerrar();
  }
});

test('servidor que nao ecoa o identificador: o cliente avisa que repetir pode duplicar (#1117)', async () => {
  const srv = createServer((_req, res) => {
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ aceita: true, envioId: 'a' })); // servidor antigo: sem identificador
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  try {
    const r = rede(`http://127.0.0.1:${porta}`, 'k');
    assert.equal(await executarEnviarRede([...BASE, '--texto', 'x'], r.rede), 0);
    assert.match(r.saida(), /nao confirmou o identificador/);
    assert.match(r.saida(), /DUPLICAR/);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('--json com servidor antigo imprime o corpo como veio, sem aviso (#1117)', async () => {
  const srv = createServer((_req, res) => {
    res.writeHead(202, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ aceita: true, envioId: 'a' }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  try {
    const r = rede(`http://127.0.0.1:${porta}`, 'k');
    assert.equal(await executarEnviarRede([...BASE, '--texto', 'x', '--json'], r.rede), 0);
    assert.deepEqual(JSON.parse(r.saida()), { aceita: true, envioId: 'a' });
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('falha de conexao tambem imprime o identificador do pedido (#1117)', async () => {
  const r = rede('http://127.0.0.1:1', 'k');
  const codigo = await executarEnviarRede([...BASE, '--texto', 'x'], r.rede);
  assert.equal(codigo, 4);
  assert.match(r.saida(), UUID);
});

function arquivoTemporario(nome: string, bytes: Buffer): string {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-enviar-rede-'));
  const caminho = join(pasta, nome);
  writeFileSync(caminho, bytes);
  return caminho;
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

test('imagem: o servidor recebe os MESMOS bytes, com legenda e mimetype pela extensao', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7) % 256)); // binario de verdade
    const arquivo = arquivoTemporario('foto.png', bytes);
    const r = rede(cena.url, cena.chave.valor);
    const codigo = await executarEnviarRede([...BASE, '--imagem', arquivo, '--texto', 'legenda'], r.rede);
    assert.equal(codigo, 0, r.saida());
    const envio = cena.lerEnvios()[0]!;
    assert.equal(envio.conteudo_tipo, 'imagem');
    assert.equal(envio.conteudo_mimetype, 'image/png');
    assert.equal(envio.conteudo_texto, 'legenda');
    assert.equal(sha(readFileSync(envio.conteudo_caminho_arquivo!)), sha(bytes));
  } finally {
    cena.encerrar();
  }
});

test('documento: bytes iguais, nome do arquivo e mimetype', async () => {
  const cena = await subirCenaDeEnvio();
  try {
    const bytes = Buffer.from('%PDF-1.4 conteudo de teste');
    const arquivo = arquivoTemporario('relatorio-final.pdf', bytes);
    const r = rede(cena.url, cena.chave.valor);
    const codigo = await executarEnviarRede([...BASE, '--documento', arquivo], r.rede);
    assert.equal(codigo, 0, r.saida());
    const envio = cena.lerEnvios()[0]!;
    assert.equal(envio.conteudo_tipo, 'documento');
    assert.equal(envio.conteudo_nome_arquivo, 'relatorio-final.pdf');
    assert.equal(envio.conteudo_mimetype, 'application/pdf');
    assert.equal(sha(readFileSync(envio.conteudo_caminho_arquivo!)), sha(bytes));
  } finally {
    cena.encerrar();
  }
});

test('pedido acima do limite do corpo: recusa 2 ANTES de abrir conexao, falando do pedido', async () => {
  const s = await subirServidorContador();
  try {
    // 6 MiB + 1 KiB: o arquivo cabe no limite de 8 MiB, mas o base64 (x4/3) + envelope passam dele
    const arquivo = arquivoTemporario('grande.pdf', Buffer.alloc(6 * 1024 * 1024 + 1024, 7));
    const r = rede(s.url, 'k');
    const codigo = await executarEnviarRede([...BASE, '--documento', arquivo], r.rede);
    assert.equal(codigo, 2);
    assert.match(r.saida(), /Pedido de \d+ bytes passa do limite/);
    assert.equal(s.requisicoes(), 0, 'abriu conexao antes de recusar');
  } finally {
    s.fechar();
  }
});

test('arquivo que sozinho passa do limite do corpo: recusa 2 sem abrir conexao', async () => {
  const s = await subirServidorContador();
  try {
    const arquivo = arquivoTemporario('enorme.pdf', Buffer.alloc(LIMITE_DO_CORPO_DE_ENVIO + 1024, 7));
    const r = rede(s.url, 'k');
    const codigo = await executarEnviarRede([...BASE, '--documento', arquivo], r.rede);
    assert.equal(codigo, 2);
    assert.match(r.saida(), /O arquivo tem \d+ bytes/);
    assert.equal(s.requisicoes(), 0);
  } finally {
    s.fechar();
  }
});

test('o limite do cliente e igual ao do servidor (a copia nao pode divergir em silencio)', () => {
  assert.equal(LIMITE_DO_CORPO_DE_ENVIO, TAMANHO_MAXIMO_DO_CORPO_DE_ENVIO);
});
