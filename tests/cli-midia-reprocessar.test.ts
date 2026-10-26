import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalacaoTemporaria, rodar } from './ajuda/instalacao.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { executarMidiaReprocessar } from '../src/cli/index.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

/**
 * #1084: `midia reprocessar` e o UNICO comando local, fora de `ouvir`/`servir`,
 * que precisa ser assincrono (baixar midia e I/O de rede) — testado chamando
 * `executarMidiaReprocessar` direto, mesmo molde de `servir.test.ts`, porque
 * `rodar()` (o helper que o resto de `cli.test.ts` usa) so exercita o
 * `executar()` SINCRONO, e nunca chegaria neste comando.
 */
function ambienteDeTeste(raiz: string): { dados: string; estado: string; escrever: (t: string) => void; linhas: string[] } {
  const linhas: string[] = [];
  return { dados: raiz, estado: raiz, escrever: (t) => linhas.push(t), linhas };
}

test('midia reprocessar sem Destino configurado recusa, mesma mensagem do trazer (#1084)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const inq = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']).saida,
    )?.[1];
    assert.ok(inq);

    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino', inq!, '--tudo'], ambiente);
    assert.notEqual(codigo, 0);
    const saida = ambiente.linhas.join('\n');
    assert.match(saida, /Destino de Midia nao configurado/);
    assert.match(saida, /malote inquilino destino/, 'a mensagem cita o comando que resolve');
  } finally {
    limpar();
  }
});

test('midia reprocessar sem Anexo nunca-obtido nenhum reporta zero, sem estourar (#1084)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1];
    assert.ok(chave);
    const inq = /id: (\S+)/.exec(
      rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']).saida,
    )?.[1];
    assert.ok(inq);
    rodar(raiz, ['inquilino', 'destino', '--chave', chave!, '--inquilino', inq!, '--endereco', raiz]);

    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino', inq!, '--tudo'], ambiente);
    assert.equal(codigo, 0);
    assert.match(ambiente.linhas.join('\n'), /0 recuperado/);
  } finally {
    limpar();
  }
});

test('midia reprocessar sem --inquilino recusa com uso, codigo 2 (#1084)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar'], ambiente);
    assert.equal(codigo, 2);
    assert.match(ambiente.linhas.join('\n'), /Uso: malote midia reprocessar/);
  } finally {
    limpar();
  }
});

/** Uma instalacao com um Inquilino e UM Anexo `nunca-obtido` de recepcao ao vivo (elegivel), sem Destino. */
function instalacaoComUmElegivel(raiz: string, quantos = 1): { inquilino: string; chave: string; mensagemId: string; anexoId: string } {
  const chave = /valor: (\S+)/.exec(rodar(raiz, ['operador', 'chave', 'criar']).saida)?.[1] as string;
  const inquilino = /id: (\S+)/.exec(rodar(raiz, ['inquilino', 'criar', '--chave', chave, '--titular', 'Leia Organa']).saida)?.[1] as string;
  assert.ok(chave && inquilino);
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  try {
    const conversaId = registrarConversa(acervo, {
      fonte: 'whatsapp', idExterno: '5511000000001@s.whatsapp.net', coletiva: false, configuracao: CFG_WHATSAPP,
    });
    let primeiro = { mensagemId: '', anexoId: '' };
    for (let i = 1; i <= quantos; i += 1) {
      const mensagemId = registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        conversaId, fonte: 'whatsapp', idExterno: `M${i}`, ocorridaEm: Date.UTC(2026, 8, 24 + i, 12), agora: Date.now(),
        direcao: 'recebida',
        bruto: JSON.stringify({
          key: { remoteJid: '5511000000001@s.whatsapp.net', id: `M${i}`, fromMe: false },
          messageTimestamp: 1_700_000_000,
          message: { imageMessage: { mediaKey: 'AAAA', directPath: '/x' } },
        }),
      });
      const anexoId = registrarAnexo(acervo, { origemDaChegada: 'importacao', mensagemId, tipo: 'image', presenca: 'nunca-obtido', bruto: '{}' });
      if (i === 1) primeiro = { mensagemId, anexoId };
    }
    return { inquilino, chave, ...primeiro };
  } finally {
    acervo.fechar();
  }
}

