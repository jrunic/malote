import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario } from './ajuda/acervo.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { registrarAnexo, registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { reprocessarMidiaNuncaObtida } from '../src/adaptadores/whatsapp/reprocessar-midia.js';

const BRUTO_AO_VIVO_VIDEO = JSON.stringify({
  key: { remoteJid: '5511000000001@s.whatsapp.net', id: 'M1', fromMe: false },
  messageTimestamp: 1_700_000_000,
  message: { videoMessage: { mediaKey: 'AAAA', directPath: '/x' } },
});

const BRUTO_DE_BACKUP = JSON.stringify({ Z_PK: 1, ZMESSAGETYPE: 1 });

function anexoNuncaObtido(
  acervo: Acervo,
  opcoes: { idExterno: string; tipo: string; mensagemBruto: string; ocorridaEm?: number },
): string {
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp', idExterno: `conversa-${opcoes.idExterno}`, coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
  const mensagemId = registrarMensagem(acervo, {
    conversaId, fonte: 'whatsapp', idExterno: opcoes.idExterno, ocorridaEm: opcoes.ocorridaEm ?? 1_700_000_000_000,
    agora: Date.now(), direcao: 'recebida', bruto: opcoes.mensagemBruto,
  });
  return registrarAnexo(acervo, {
    mensagemId, tipo: opcoes.tipo, presenca: 'nunca-obtido', bruto: '{}',
  });
}

test('Anexo elegivel: baixa, grava, marca presente (#1084)', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const anexoId = anexoNuncaObtido(acervo, {
      idExterno: 'M1', tipo: 'video', mensagemBruto: BRUTO_AO_VIVO_VIDEO,
    });

    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => Promise.resolve(Buffer.from('bytes-de-verdade')),
    });

    assert.equal(r.recuperados, 1);
    assert.equal(r.bytesRecuperados, Buffer.from('bytes-de-verdade').length);
    assert.equal(r.falhas, 0);
    const linha = acervo.db.prepare('SELECT presenca, caminho FROM anexos WHERE id = ?').get(anexoId) as {
      presenca: string; caminho: string;
    };
    assert.equal(linha.presenca, 'presente');
    assert.ok(existsSync(join(d.raiz, linha.caminho)));
    assert.equal(readFileSync(join(d.raiz, linha.caminho), 'utf8'), 'bytes-de-verdade');
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('falha de download conta como falha, mantem nunca-obtido, NAO derruba os demais', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const falho = anexoNuncaObtido(acervo, {
      idExterno: 'M1', tipo: 'video', mensagemBruto: BRUTO_AO_VIVO_VIDEO,
    });
    const emOutraMensagem = JSON.stringify({
      key: { remoteJid: '5511000000002@s.whatsapp.net', id: 'M2', fromMe: false },
      messageTimestamp: 1_700_000_001,
      message: { imageMessage: { mediaKey: 'BBBB', directPath: '/y' } },
    });
    // M2 e mais nova que M1: a ordem de tentativa e por instante da Mensagem, e M1 (a que falha) vai primeiro.
    const recuperavel = anexoNuncaObtido(acervo, {
      idExterno: 'M2', tipo: 'image', mensagemBruto: emOutraMensagem, ocorridaEm: 1_700_000_001_000,
    });

    let chamadas = 0;
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => {
        chamadas += 1;
        return chamadas === 1
          ? Promise.reject(new Error('bad decrypt'))
          : Promise.resolve(Buffer.from('ok'));
      },
    });

    assert.equal(r.falhas, 1);
    assert.equal(r.recuperados, 1);
    const linhaFalha = acervo.db.prepare('SELECT presenca FROM anexos WHERE id = ?').get(falho) as {
      presenca: string;
    };
    assert.equal(linhaFalha.presenca, 'nunca-obtido', 'a falha nao muda a Presenca');
    const linhaOk = acervo.db.prepare('SELECT presenca FROM anexos WHERE id = ?').get(recuperavel) as {
      presenca: string;
    };
    assert.equal(linhaOk.presenca, 'presente', 'o segundo Anexo nao foi derrubado pela falha do primeiro');
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('bruto de material IMPORTADO nunca e elegivel, e conta como nao-elegivel', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const anexoId = anexoNuncaObtido(acervo, {
      idExterno: 'M1', tipo: 'video', mensagemBruto: BRUTO_DE_BACKUP,
    });

    let chamouBaixar = false;
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => {
        chamouBaixar = true;
        return Promise.resolve(Buffer.from('nunca deveria chegar aqui'));
      },
    });

    assert.equal(chamouBaixar, false, 'nao tenta baixar o que nao e elegivel');
    assert.equal(r.naoElegiveis, 1);
    assert.equal(r.recuperados, 0);
    const linha = acervo.db.prepare('SELECT presenca FROM anexos WHERE id = ?').get(anexoId) as {
      presenca: string;
    };
    assert.equal(linha.presenca, 'nunca-obtido');
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('sem Anexo nunca-obtido nenhum, devolve relatorio zerado sem tentar nada', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    let chamouBaixar = false;
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => { chamouBaixar = true; return Promise.resolve(Buffer.from('x')); },
    });
    assert.equal(chamouBaixar, false);
    assert.deepEqual(r, {
      recuperados: 0, bytesRecuperados: 0, falhas: 0, naoElegiveis: 0, elegiveis: 0, tentados: 0, foraDoLimite: 0,
    });
  } finally {
    c.limpar();
    d.limpar();
  }
});

