import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { registrarEnvio, type DestinoDeEnvio } from '../src/nucleo/envio.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { processarEnvios } from '../src/adaptadores/whatsapp/enviar.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';

test('a Conversa que o Envio cria, para a forma alternativa de um celular ja visto, e a Conversa existente', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    const existente = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: SEM_NOVE,
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: COM_NOVE },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });

    await processarEnvios(acervo, { configuracao: CFG_WHATSAPP, enviar: async () => ({ keyId: 'ABC' }) });

    const linha = acervo.preparar('SELECT estado, conversa_id FROM envios WHERE id = ?').get(r.envioId) as {
      estado: string;
      conversa_id: string | null;
    };
    assert.equal(linha.estado, 'enviado');
    assert.equal(linha.conversa_id, existente);
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM conversas WHERE coletiva = 0').get() as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('Envio para a forma errada de um numero desconhecido: a resposta pela forma real fica com o Identificador na forma real (#1364)', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: COM_NOVE },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    await processarEnvios(acervo, { configuracao: CFG_WHATSAPP, enviar: async () => ({ keyId: 'ABC' }) });
    const pares = (): unknown[] =>
      acervo.db.prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo').all();
    assert.deepEqual(pares(), [], 'o destino que o operador digitou nao e evidencia da plataforma');

    receberEvento(
      acervo,
      [{ key: { remoteJid: SEM_NOVE, id: 'RESP2222', fromMe: false }, messageTimestamp: 1_791_300_000, message: { conversation: 'oi' } }],
      { origemDaChegada: 'ao-vivo', agora: 1_791_300_000_000, configuracao: CFG_WHATSAPP },
    );

    assert.deepEqual(pares(), [{ alternativo: COM_NOVE, canonico: SEM_NOVE }]);
    const ids = acervo.db.prepare('SELECT valor FROM identificadores WHERE valor IN (?, ?)').all(SEM_NOVE, COM_NOVE) as Array<{ valor: string }>;
    assert.deepEqual(ids.map((l) => l.valor), [SEM_NOVE]);
  } finally {
    c.limpar();
  }
});

const FIXO = '556132221234@s.whatsapp.net';
const CELULAR_DE_OUTRO_DDD = '5561999991234@s.whatsapp.net';
const LID = '100000000000001@lid';

/** Processa um Envio e devolve o endereco que o cliente de WhatsApp falso recebeu. */
async function destinoRecebido(acervo: Acervo, destino: DestinoDeEnvio): Promise<string | undefined> {
  registrarEnvio(acervo, { configuracaoId: CFG_WHATSAPP.id, destino, conteudo: { tipo: 'texto', texto: 'oi' } });
  let recebido: string | undefined;
  await processarEnvios(acervo, {
    configuracao: CFG_WHATSAPP,
    enviar: async (jid) => {
      recebido = jid;
      return { keyId: 'ABC' };
    },
  });
  return recebido;
}

test('Envio pela forma gravada do celular: o cliente recebe a gravada', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    assert.equal(await destinoRecebido(acervo, { enderecoCru: SEM_NOVE }), SEM_NOVE);
  } finally {
    c.limpar();
  }
});

test('Envio pela alternativa de um celular que o Acervo tem gravado: o cliente recebe a gravada, e o par e aprendido', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    assert.equal(await destinoRecebido(acervo, { enderecoCru: COM_NOVE }), SEM_NOVE);
    const pares = acervo.db.prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco').all();
    assert.deepEqual(pares, [{ alternativo: COM_NOVE, canonico: SEM_NOVE }]);
  } finally {
    c.limpar();
  }
});

test('Envio ao numero que o Acervo nao conhece em nenhuma forma: o cliente recebe o que foi pedido, e nenhum par nasce', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    assert.equal(await destinoRecebido(acervo, { enderecoCru: COM_NOVE }), COM_NOVE);
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM correspondencias_de_endereco').get() as { n: number };
    assert.equal(n.n, 0);
  } finally {
    c.limpar();
  }
});

test('Envio ao celular gravado na forma improvavel para o DDD: o pedido na forma provavel vai a gravada', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    // MT entrega 12 digitos; este Acervo guarda a de 13 (uma conta que a plataforma entregou assim).
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: COM_NOVE });
    assert.equal(await destinoRecebido(acervo, { enderecoCru: SEM_NOVE }), COM_NOVE);
  } finally {
    c.limpar();
  }
});

test('Envio registrado ANTES do aprendizado (pendente) e processado depois: usa o par que o Acervo ganhou nesse intervalo', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: COM_NOVE },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: COM_NOVE, canonico: SEM_NOVE });
    let recebido: string | undefined;
    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async (jid) => {
        recebido = jid;
        return { keyId: 'ABC' };
      },
    });
    assert.equal(recebido, SEM_NOVE);
  } finally {
    c.limpar();
  }
});

test('Envio por Conversa gravada na forma alternativa: o cliente recebe a forma que o Acervo guarda', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: COM_NOVE,
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    assert.equal(await destinoRecebido(acervo, { conversaId }), SEM_NOVE);
    const ligada = acervo.db
      .prepare('SELECT c.id AS id, c.id_externo AS endereco FROM envios e JOIN conversas c ON c.id = e.conversa_id')
      .get() as { id: string; endereco: string };
    assert.equal(ligada.endereco, SEM_NOVE, 'o Envio fica na Conversa da forma que o Acervo guarda, onde o eco vai cair');
    assert.notEqual(ligada.id, conversaId);
  } finally {
    c.limpar();
  }
});

test('Envio a fixo, a celular de outro DDD e a um opaco com par: nada muda, o cliente recebe o que foi pedido', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: SEM_NOVE });
    assert.equal(await destinoRecebido(acervo, { enderecoCru: FIXO }), FIXO);
    assert.equal(await destinoRecebido(acervo, { enderecoCru: CELULAR_DE_OUTRO_DDD }), CELULAR_DE_OUTRO_DDD);
    assert.equal(await destinoRecebido(acervo, { enderecoCru: LID }), LID);
  } finally {
    c.limpar();
  }
});
