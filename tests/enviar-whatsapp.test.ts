import { test } from 'node:test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import assert from 'node:assert/strict';
import { registrarEnvio } from '../src/nucleo/envio.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { processarEnvios } from '../src/adaptadores/whatsapp/enviar.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

test('processarEnvios cria a Conversa SO APOS sucesso, quando ela nao existia', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });

    const chamadas: Array<{ jid: string; conteudo: unknown }> = [];
    const resultado = await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async (jid, conteudo) => {
        chamadas.push({ jid, conteudo });
        return { keyId: 'ABC' };
      },
    });

    assert.equal(resultado.processados, 1);
    assert.deepEqual(chamadas, [
      { jid: '5511999990000@s.whatsapp.net', conteudo: { text: 'oi' } },
    ]);

    const linha = acervo
      .preparar('SELECT estado, conversa_id FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; conversa_id: string | null };
    assert.equal(linha.estado, 'enviado');
    assert.ok(linha.conversa_id !== null);

    const conversa = acervo
      .preparar('SELECT fonte, id_externo, coletiva, configuracao_id FROM conversas WHERE id = ?')
      .get(linha.conversa_id) as {
      fonte: string;
      id_externo: string;
      coletiva: number;
      configuracao_id: string;
    };
    assert.equal(conversa.fonte, 'whatsapp');
    assert.equal(conversa.id_externo, '5511999990000@s.whatsapp.net');
    assert.equal(conversa.coletiva, 0);
    assert.equal(conversa.configuracao_id, CFG_WHATSAPP.id);
  } finally {
    c.limpar();
  }
});

test('processarEnvios NAO cria Conversa quando o envio falha definitivamente', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });

    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async () => {
        throw new Error('invalid jid');
      },
    });

    const n = (
      acervo.preparar('SELECT COUNT(*) AS n FROM conversas').get() as { n: number }
    ).n;
    assert.equal(n, 0, 'Conversa nao deveria existir — o envio falhou');
  } finally {
    c.limpar();
  }
});

test('processarEnvios recusa destino_cru sem forma reconhecida (sem @), marca falhou', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000' }, // sem @s.whatsapp.net nem @g.us
      conteudo: { tipo: 'texto', texto: 'oi' },
    });

    const resultado = await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async () => {
        throw new Error('nao deveria ser chamado');
      },
    });

    assert.equal(resultado.processados, 1);
    const linha = acervo
      .preparar('SELECT estado, motivo_falha FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; motivo_falha: string | null };
    assert.equal(linha.estado, 'falhou');
    assert.match(linha.motivo_falha ?? '', /forma/);
  } finally {
    c.limpar();
  }
});

test('processarEnvios com retorno indeterminado soma tentativa, mantem pendente', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });

    const resultado = await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async () => undefined,
    });

    assert.equal(resultado.processados, 1);
    const linha = acervo
      .preparar('SELECT estado, tentativas FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; tentativas: number };
    assert.equal(linha.estado, 'pendente');
    assert.equal(linha.tentativas, 1);
  } finally {
    c.limpar();
  }
});

test('processarEnvios sem pendente na Configuracao devolve processados: 0', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const resultado = await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async () => {
        throw new Error('nao deveria ser chamado');
      },
    });
    assert.equal(resultado.processados, 0);
  } finally {
    c.limpar();
  }
});

test('processarEnvios com Conversa ja existente usa o id_externo dela, sem recriar', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: '5511999990000@s.whatsapp.net',
      coletiva: false,
      configuracao: CFG_WHATSAPP,
    });
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { conversaId },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });

    const chamadas: string[] = [];
    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async (jid) => {
        chamadas.push(jid);
        return { keyId: 'X' };
      },
    });

    assert.deepEqual(chamadas, ['5511999990000@s.whatsapp.net']);
    const n = (acervo.preparar('SELECT COUNT(*) AS n FROM conversas').get() as { n: number }).n;
    assert.equal(n, 1, 'nao deveria ter criado segunda Conversa');
  } finally {
    c.limpar();
  }
});

test('processarEnvios de imagem monta {image, caption} lendo o arquivo de staging', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const pasta = mkdtempSync(joinPath(tmpdir(), 'malote-envio-midia-'));
    const caminho = joinPath(pasta, 'x.jpg');
    writeFileSync(caminho, Buffer.from('bytes-da-imagem'));

    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'imagem', caminhoArquivo: caminho, mimetype: 'image/jpeg', legenda: 'oi' },
    });

    const chamadas: Array<{ jid: string; conteudo: unknown }> = [];
    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async (jid, conteudo) => {
        chamadas.push({ jid, conteudo });
        return { keyId: 'IMG1' };
      },
    });

    assert.equal(chamadas.length, 1);
    const enviado = chamadas[0]!.conteudo as { image: Buffer; caption?: string; mimetype: string };
    assert.equal(enviado.image.toString(), 'bytes-da-imagem');
    assert.equal(enviado.caption, 'oi');
    assert.equal(enviado.mimetype, 'image/jpeg');
  } finally {
    c.limpar();
  }
});

