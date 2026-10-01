import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeRepeteONumeroBrasileiro } from '../src/adaptadores/whatsapp/nome-repete-numero-br.js';

// Par REAL medido no Acervo de producao em 30/09/2026 (tarefa #1101): 1.110
// de 1.110 nomes 'titular' com prefixo '+55' que nomeRepeteOEndereco (nucleo)
// deixava passar tinham exatamente esta forma — o nono digito movel
// brasileiro (2012) inserido logo apos o DDD.
test('nome com nono digito bate contra endereco sem ele', () => {
  assert.equal(
    nomeRepeteONumeroBrasileiro('+55 65 99229-0832', '556592290832@s.whatsapp.net'),
    true,
  );
});

test('funciona no sentido inverso — endereco com nono, nome sem', () => {
  assert.equal(
    nomeRepeteONumeroBrasileiro('+55 65 2290-0832', '5565922900832@s.whatsapp.net'),
    true,
  );
});

test('continua reconhecendo o que nomeRepeteOEndereco (nucleo) ja pegava', () => {
  assert.equal(
    nomeRepeteONumeroBrasileiro('+55 11 99999-0008', '5511999990008@s.whatsapp.net'),
    true,
  );
  assert.equal(nomeRepeteONumeroBrasileiro('Ana Prado', '5511999990008@s.whatsapp.net'), false);
});

test('numero de OUTRA pessoa, so por coincidencia de tamanho, nao e aceito', () => {
  assert.equal(
    nomeRepeteONumeroBrasileiro('+55 65 98888-7777', '556592290832@s.whatsapp.net'),
    false,
  );
});

test('digito inserido que NAO e 9 nao conta como nono digito', () => {
  // Mesmo comprimento e mesmo DDI+DDD, mas o digito extra e '1', nao '9' —
  // nao e a convencao do nono digito movel, e' outra coisa (ou coincidencia).
  assert.equal(
    nomeRepeteONumeroBrasileiro('+55 65 12290-0832', '556592290832@s.whatsapp.net'),
    false,
  );
});

test('sem DDI 55, o mesmo padrao de insercao nao dispara a regra', () => {
  // 13 dígitos que, removendo o do meio (posição 4), bateriam com os 12 do
  // endereço — mas não começa com '55'. É o mesmo formato estrutural do caso
  // brasileiro, deliberadamente fora da regra: o nono dígito é convenção da
  // numeração móvel do Brasil, não uma coincidência aritmética genérica.
  assert.equal(nomeRepeteONumeroBrasileiro('1234567890123', '123467890123@s.whatsapp.net'), false);
});
