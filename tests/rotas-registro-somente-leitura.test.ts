import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #1132: o worker NUNCA escreve. As rotas de leitura abrem o Registro somente-leitura; a UNICA chamada que escreve
 * e a do `POST /envios/solicitar`, que roda na thread principal. Uma varredura de texto basta para o numero: se uma
 * rota nova abrir o Registro para escrita, este teste a acusa e quem a escreveu decide.
 */
test('so o ajudante do POST de Envio abre o Registro para escrita (#1132)', () => {
  const fonte = readFileSync(join(import.meta.dirname, '..', 'src', 'rede', 'rotas.ts'), 'utf8');
  const escrevendo = fonte.match(/abrirRegistro\(/g) ?? [];
  assert.equal(escrevendo.length, 1, `abrirRegistro( aparece ${escrevendo.length} vezes; so o POST de Envio pode`);
  const i = fonte.indexOf('abrirRegistro(');
  const ajudante = fonte.lastIndexOf('async function responderSolicitacaoDeEnvio', i);
  assert.ok(ajudante >= 0 && ajudante < i, 'a unica chamada esta dentro de responderSolicitacaoDeEnvio');
  const marca = fonte.indexOf('export function responder(');
  assert.ok(i < marca, 'e vem antes de `responder`, onde so ha ajudantes de POST');
  assert.ok((fonte.match(/abrirRegistroSomenteLeitura\(ctx\.dados\)/g) ?? []).length >= 9);
});
