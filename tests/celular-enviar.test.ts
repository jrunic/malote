import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { registrarEnvio } from '../src/nucleo/envio.js';
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
