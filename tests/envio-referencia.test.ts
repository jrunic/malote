import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerEnvio, marcarEnvioEnviado, registrarEnvio } from '../src/nucleo/envio.js';
import { processarEnvios } from '../src/adaptadores/whatsapp/enviar.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const PARA = '556599991234@s.whatsapp.net';

function pedido(acervo: Parameters<typeof registrarEnvio>[0], texto: string) {
  return registrarEnvio(acervo, {
    configuracaoId: CFG_WHATSAPP.id,
    destino: { enderecoCru: PARA },
    conteudo: { tipo: 'texto', texto },
  });
}

function linha(acervo: Parameters<typeof registrarEnvio>[0], id: string) {
  return acervo
    .preparar('SELECT estado, concluida_em, referencia_externa_da_mensagem AS ref FROM envios WHERE id = ?')
    .get(id) as { estado: string; concluida_em: string | null; ref: string | null };
}

test('marcarEnvioEnviado grava estado, instante e Referencia Externa no MESMO UPDATE', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const alvo = pedido(acervo, 'um');
    const outro = pedido(acervo, 'dois');
    // Um gatilho conta cada UPDATE que muda o Envio e o que ele deixou gravado naquele instante.
    acervo.db.exec(`
      CREATE TEMP TABLE updates_vistos (id TEXT, estado TEXT, ref TEXT);
      CREATE TEMP TRIGGER vigia AFTER UPDATE ON envios BEGIN
        INSERT INTO updates_vistos VALUES (new.id, new.estado, new.referencia_externa_da_mensagem);
      END;
    `);
    marcarEnvioEnviado(acervo, alvo.envioId, 'REF-SINTETICA-1');
    const vistos = acervo.db.prepare('SELECT * FROM updates_vistos').all() as Array<{ id: string; estado: string; ref: string | null }>;
    assert.equal(vistos.length, 1, 'tem de ser um UPDATE so');
    assert.deepEqual(vistos[0], { id: alvo.envioId, estado: 'enviado', ref: 'REF-SINTETICA-1' });
    const l = linha(acervo, alvo.envioId);
    assert.equal(l.estado, 'enviado');
    assert.ok(l.concluida_em !== null);
    assert.equal(l.ref, 'REF-SINTETICA-1');
    assert.equal(linha(acervo, outro.envioId).ref, null, 'nao mexe em outro Envio');
    assert.equal(linha(acervo, outro.envioId).estado, 'pendente');
  } finally {
    c.limpar();
  }
});

test('processarEnvios de texto grava o keyId do retorno como Referencia Externa', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const r = pedido(acervo, 'oi');
    await processarEnvios(acervo, { configuracao: CFG_WHATSAPP, enviar: async () => ({ keyId: 'KEY-TEXTO-1' }) });
    assert.equal(linha(acervo, r.envioId).ref, 'KEY-TEXTO-1');
    assert.equal(linha(acervo, r.envioId).estado, 'enviado');
  } finally {
    c.limpar();
  }
});

test('processarEnvios de imagem grava o keyId como Referencia Externa', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const staging = mkdtempSync(join(tmpdir(), 'ref-env-'));
    const caminho = join(staging, 'a.jpg');
    writeFileSync(caminho, Buffer.from([0xff, 0xd8, 0xff]));
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: PARA },
      conteudo: { tipo: 'imagem', caminhoArquivo: caminho, mimetype: 'image/jpeg' },
    });
    await processarEnvios(acervo, { configuracao: CFG_WHATSAPP, enviar: async () => ({ keyId: 'KEY-IMAGEM-1' }) });
    assert.equal(linha(acervo, r.envioId).ref, 'KEY-IMAGEM-1');
  } finally {
    c.limpar();
  }
});

test('Envio que falhou ou ficou indeterminado nao ganha Referencia Externa', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const indeterminado = pedido(acervo, 'a');
    await processarEnvios(acervo, { configuracao: CFG_WHATSAPP, enviar: async () => undefined });
    assert.equal(linha(acervo, indeterminado.envioId).ref, null);
    assert.equal(linha(acervo, indeterminado.envioId).estado, 'pendente');
    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async () => {
        throw new Error('destino invalido');
      },
    });
    assert.equal(linha(acervo, indeterminado.envioId).ref, null);
    assert.equal(linha(acervo, indeterminado.envioId).estado, 'falhou');
  } finally {
    c.limpar();
  }
});

test('o contrato de leitura do Envio nao expoe a Referencia Externa (criterio 11)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const r = pedido(acervo, 'oi');
    marcarEnvioEnviado(acervo, r.envioId, 'REF-QUE-NAO-SAI');
    const lido = lerEnvio(acervo, r.envioId);
    assert.ok(lido);
    assert.deepEqual(Object.keys(lido).sort(), [
      'concluidaEm',
      'configuracaoId',
      'envioId',
      'estado',
      'identificadorDeEnvio',
      'motivoFalha',
      'solicitadaEm',
      'tentativas',
      'tipo',
    ]);
    assert.ok(!JSON.stringify(lido).includes('REF-QUE-NAO-SAI'));
  } finally {
    c.limpar();
  }
});

test('a gravacao que falha depois do envio deixa a Referencia nula, e a passada seguinte guarda a da ULTIMA tentativa', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const r = pedido(acervo, 'oi');
    let marcacoes = 0;
    const acervoQueFalhaUmaVez = new Proxy(acervo, {
      get(alvo, propriedade, receptor) {
        if (propriedade === 'preparar') {
          return (sql: string) => {
            if (sql.includes("estado = 'enviado'") && (marcacoes += 1) === 1) throw new Error('disco cheio (injetado)');
            return alvo.preparar(sql);
          };
        }
        return Reflect.get(alvo, propriedade, receptor);
      },
    });
    await assert.rejects(
      processarEnvios(acervoQueFalhaUmaVez, { configuracao: CFG_WHATSAPP, enviar: async () => ({ keyId: 'K1-PRIMEIRA' }) }),
      /disco cheio/,
    );
    assert.equal(linha(acervo, r.envioId).ref, null, 'a falha da gravacao nao deixa Referencia');
    assert.equal(linha(acervo, r.envioId).estado, 'pendente');
    await processarEnvios(acervoQueFalhaUmaVez, { configuracao: CFG_WHATSAPP, enviar: async () => ({ keyId: 'K2-ULTIMA' }) });
    assert.equal(linha(acervo, r.envioId).estado, 'enviado');
    assert.equal(linha(acervo, r.envioId).ref, 'K2-ULTIMA', 'fica a da ultima tentativa');
  } finally {
    c.limpar();
  }
});

test('marcarEnvioEnviado de novo sobre o mesmo Envio fica com a Referencia da ULTIMA chamada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const r = pedido(acervo, 'oi');
    marcarEnvioEnviado(acervo, r.envioId, 'REF-PRIMEIRA');
    marcarEnvioEnviado(acervo, r.envioId, 'REF-ULTIMA');
    assert.equal(linha(acervo, r.envioId).ref, 'REF-ULTIMA');
  } finally {
    c.limpar();
  }
});
