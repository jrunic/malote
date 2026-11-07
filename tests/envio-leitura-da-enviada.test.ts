import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { processarEnvios } from '../src/adaptadores/whatsapp/enviar.js';
import {
  SQL_BRUTO_DA_MENSAGEM_ENVIADA,
  lerBrutoDaMensagemEnviada,
  marcarEnvioEnviado,
  registrarEnvio,
} from '../src/nucleo/envio.js';

const PARA = '556599991234@s.whatsapp.net';
const OUTRA_CONFIGURACAO = 'configuracao-de-outra-conta';

function conversa(acervo: Acervo, fonte: 'whatsapp' | 'instagram' = 'whatsapp'): string {
  return registrarConversa(acervo, {
    fonte,
    idExterno: fonte === 'whatsapp' ? PARA : 'ig-conversa-1',
    coletiva: fonte === 'instagram',
    ...(fonte === 'whatsapp' ? { configuracao: CFG_WHATSAPP } : {}),
  });
}

function mensagem(
  acervo: Acervo,
  conversaId: string,
  idExterno: string,
  opcoes: { direcao?: 'enviada' | 'recebida'; bruto?: string | null; fonte?: 'whatsapp' | 'instagram' } = {},
): void {
  registrarMensagem(acervo, {
    conversaId,
    fonte: opcoes.fonte ?? 'whatsapp',
    idExterno,
    conteudo: 'texto sintetico',
    ocorridaEm: Date.now() - 1000,
    direcao: opcoes.direcao ?? 'enviada',
    ...(opcoes.bruto === null ? {} : { bruto: opcoes.bruto ?? `{"id":"${idExterno}"}` }),
    origemDaChegada: 'ao-vivo',
    agora: Date.now(),
  });
}

function envioEnviado(acervo: Acervo, configuracaoId: string, referencia: string | undefined): string {
  const r = registrarEnvio(acervo, {
    configuracaoId,
    destino: { enderecoCru: PARA },
    conteudo: { tipo: 'texto', texto: `texto ${referencia ?? 'sem referencia'} ${configuracaoId}` },
  });
  if (referencia !== undefined) marcarEnvioEnviado(acervo, r.envioId, referencia);
  return r.envioId;
}

test('devolve o bruto da Mensagem enviada quando ha Envio da mesma Configuracao com a mesma Referencia Externa', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo);
    mensagem(acervo, cv, 'REF-A', { bruto: '{"key":{"id":"REF-A","fromMe":true}}' });
    envioEnviado(acervo, CFG_WHATSAPP.id, 'REF-A');
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-A'), '{"key":{"id":"REF-A","fromMe":true}}');
  } finally {
    c.limpar();
  }
});

test('Mensagem enviada SEM Envio e invisivel, ainda que haja outra com Envio', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo);
    mensagem(acervo, cv, 'REF-DO-MALOTE');
    mensagem(acervo, cv, 'REF-DE-OUTRO-APARELHO');
    envioEnviado(acervo, CFG_WHATSAPP.id, 'REF-DO-MALOTE');
    assert.ok(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-DO-MALOTE') !== undefined);
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-DE-OUTRO-APARELHO'), undefined);
  } finally {
    c.limpar();
  }
});

test('Envio de OUTRA Configuracao nao libera a Mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo);
    mensagem(acervo, cv, 'REF-B');
    envioEnviado(acervo, OUTRA_CONFIGURACAO, 'REF-B');
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-B'), undefined);
    assert.ok(lerBrutoDaMensagemEnviada(acervo, OUTRA_CONFIGURACAO, 'REF-B') !== undefined, 'a dona do Envio le');
  } finally {
    c.limpar();
  }
});

test('Envio PENDENTE, sem Referencia Externa, nao libera nada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo);
    mensagem(acervo, cv, 'REF-C');
    envioEnviado(acervo, CFG_WHATSAPP.id, undefined);
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-C'), undefined);
  } finally {
    c.limpar();
  }
});

test('Mensagem de direcao RECEBIDA com o identificador do Envio nao e devolvida', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo);
    mensagem(acervo, cv, 'REF-D', { direcao: 'recebida' });
    envioEnviado(acervo, CFG_WHATSAPP.id, 'REF-D');
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-D'), undefined);
  } finally {
    c.limpar();
  }
});

test('Mensagem de outra Fonte com o mesmo identificador nao e devolvida', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo, 'instagram');
    mensagem(acervo, cv, 'REF-E', { fonte: 'instagram' });
    envioEnviado(acervo, CFG_WHATSAPP.id, 'REF-E');
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-E'), undefined);
  } finally {
    c.limpar();
  }
});

test('Envio com Referencia Externa e Mensagem ainda nao gravada, ou sem bruto: undefined', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo);
    envioEnviado(acervo, CFG_WHATSAPP.id, 'REF-F');
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-F'), undefined, 'eco ainda nao gravado');
    mensagem(acervo, cv, 'REF-F', { bruto: null });
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-F'), undefined, 'sem bruto');
  } finally {
    c.limpar();
  }
});

test('Acervo vazio: undefined, sem lancar', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'QUALQUER'), undefined);
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, ''), undefined);
  } finally {
    c.limpar();
  }
});

test('a leitura usa os dois indices e nao varre tabela', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const plano = (
      acervo.db.prepare(`EXPLAIN QUERY PLAN ${SQL_BRUTO_DA_MENSAGEM_ENVIADA}`).all(CFG_WHATSAPP.id, 'X') as Array<{
        detail: string;
      }>
    ).map((l) => l.detail);
    const texto = plano.join(' | ');
    assert.match(texto, /envios_por_referencia/, `nao usa o indice parcial de Envio: ${texto}`);
    assert.match(texto, /USING INDEX sqlite_autoindex_mensagens/, `nao usa o indice unico de Mensagem: ${texto}`);
    assert.ok(!plano.some((d) => /^SCAN/.test(d)), `varre tabela: ${texto}`);
  } finally {
    c.limpar();
  }
});

test('Envio ENVIADO com Referencia nula (o anterior a v32) nao libera a Mensagem enviada de mesmo identificador', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo);
    mensagem(acervo, cv, 'REF-ANTIGA');
    const id = envioEnviado(acervo, CFG_WHATSAPP.id, 'REF-ANTIGA');
    assert.ok(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-ANTIGA') !== undefined, 'com a Referencia, le');
    // Reproduz o Envio concluido antes da migracao: estado enviado, Referencia nula.
    acervo.db.prepare('UPDATE envios SET referencia_externa_da_mensagem = NULL WHERE id = ?').run(id);
    assert.equal(
      (acervo.db.prepare('SELECT estado FROM envios WHERE id = ?').get(id) as { estado: string }).estado,
      'enviado',
    );
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'REF-ANTIGA'), undefined);
  } finally {
    c.limpar();
  }
});

test('Envio reenviado depois de falha da contabilidade: so a Mensagem da ultima tentativa e lida', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    const cv = conversa(acervo);
    mensagem(acervo, cv, 'K1-PRIMEIRA');
    mensagem(acervo, cv, 'K2-ULTIMA');
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: PARA },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
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
    await processarEnvios(acervoQueFalhaUmaVez, { configuracao: CFG_WHATSAPP, enviar: async () => ({ keyId: 'K2-ULTIMA' }) });
    assert.equal(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'K1-PRIMEIRA'), undefined, 'a primeira so vive na memoria');
    assert.ok(lerBrutoDaMensagemEnviada(acervo, CFG_WHATSAPP.id, 'K2-ULTIMA') !== undefined);
  } finally {
    c.limpar();
  }
});
