import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comCenario, consultorDe } from './ajuda/indice-de-midia.js';
import { executarIndiceDeMidia } from '../src/cli/indice-de-midia.js';

test('o comando grava o HTML: rotulos com NN que recomeca no dia, links dos que tem Localizacao, situacao dos demais, e nada do texto', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-indice-'));
  await comCenario(
    { consultarLocalizacoes: consultorDe((ids) => ({ tipo: 'localizacoes', porAnexo: { [ids[0] as string]: { idNoRemoto: '1AbCdEfGhIjKlMnOp', copiaLocalRemovida: true } } })) },
    async (c, _ids, rede, saidas) => {
      const arquivo = join(pasta, 'indice.html');
      assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', c.conversaDeA, '--saida', arquivo], rede), 0, saidas.join('\n'));
      const html = readFileSync(arquivo, 'utf8');
      assert.equal(statSync(arquivo).mode & 0o777, 0o600, 'dado pessoal: so o dono le');
      assert.ok(!html.includes('TEXTO-SECRETO'));
      assert.match(html, /<td>20260901-001-5565900000001<\/td><td>image<\/td><td>1\.5 KiB<\/td><td><a href="https:\/\/drive\.google\.com\/file\/d\/1AbCdEfGhIjKlMnOp\/view"/);
      assert.match(html, /<td>20260901-002-5565900000001<\/td><td>audio<\/td><td>1\.5 KiB<\/td><td>pendente de envio<\/td>/);
      assert.match(html, /<td>20260901-003-5565900000001<\/td><td>image<\/td><td>1\.5 KiB<\/td><td>nao obtido<\/td>/);
      assert.match(html, /<td>20260902-001-5565900000001<\/td>/, 'o dia seguinte recomeca em 001');
      assert.match(saidas.join('\n'), /4 midia\(s\), 1 com link/);

      // determinista, e nao sobrescreve sem pedir
      const antes = readFileSync(arquivo, 'utf8');
      assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', c.conversaDeA, '--saida', arquivo], rede), 2);
      assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', c.conversaDeA, '--saida', arquivo, '--sobrescrever'], rede), 0);
      assert.equal(readFileSync(arquivo, 'utf8'), antes);

      // --tipo so esconde linhas: o NN nao muda
      const so = join(pasta, 'so-audio.html');
      assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', c.conversaDeA, '--tipo', 'audio', '--saida', so], rede), 0);
      const htmlAudio = readFileSync(so, 'utf8');
      assert.match(htmlAudio, /20260901-002-5565900000001/);
      assert.ok(!htmlAudio.includes('20260901-001-'));
    },
  );
});

test('com Destino Remoto e o Servico fora do ar o comando NAO grava (exit 5); Conversa inexistente sai 6; sem --conversa ou com --inquilino sai 2', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-indice-'));
  await comCenario({ consultarLocalizacoes: consultorDe(() => ({ tipo: 'servico-fora' })) }, async (c, _ids, rede, saidas) => {
    const arquivo = join(pasta, 'nao-deve-existir.html');
    assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', c.conversaDeA, '--saida', arquivo], rede), 5);
    assert.ok(!existsSync(arquivo));
    assert.match(saidas.join('\n'), /nao da para montar os links/);
    assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', 'nao-existe', '--saida', arquivo], rede), 6);
    assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--saida', arquivo], rede), 2);
    assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', 'x', '--inquilino', 'y'], rede), 2);
    assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', 'x', '--de', '2026-09-01'], rede), 2);
    assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', 'x', '--de', '20261340'], rede), 2, 'dia que nao existe');
  });
});

test('com --sobrescrever o arquivo antigo vira 0600 (o modo do writeFileSync so vale na criacao), e a pasta inexistente e erro de uso, nao excecao', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'malote-indice-'));
  await comCenario({ consultarLocalizacoes: consultorDe(() => ({ tipo: 'localizacoes', porAnexo: {} })) }, async (c, _ids, rede, saidas) => {
    const arquivo = join(pasta, 'antigo.html');
    writeFileSync(arquivo, 'antigo');
    chmodSync(arquivo, 0o644);
    assert.equal(await executarIndiceDeMidia(['indice-de-midia', '--conversa', c.conversaDeA, '--saida', arquivo, '--sobrescrever'], rede), 0, saidas.join('\n'));
    assert.equal(statSync(arquivo).mode & 0o777, 0o600, 'dado pessoal: 0600 tambem ao sobrescrever');
    assert.ok(!existsSync(`${arquivo}.parcial`), 'o temporario saiu');

    const antes = saidas.length;
    const codigo = await executarIndiceDeMidia(['indice-de-midia', '--conversa', c.conversaDeA, '--saida', join(pasta, 'nao', 'existe', 'x.html')], rede);
    assert.equal(codigo, 2);
    assert.match(saidas.slice(antes).join('\n'), /pasta .* nao existe/);
  });
});