/** Bruto de recepcao ao vivo cujo `key.id` diz, dentro do `baixar` injetado, de qual Mensagem veio a chamada. */
function brutoDe(id: string, tipo = 'video'): string {
  return JSON.stringify({
    key: { remoteJid: '5511000000001@s.whatsapp.net', id, fromMe: false },
    messageTimestamp: 1_700_000_000,
    message: { [`${tipo}Message`]: { mediaKey: 'AAAA', directPath: '/x' } },
  });
}

const DIA = (d: number) => Date.UTC(2026, 8, d, 12);

/** Quatro Anexos de dias diferentes, inseridos fora de ordem: 25, 21, 27 e 23. */
function quatroDeDiasDiferentes(acervo: Acervo): void {
  for (const [id, dia] of [['N25', 25], ['N21', 21], ['N27', 27], ['N23', 23]] as const) {
    anexoNuncaObtido(acervo, { idExterno: id, tipo: 'image', mensagemBruto: brutoDe(id, 'image'), ocorridaEm: DIA(dia) });
  }
}

function baixarRegistrando(chamadas: string[]): (mensagem: unknown) => Promise<Buffer> {
  return (mensagem) => {
    chamadas.push((mensagem as { key: { id: string } }).key.id);
    return Promise.resolve(Buffer.from('x'));
  };
}

