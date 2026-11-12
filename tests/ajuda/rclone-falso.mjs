#!/usr/bin/env node
// Substituto do rclone para os testes: so o `rcd`, so as chamadas que o portao usa, com as MESMAS formas de
// resposta que o rclone 1.76 deu contra o Google Drive (medidas em 11/11/2026). O "remoto" e uma pasta:
// `<RCLONE_FALSO_RAIZ>/<remoto>/<pasta>/<arquivo>`. Nada daqui e o produto.
//
// Falhas injetadas por `<RCLONE_FALSO_RAIZ>/.falhas.json`, lido a cada chamada:
//   { "copyfile_cota": N, "copyfile_drive_cheio": N, "copyfile_erro": N, "stat_hash_errado": true, "stat_sem_hash": true,
//     "perder": ["<arquivo>"], "duplicar": ["<arquivo>"] }
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

const raiz = process.env.RCLONE_FALSO_RAIZ;
const [, , comando, ...resto] = process.argv;
if (comando !== 'rcd' || raiz === undefined) {
  console.error('rclone falso: so aceita `rcd` e exige RCLONE_FALSO_RAIZ');
  process.exit(2);
}
writeFileSync(join(raiz, '.argv.json'), JSON.stringify(process.argv.slice(2)));
const endereco = resto[resto.indexOf('--rc-addr') + 1] ?? '127.0.0.1:5599';
const [host, porta] = endereco.split(':');
const usuario = process.env.RCLONE_RC_USER;
const senha = process.env.RCLONE_RC_PASS;
const contadores = {};

function falhas() {
  const arquivo = join(raiz, '.falhas.json');
  return existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, 'utf8')) : {};
}
function consumir(nome) {
  const limite = falhas()[nome] ?? 0;
  contadores[nome] = (contadores[nome] ?? 0) + 1;
  return contadores[nome] <= limite;
}
function dirDoFs(fs) {
  if (fs.startsWith('/')) return fs;
  const [remoto, ...pasta] = fs.split(':');
  return join(raiz, remoto, pasta.join(':'));
}
function item(dir, relativo) {
  const abs = join(dir, relativo);
  const conteudo = readFileSync(abs);
  const f = falhas();
  const sha = f.stat_sem_hash
    ? undefined
    : f.stat_hash_errado
      ? 'f'.repeat(64)
      : createHash('sha256').update(conteudo).digest('hex');
  return {
    Path: relativo,
    Name: relativo.split('/').pop(),
    Size: statSync(abs).size,
    IsDir: false,
    ...(sha === undefined ? {} : { Hashes: { sha256: sha } }),
    ID: `id-${createHash('sha1').update(abs).digest('hex').slice(0, 12)}`,
    OrigID: `id-${createHash('sha1').update(abs).digest('hex').slice(0, 12)}`,
  };
}
function varrer(dir, prefixo = '') {
  if (!existsSync(dir)) return [];
  const saida = [];
  for (const nome of readdirSync(dir)) {
    if (nome.startsWith('.')) continue;
    const relativo = prefixo === '' ? nome : `${prefixo}/${nome}`;
    if (statSync(join(dir, nome)).isDirectory()) saida.push(...varrer(join(dir, nome), relativo));
    else saida.push(relativo);
  }
  return saida;
}
function responder(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(corpo));
}

createServer((req, res) => {
  const esperado = `Basic ${Buffer.from(`${usuario}:${senha}`).toString('base64')}`;
  if (req.headers.authorization !== esperado) return responder(res, 401, { error: 'unauthorized', status: 401 });
  let texto = '';
  req.on('data', (d) => (texto += d));
  req.on('end', () => {
    const caminho = (req.url ?? '').replace(/^\//, '');
    const c = texto === '' ? {} : JSON.parse(texto);
    appendFileSync(join(raiz, '.chamadas.jsonl'), `${JSON.stringify({ caminho })}\n`);
    const f = falhas();
    if (caminho === 'core/version') return responder(res, 200, { version: 'v1.76.0-falso' });
    if (caminho === 'core/pid') return responder(res, 200, { pid: process.pid });
    if (caminho === 'operations/copyfile') {
      if (consumir('copyfile_cota')) return responder(res, 403, { error: 'googleapi: Error 403: User rate limit exceeded, userRateLimitExceeded', status: 403 });
      if (consumir('copyfile_drive_cheio')) return responder(res, 403, { error: "googleapi: Error 403: The user's Drive storage quota has been exceeded., storageQuotaExceeded", status: 403 });
      if (consumir('copyfile_erro')) return responder(res, 500, { error: 'erro de teste', status: 500 });
      const origem = join(dirDoFs(c.srcFs), c.srcRemote);
      if (!existsSync(origem)) return responder(res, 404, { error: 'object not found', status: 404 });
      const destino = join(dirDoFs(c.dstFs), c.dstRemote);
      mkdirSync(dirname(destino), { recursive: true });
      copyFileSync(origem, destino);
      return responder(res, 200, {});
    }
    if (caminho === 'operations/stat') {
      const dir = dirDoFs(c.fs);
      if (!existsSync(join(dir, c.remote)) || (f.perder ?? []).includes(c.remote)) return responder(res, 200, { item: null });
      return responder(res, 200, { item: item(dir, c.remote) });
    }
    if (caminho === 'operations/list') {
      const dir = dirDoFs(c.fs);
      const base = join(dir, c.remote);
      const arquivos = varrer(base).map((relativo) => (c.remote === '' ? relativo : `${c.remote}/${relativo}`));
      const lista = arquivos.flatMap((relativo) => {
        const i = item(dir, relativo);
        return (f.duplicar ?? []).includes(relativo) ? [i, { ...i, ID: `${i.ID}-copia`, OrigID: `${i.OrigID}-copia` }] : [i];
      });
      return responder(res, 200, { list: lista });
    }
    if (caminho === 'operations/deletefile') {
      const destino = join(dirDoFs(c.fs), c.remote);
      if (!existsSync(destino)) return responder(res, 404, { error: 'object not found', status: 404 });
      rmSync(destino);
      return responder(res, 200, {});
    }
    return responder(res, 404, { error: `rota desconhecida: ${caminho}`, status: 404 });
  });
}).listen(Number(porta), host);

process.on('SIGTERM', () => process.exit(0));
