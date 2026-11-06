import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..');

// Regra do repo: implementacao que contradiz GLOSSARIO.md ou docs/dominio/ atualiza o doc no mesmo commit. Desde o
// Acervo v32 o Envio guarda a Referencia Externa da Mensagem enviada; a frase de que ele "nao guarda ponteiro" mente.
test('o glossario diz que o Envio guarda a Referencia Externa da Mensagem enviada', () => {
  const texto = readFileSync(join(RAIZ, 'GLOSSARIO.md'), 'utf8');
  assert.ok(texto.includes('**guarda a Referência Externa dessa Mensagem**'), 'falta a frase nova do glossario');
  assert.ok(
    !texto.includes('é correlacionado pelo Identificador de Envio com a **Mensagem** que a recepção traz.'),
    'a frase antiga do glossario continua la',
  );
});

test('o modelo de dominio diz que o Envio guarda a Referencia Externa da Mensagem enviada', () => {
  const texto = readFileSync(join(RAIZ, 'docs', 'dominio', 'malote.md'), 'utf8');
  assert.ok(texto.includes('o Envio guarda a **Referência Externa da Mensagem enviada**'), 'falta a frase nova do modelo');
  assert.ok(!texto.includes('o Envio não guarda ponteiro'), 'a frase antiga do modelo continua la');
});