test('processarEnvios de documento monta {document, mimetype, fileName}', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const pasta = mkdtempSync(joinPath(tmpdir(), 'malote-envio-midia-'));
    const caminho = joinPath(pasta, 'doc.pdf');
    writeFileSync(caminho, Buffer.from('bytes-do-pdf'));

    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: {
        tipo: 'documento',
        caminhoArquivo: caminho,
        mimetype: 'application/pdf',
        nomeDeArquivo: 'relatorio.pdf',
      },
    });

    const chamadas: Array<{ jid: string; conteudo: unknown }> = [];
    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async (jid, conteudo) => {
        chamadas.push({ jid, conteudo });
        return { keyId: 'DOC1' };
      },
    });

    const enviado = chamadas[0]!.conteudo as { document: Buffer; mimetype: string; fileName: string };
    assert.equal(enviado.document.toString(), 'bytes-do-pdf');
    assert.equal(enviado.mimetype, 'application/pdf');
    assert.equal(enviado.fileName, 'relatorio.pdf');
  } finally {
    c.limpar();
  }
});

test('processarEnvios de midia com arquivo de staging ausente marca falhou (definitivo)', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'imagem', caminhoArquivo: '/caminho/que/nao/existe.jpg', mimetype: 'image/jpeg' },
    });

    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async () => {
        throw new Error('nao deveria ser chamado');
      },
    });

    const linha = acervo
      .preparar('SELECT estado, motivo_falha FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; motivo_falha: string | null };
    assert.equal(linha.estado, 'falhou');
    assert.match(linha.motivo_falha ?? '', /staging/i);
  } finally {
    c.limpar();
  }
});

test('processarEnvios chama aoEnviar so para midia, nunca para texto — mesmo Acervo, em sequencia', async () => {
  // Teste unico de proposito: "nao chama para texto" so prova algo se, no
  // MESMO cenario, "chama para midia" tambem for exercitado.
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '111@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });
    const pasta = mkdtempSync(joinPath(tmpdir(), 'malote-envio-midia-'));
    const caminho = joinPath(pasta, 'x.jpg');
    writeFileSync(caminho, Buffer.from('bytes'));
    registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '222@s.whatsapp.net' },
      conteudo: { tipo: 'imagem', caminhoArquivo: caminho, mimetype: 'image/jpeg' },
    });

    const chamadas: Array<{ keyId: string; caminho: string }> = [];
    const aoEnviar = (keyId: string, caminhoStaging: string): void => {
      chamadas.push({ keyId, caminho: caminhoStaging });
    };
    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async () => ({ keyId: 'TXT1' }),
      aoEnviar,
    });
    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async () => ({ keyId: 'IMG2' }),
      aoEnviar,
    });

    assert.deepEqual(chamadas, [{ keyId: 'IMG2', caminho }]);
  } finally {
    c.limpar();
  }
});

// Criterio 4 da spec #1112: grupo pela MESMA operacao, sem bifurcacao. O teste
// e de regressao sobre comportamento ja implementado (nao e RED->GREEN); o poder
// dele foi provado por mutacao (coletiva fixada em false).
test('processarEnvios para grupo (@g.us) cria Conversa coletiva, sem Configuracao', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '120363000000000001@g.us' },
      conteudo: { tipo: 'texto', texto: 'oi grupo' },
    });

    const chamadas: string[] = [];
    await processarEnvios(acervo, {
      configuracao: CFG_WHATSAPP,
      enviar: async (jid) => {
        chamadas.push(jid);
        return { keyId: 'G1' };
      },
    });
    assert.deepEqual(chamadas, ['120363000000000001@g.us']);

    const linha = acervo
      .preparar(
        `SELECT e.estado, c.coletiva, c.configuracao_id
           FROM envios e JOIN conversas c ON c.id = e.conversa_id WHERE e.id = ?`,
      )
      .get(r.envioId) as { estado: string; coletiva: number; configuracao_id: string | null };
    assert.equal(linha.estado, 'enviado');
    assert.equal(linha.coletiva, 1);
    assert.equal(linha.configuracao_id, null, 'coletiva pertence ao Inquilino, nao a uma Configuracao');
  } finally {
    c.limpar();
  }
});

// Criterio 6: falha DEPOIS de o sendMessage ter saido nao pode virar `falhou`
// — a mensagem ja foi; `falhou` so volta por reprocessar explicito, e o
// reprocessar reenviaria. Fica `pendente`, e a proxima passada tenta de novo
// (ao menos uma vez, risco nomeado na spec).
test('falha ao gravar `enviado` DEPOIS do envio deixa o Envio pendente, nunca falhou', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia');
    const r = registrarEnvio(acervo, {
      configuracaoId: CFG_WHATSAPP.id,
      destino: { enderecoCru: '5511999990000@s.whatsapp.net' },
      conteudo: { tipo: 'texto', texto: 'oi' },
    });

    let enviou = 0;
    const acervoQueFalhaAoMarcarEnviado = new Proxy(acervo, {
      get(alvo, propriedade, receptor) {
        if (propriedade === 'preparar') {
          return (sql: string) => {
            if (sql.includes("estado = 'enviado'")) throw new Error('disco cheio (injetado)');
            return alvo.preparar(sql);
          };
        }
        return Reflect.get(alvo, propriedade, receptor);
      },
    });

    await assert.rejects(
      processarEnvios(acervoQueFalhaAoMarcarEnviado, {
        configuracao: CFG_WHATSAPP,
        enviar: async () => {
          enviou += 1;
          return { keyId: 'K1' };
        },
      }),
      /disco cheio/,
    );
    assert.equal(enviou, 1, 'o envio saiu antes da falha injetada');

    const linha = acervo
      .preparar('SELECT estado, motivo_falha FROM envios WHERE id = ?')
      .get(r.envioId) as { estado: string; motivo_falha: string | null };
    assert.equal(linha.estado, 'pendente');
    assert.equal(linha.motivo_falha, null);
  } finally {
    c.limpar();
  }
});