function presencaDe(raiz: string, inquilino: string, anexoId: string): string {
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  try {
    return (acervo.db.prepare('SELECT presenca FROM anexos WHERE id = ?').get(anexoId) as { presenca: string }).presenca;
  } finally {
    acervo.fechar();
  }
}

test('sem recorte e sem --tudo recusa com 2, diz quantos tentaria e nao baixa nada (#1248)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, anexoId } = instalacaoComUmElegivel(raiz);
    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino', inquilino], ambiente);
    const saida = ambiente.linhas.join('\n');
    assert.equal(codigo, 2);
    assert.match(saida, /Sem recorte este comando tentaria baixar 1 Anexo/);
    assert.match(saida, /--ensaio/);
    assert.match(saida, /--tudo/);
    assert.doesNotMatch(saida, /recuperado|falharam/, 'nenhuma tentativa de download aconteceu');
    assert.equal(presencaDe(raiz, inquilino, anexoId), 'nunca-obtido');
  } finally {
    limpar();
  }
});

test('a recusa vem antes do Destino: o operador ve a contagem mesmo sem Destino configurado (#1248)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = instalacaoComUmElegivel(raiz);
    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino', inquilino], ambiente);
    assert.equal(codigo, 2);
    assert.doesNotMatch(ambiente.linhas.join('\n'), /Destino de Midia nao configurado/);
  } finally {
    limpar();
  }
});

test('o ensaio funciona sem Destino, conta por tipo e por dia e nao muda nada (#1248)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, anexoId } = instalacaoComUmElegivel(raiz);
    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino', inquilino, '--ensaio'], ambiente);
    const saida = ambiente.linhas.join('\n');
    assert.equal(codigo, 0);
    assert.match(saida, /Ensaio: nada foi baixado e nada foi escrito\./);
    assert.match(saida, /elegiveis: 1 \(tentaria 1\)/);
    assert.match(saida, /por tipo: image 1/);
    assert.match(saida, /por dia \(UTC\): 2026-09-25 1/);
    assert.equal(presencaDe(raiz, inquilino, anexoId), 'nunca-obtido');
  } finally {
    limpar();
  }
});

test('flag de recorte invalida sai 2 com a flag nomeada, antes de abrir o Registro (#1248)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    for (const [flag, valor, trecho] of [['--limite', '0', /--limite/], ['--tipo', 'foto', /--tipo/], ['--desde', 'ontem', /--desde/]] as const) {
      const ambiente = ambienteDeTeste(raiz);
      const codigo = await executarMidiaReprocessar(['midia', 'reprocessar', '--inquilino', 'qualquer', flag, valor], ambiente);
      assert.equal(codigo, 2, flag);
      assert.match(ambiente.linhas.join('\n'), trecho);
      assert.deepEqual(readdirSync(raiz), [], 'nada foi criado na instalacao: nem o Registro foi aberto');
    }
  } finally {
    limpar();
  }
});

test('recorte que nao casa nada reporta zero e sai 0, sem erro (#1248)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino, chave, anexoId } = instalacaoComUmElegivel(raiz);
    rodar(raiz, ['inquilino', 'destino', '--chave', chave, '--inquilino', inquilino, '--endereco', raiz]);
    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(
      ['midia', 'reprocessar', '--inquilino', inquilino, '--mensagem', 'nao-existe'], ambiente,
    );
    assert.equal(codigo, 0);
    assert.match(ambiente.linhas.join('\n'), /0 recuperado/);
    assert.equal(presencaDe(raiz, inquilino, anexoId), 'nunca-obtido');
  } finally {
    limpar();
  }
});

test('o limite chega ao ensaio: com dois elegiveis e --limite 1, tentaria 1 (#1248)', async () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = instalacaoComUmElegivel(raiz, 2);
    const ambiente = ambienteDeTeste(raiz);
    const codigo = await executarMidiaReprocessar(
      ['midia', 'reprocessar', '--inquilino', inquilino, '--ensaio', '--limite', '1'], ambiente,
    );
    assert.equal(codigo, 0);
    assert.match(ambiente.linhas.join('\n'), /elegiveis: 2 \(tentaria 1\)/);
  } finally {
    limpar();
  }
});