test('o recorte decide o que se tenta: so as Mensagens dentro de desde e ate', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    quatroDeDiasDiferentes(acervo);
    const chamadas: string[] = [];
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: baixarRegistrando(chamadas),
      filtro: { desde: DIA(22), ate: DIA(26) },
    });
    assert.deepEqual(chamadas, ['N23', 'N25'], 'so as de 23 e 25, da mais antiga para a mais nova');
    assert.equal(r.recuperados, 2);
    assert.equal(r.elegiveis, 2);
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('o limite conta tentativas e o corte nunca deixa a Mensagem mais antiga de fora', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    quatroDeDiasDiferentes(acervo);
    const chamadas: string[] = [];
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, { baixar: baixarRegistrando(chamadas), limite: 2 });
    assert.deepEqual(chamadas, ['N21', 'N23']);
    assert.equal(r.tentados, 2);
    assert.equal(r.foraDoLimite, 2);
    assert.equal(r.elegiveis, 4);
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('o limite conta tentativa que falhou, nao so a que deu certo', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    quatroDeDiasDiferentes(acervo);
    let chamadas = 0;
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => { chamadas += 1; return Promise.reject(new Error('403')); },
      limite: 2,
    });
    assert.equal(chamadas, 2, 'duas falhas esgotam o limite de duas tentativas');
    assert.equal(r.falhas, 2);
    assert.equal(r.tentados, 2);
    assert.equal(r.foraDoLimite, 2);
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('o que nao e elegivel nao gasta o limite', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    anexoNuncaObtido(acervo, { idExterno: 'B1', tipo: 'image', mensagemBruto: BRUTO_DE_BACKUP, ocorridaEm: DIA(20) });
    anexoNuncaObtido(acervo, { idExterno: 'V1', tipo: 'image', mensagemBruto: brutoDe('V1', 'image'), ocorridaEm: DIA(21) });
    const chamadas: string[] = [];
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, { baixar: baixarRegistrando(chamadas), limite: 1 });
    assert.deepEqual(chamadas, ['V1'], 'o de backup, mais antigo, nao ocupa a vaga do unico elegivel');
    assert.equal(r.naoElegiveis, 1);
    assert.equal(r.tentados, 1);
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('o ensaio so conta: nao baixa, nao escreve no Acervo e nao cria arquivo', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    quatroDeDiasDiferentes(acervo);
    anexoNuncaObtido(acervo, { idExterno: 'B1', tipo: 'video', mensagemBruto: BRUTO_DE_BACKUP, ocorridaEm: DIA(20) });
    const antes = acervo.db.prepare("SELECT COUNT(*) AS n FROM anexos WHERE presenca = 'nunca-obtido'").get() as { n: number };
    let chamouBaixar = false;
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, {
      baixar: () => { chamouBaixar = true; return Promise.resolve(Buffer.from('x')); },
      ensaio: true,
      limite: 3,
    });
    assert.equal(chamouBaixar, false);
    const depois = acervo.db.prepare("SELECT COUNT(*) AS n FROM anexos WHERE presenca = 'nunca-obtido'").get() as { n: number };
    assert.equal(depois.n, antes.n, 'nenhum Anexo mudou de Presenca');
    assert.equal(readdirSync(d.raiz).length, 0, 'nenhum arquivo foi criado no Destino');
    assert.equal(r.recuperados, 0);
    assert.equal(r.tentados, 0);
    assert.equal(r.elegiveis, 4);
    assert.equal(r.naoElegiveis, 1);
    assert.deepEqual(r.ensaio, {
      candidatos: 5,
      tentaria: 3,
      porTipo: { image: 4 },
      porDia: { '2026-09-21': 1, '2026-09-23': 1, '2026-09-25': 1, '2026-09-27': 1 },
    });
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('sem recorte, sem limite e sem ensaio faz o que sempre fez: tenta todos os elegiveis', async () => {
  const c = cenario();
  const d = instalacaoTemporaria();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    quatroDeDiasDiferentes(acervo);
    const chamadas: string[] = [];
    const r = await reprocessarMidiaNuncaObtida(acervo, d.raiz, { baixar: baixarRegistrando(chamadas) });
    assert.deepEqual([...chamadas].sort(), ['N21', 'N23', 'N25', 'N27']);
    assert.equal(r.recuperados, 4);
    assert.equal(r.tentados, 4);
    assert.equal(r.foraDoLimite, 0);
    assert.equal(r.ensaio, undefined);
  } finally {
    c.limpar();
    d.limpar();
  }
});

test('sem Destino so o ensaio funciona: baixar sem Destino e erro de quem chama, dito antes de qualquer tentativa', async () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    quatroDeDiasDiferentes(acervo);
    let chamouBaixar = false;
    const baixar = () => { chamouBaixar = true; return Promise.resolve(Buffer.from('x')); };
    await assert.rejects(reprocessarMidiaNuncaObtida(acervo, null, { baixar }), /exige o Destino/);
    assert.equal(chamouBaixar, false);
    const r = await reprocessarMidiaNuncaObtida(acervo, null, { baixar, ensaio: true });
    assert.equal(r.elegiveis, 4);
    assert.equal(chamouBaixar, false);
  } finally {
    c.limpar();
  }
});
