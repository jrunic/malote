import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cenario, type Cenario } from './ajuda/acervo.js';
import { RemotoEmMemoria } from './ajuda/remoto-em-memoria.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import {
  PADROES_DO_DESTINO_REMOTO,
  configurarDestinoRemotoDeMidia,
  type DestinoRemotoDeMidia,
} from '../src/registro/destino-remoto.js';
import {
  abrirLocalizacao,
  caminhoDaLocalizacao,
  lerLocalizacoes,
  resumoDaLocalizacao,
} from '../src/registro/localizacao.js';
import { gravarArquivoDeAnexo } from '../src/nucleo/arquivo-de-anexo.js';
import { listarAnexosPresentes } from '../src/nucleo/anexos-presentes.js';
import { caminhoRemoto } from '../src/nucleo/layout-remoto.js';
import { descartarAnexo } from '../src/nucleo/escrita.js';
import {
  conferirPorAmostra,
  estadoDoArmazenamento,
  inquilinosComDestinoRemoto,
  passadaDeApagarCopiaLocal,
  passadaDeDescartados,
  passadaDeEnvio,
  reconstruirLocalizacao,
  type DependenciasDoServico,
} from '../src/cli/servico-de-armazenamento.js';

const DIA = 24 * 60 * 60 * 1000;
const INSTANTE = Date.UTC(2023, 10, 14);

/**
 * Um Inquilino com 3 Anexos presentes (video, imagem, video), o Destino local e o Destino Remoto declarados, um
 * Remoto em memoria e um relogio que anda 1 s a cada leitura (o limitador de ritmo nunca espera) e comeca 11
 * minutos depois de os arquivos serem escritos (depois da idade minima).
 */
function montar(c: Cenario, mudar: Partial<DestinoRemotoDeMidia> = {}) {
  const { id, acervo, destino } = c.inquilinoComArquivos();
  configurarDestinoDeMidia(c.registro, id, { natureza: 'local', endereco: destino });
  configurarDestinoRemotoDeMidia(c.registro, id, {
    remoto: 'remoto_de_teste',
    ...PADROES_DO_DESTINO_REMOTO,
    ...mudar,
  });
  const remoto = new RemotoEmMemoria();
  let leituras = 0;
  let base = Date.now() + 11 * 60 * 1000;
  const saidas: string[] = [];
  const esperas: number[] = [];
  const dep: DependenciasDoServico = {
    dados: c.raiz,
    estado: c.raiz,
    remoto,
    agora: () => base + 1_000 * leituras++,
    dormir: (ms) => {
      esperas.push(ms);
      return Promise.resolve();
    },
    escrever: (linha) => saidas.push(linha),
  };
  return { id, acervo, destino, remoto, dep, saidas, esperas, avancar: (ms: number) => (base += ms) };
}

function chaveRemota(caminhoLocal: string, pasta = PADROES_DO_DESTINO_REMOTO.pastaBase): string {
  return `remoto_de_teste:${pasta}/${caminhoRemoto(caminhoLocal)}`;
}

test('o envio sobe cada Anexo, verifica pelo hash e registra a Localizacao; reexecutar nao reenvia', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const r = await passadaDeEnvio(m.dep, m.id);
    assert.equal(r.enviados, 3);
    assert.equal(r.falhos, 0);
    assert.equal(m.remoto.arquivos.size, 3);

    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });
    const base = abrirLocalizacao(c.raiz, m.id);
    try {
      const l = lerLocalizacoes(base, presentes.map((a) => a.id));
      assert.equal(l.size, 3);
      for (const a of presentes) {
        assert.ok(m.remoto.arquivos.has(chaveRemota(a.caminho)), 'no layout remoto achatado');
        assert.equal(l.get(a.id)?.hash, a.impressao, 'o hash verificado e a Impressao de Anexo');
        assert.ok(l.get(a.id)?.idNoRemoto);
      }
    } finally {
      base.fechar();
    }

    const de_novo = await passadaDeEnvio(m.dep, m.id);
    assert.equal(de_novo.enviados, 0);
    assert.equal(de_novo.jaEnviados, 3);
    assert.equal(m.remoto.chamadas.filter((x) => x === 'copyfile').length, 3, 'nenhuma copia a mais');
  } finally {
    c.limpar();
  }
});

test('arquivo com menos que a idade minima nao sobe ainda', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    m.avancar(-10 * 60 * 1000); // o relogio volta para logo depois da escrita dos arquivos
    const r = await passadaDeEnvio(m.dep, m.id);
    assert.equal(r.enviados, 0);
    assert.equal(r.adiados, 3);
    assert.equal(m.remoto.arquivos.size, 0);
  } finally {
    c.limpar();
  }
});

test('o remoto que devolve hash errado ou nenhum hash NAO vira Localizacao: o envio falha e fica registrado', async () => {
  for (const defeito of ['hashErrado', 'semHash'] as const) {
    const c = cenario();
    try {
      const m = montar(c);
      m.remoto[defeito] = true;
      const r = await passadaDeEnvio(m.dep, m.id);
      assert.equal(r.enviados, 0, defeito);
      assert.equal(r.falhos, 3, defeito);
      const base = abrirLocalizacao(c.raiz, m.id);
      try {
        const resumo = resumoDaLocalizacao(base);
        assert.equal(resumo.enviados, 0);
        assert.equal(resumo.falhos, 3);
      } finally {
        base.fechar();
      }
      assert.ok(m.saidas.some((s) => /envio falhou/.test(s)));
    } finally {
      c.limpar();
    }
  }
});

test('o limite de cota da API reduz o ritmo, espera e o Anexo que falhou sobe na passada seguinte', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    m.remoto.copiasComCota = 1;
    const r = await passadaDeEnvio(m.dep, m.id);
    assert.equal(r.enviados, 2);
    assert.equal(r.falhos, 0, 'o limite de cota NAO e falha de envio (criterio 13)');
    assert.equal(r.limitesDeCota, 1);
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.falhos, 0, 'nao entra no alarme de falha da frota');
    assert.ok(m.esperas.includes(2_000), `esperou 2 s: ${JSON.stringify(m.esperas)}`);
    assert.ok(m.saidas.some((s) => /ir mais devagar/.test(s)));

    const segunda = await passadaDeEnvio(m.dep, m.id);
    assert.equal(segunda.enviados, 1);
    assert.equal(segunda.jaEnviados, 2);
  } finally {
    c.limpar();
  }
});

test('erro comum do remoto (inclusive Drive cheio) e FALHA de envio, nao pedido de ritmo', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    m.remoto.copiasComErro = 1;
    const r = await passadaDeEnvio(m.dep, m.id);
    assert.equal(r.falhos, 1);
    assert.equal(r.limitesDeCota, 0);
    assert.equal(r.enviados, 2);
    assert.ok(!m.esperas.includes(2_000), 'nao reduz o ritmo');
  } finally {
    c.limpar();
  }
});

test('o pedido de parada vale DEPOIS DO ARQUIVO EM ANDAMENTO: com 1 transferencia, para na primeira copia', async () => {
  const c = cenario();
  try {
    const m = montar(c, { transferencias: 1 });
    let parou = false;
    m.remoto.aposCopiar = () => {
      parou = true;
    };
    const r = await passadaDeEnvio({ ...m.dep, parou: () => parou }, m.id);
    assert.equal(r.enviados, 1, 'o que estava em andamento terminou, nenhum novo foi lancado');
    assert.equal(r.interrompida, true);
    assert.equal(m.remoto.chamadas.filter((x) => x === 'copyfile').length, 1);
  } finally {
    c.limpar();
  }
});

test('um Anexo com caminho local fora da forma e adiado com a razao; os outros sobem e a passada nao aborta', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });
    m.acervo.db.prepare('UPDATE anexos SET caminho = ? WHERE id = ?').run('fora/da/forma', presentes[1]?.id as string);
    const r = await passadaDeEnvio(m.dep, m.id);
    assert.equal(r.enviados, 2);
    assert.equal(r.adiados, 1);
    assert.ok(m.saidas.some((s) => /caminho local fora da forma/.test(s)));
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.pendentes, 1);
  } finally {
    c.limpar();
  }
});

test('o remoto que PERDEU um arquivo com a copia local ainda no disco e curado: a divergencia volta para a fila e some do estado', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });
    m.remoto.arquivos.delete(chaveRemota(presentes[0]?.caminho as string));
    m.avancar(8 * DIA);

    const apagar = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(apagar.apagadas, 2);
    assert.equal(apagar.divergencias, 1, 'o que o remoto perdeu e acusado e a copia local fica');
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.divergencias, 1);

    const reenvio = await passadaDeEnvio(m.dep, m.id);
    assert.equal(reenvio.enviados, 1, 'a divergencia volta para a fila de envio');
    assert.equal(m.remoto.arquivos.size, 3, 'o remoto foi reposto');
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.divergencias, 0, 'curada: sai do estado');
  } finally {
    c.limpar();
  }
});

test('fechar a trava no MEIO da passada de apagar vale no arquivo seguinte', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    m.avancar(8 * DIA);
    m.remoto.aoStat = () => {
      configurarDestinoRemotoDeMidia(c.registro, m.id, { remoto: 'remoto_de_teste', ...PADROES_DO_DESTINO_REMOTO, apagarLocal: false });
    };
    const r = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(r.trava, true);
    assert.ok(r.apagadas <= 1, `so o arquivo em andamento pode sair; saiu ${r.apagadas}`);
    const restantes = listarAnexosPresentes(m.acervo, { limite: 10 }).filter((a) => existsSync(join(m.destino, a.caminho)));
    assert.ok(restantes.length >= 2, 'a trava fechada manteve as outras copias locais');
  } finally {
    c.limpar();
  }
});

test('a reverificacao de apagar tambem obedece o limite de cota: espera e deixa para a passada seguinte', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    m.avancar(8 * DIA);
    m.remoto.statsComCota = 1;
    const r = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(r.adiadas, 1);
    assert.equal(r.apagadas, 2);
    assert.ok(m.esperas.includes(2_000), `esperou 2 s: ${JSON.stringify(m.esperas)}`);
    const depois = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(depois.apagadas, 1, 'o adiado sai na passada seguinte');
  } finally {
    c.limpar();
  }
});

test('Localizacao verificada em OUTRO remoto nao autoriza apagar sob o Destino de agora', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    m.avancar(8 * DIA);
    configurarDestinoRemotoDeMidia(c.registro, m.id, {
      remoto: 'outro_remoto',
      ...PADROES_DO_DESTINO_REMOTO,
      apagarLocal: true,
    });
    const r = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(r.apagadas, 0);
    assert.equal(r.adiadas, 3);
  } finally {
    c.limpar();
  }
});

test('reconstruir RECUSA a listagem vazia quando a base tem Localizacoes, e so com confirmacao refaz', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    await passadaDeEnvio(m.dep, m.id);
    m.remoto.arquivos.clear(); // o remoto "perdeu" tudo: pasta-base trocada, credencial sem acesso...
    const r = await reconstruirLocalizacao(m.dep, m.id);
    assert.ok(r.recusada !== null && /VAZIA/.test(r.recusada));
    assert.equal(r.restauradas, 0);
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.enviados, 3, 'a base nao foi tocada');

    const confirmada = await reconstruirLocalizacao(m.dep, m.id, { confirmar: true });
    assert.equal(confirmada.recusada, null);
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.enviados, 0, 'com --confirmo a base e refeita, vazia');
  } finally {
    c.limpar();
  }
});

test('o estado traz a verificacao mais antiga com copia local, a divergencia mais antiga e a ultima conferencia', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: false });
    await passadaDeEnvio(m.dep, m.id);
    const e1 = estadoDoArmazenamento(m.dep, m.id);
    assert.ok(e1?.verificacaoMaisAntigaComCopiaLocalEm, 'a trava fechada deixa as verificacoes envelhecendo: a frota calcula os 3 dias');
    assert.equal(e1?.divergenciaMaisAntigaEm, null);
    assert.equal(e1?.ultimaConferenciaEm, null);
    await conferirPorAmostra(m.dep, m.id, 10);
    assert.ok(estadoDoArmazenamento(m.dep, m.id)?.ultimaConferenciaEm, 'a conferencia deixa rastro mesmo sem divergencia');
  } finally {
    c.limpar();
  }
});

test('o video sobe primeiro: o grupo "video" so leva os videos, o "resto" o que sobra', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const v = await passadaDeEnvio(m.dep, m.id, { grupo: 'video' });
    assert.equal(v.enviados, 2);
    assert.equal(v.examinados, 2);
    const resto = await passadaDeEnvio(m.dep, m.id, { grupo: 'resto' });
    assert.equal(resto.enviados, 1);
    assert.equal(resto.examinados, 1);
  } finally {
    c.limpar();
  }
});

test('o ensaio conta o que subiria sem falar com o remoto e sem criar a base da Localizacao', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const r = await passadaDeEnvio(m.dep, m.id, { ensaio: true });
    assert.equal(r.enviados, 0);
    assert.equal(r.examinados, 3);
    assert.equal(m.remoto.chamadas.length, 0);
    assert.ok(!existsSync(caminhoDaLocalizacao(c.raiz, m.id)), 'o ensaio nao cria a base');
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.pendentes, 3);
  } finally {
    c.limpar();
  }
});

test('o limite da passada para no numero pedido e nao grava o estado de pendentes', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const r = await passadaDeEnvio(m.dep, m.id, { limite: 1 });
    assert.equal(r.enviados, 1);
    assert.deepEqual(estadoDoArmazenamento(m.dep, m.id)?.passadas, []);
  } finally {
    c.limpar();
  }
});

test('o pedido de parada interrompe a passada antes do proximo arquivo', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const r = await passadaDeEnvio({ ...m.dep, parou: () => true }, m.id);
    assert.equal(r.interrompida, true);
    assert.equal(r.enviados, 0);
  } finally {
    c.limpar();
  }
});

test('a trava fechada nunca apaga a copia local, por mais velha que a verificacao seja', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: false });
    await passadaDeEnvio(m.dep, m.id);
    m.avancar(30 * DIA);
    const r = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(r.trava, true);
    assert.equal(r.apagadas, 0);
    for (const a of listarAnexosPresentes(m.acervo, { limite: 10 })) assert.ok(existsSync(join(m.destino, a.caminho)));
  } finally {
    c.limpar();
  }
});

test('com a trava liberada, so apaga depois da Janela contada da verificacao, e a Presenca nao muda', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    const antes = listarAnexosPresentes(m.acervo, { limite: 10 });

    m.avancar(1 * DIA);
    const cedo = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(cedo.apagadas, 0, 'dentro da Janela');
    assert.equal(cedo.adiadas, 0, 'nem chegam a ser candidatas: o corte da Janela as exclui');

    m.avancar(7 * DIA);
    const tarde = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(tarde.apagadas, 3);
    for (const a of antes) assert.ok(!existsSync(join(m.destino, a.caminho)), 'a copia local saiu');

    // O Acervo nao muda: os Anexos continuam presentes, e a Localizacao diz que a copia local saiu.
    assert.deepEqual(
      listarAnexosPresentes(m.acervo, { limite: 10 }).map((a) => a.id),
      antes.map((a) => a.id),
    );
    const base = abrirLocalizacao(c.raiz, m.id);
    try {
      for (const l of lerLocalizacoes(base, antes.map((a) => a.id)).values()) assert.ok(l.copiaLocalRemovidaEm);
    } finally {
      base.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('REVERIFICA o remoto antes de apagar: hash que mudou ou arquivo que sumiu MANTEM a copia local e vira divergencia', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });
    m.avancar(8 * DIA);

    m.remoto.hashErrado = true;
    m.remoto.perdidos.add(caminhoRemoto(presentes[0]?.caminho as string));
    const r = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(r.apagadas, 0);
    assert.equal(r.divergencias, 3);
    for (const a of presentes) assert.ok(existsSync(join(m.destino, a.caminho)), 'a copia local ficou');
    const base = abrirLocalizacao(c.raiz, m.id);
    try {
      assert.equal(resumoDaLocalizacao(base).divergencias, 3);
    } finally {
      base.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('a Impressao de Anexo que mudou depois do envio MANTEM a copia local: o arquivo de agora nao e o que subiu', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });
    // O arquivo foi regravado depois do envio: a Impressao de Anexo do Acervo deixa de ser a verificada no remoto.
    m.acervo.db.prepare('UPDATE anexos SET impressao = ? WHERE id = ?').run('a'.repeat(64), presentes[0]?.id as string);
    m.avancar(8 * DIA);
    const r = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(r.divergencias, 1);
    assert.equal(r.apagadas, 2);
    assert.ok(existsSync(join(m.destino, presentes[0]?.caminho as string)), 'a copia local do Anexo que mudou ficou');
    assert.ok(m.saidas.some((s) => /Impressao de Anexo mudou/.test(s)));
  } finally {
    c.limpar();
  }
});

test('o audio com transcricao por fazer nao perde a copia local, os outros perdem', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    const audio = c.registrarAnexo(m.acervo, { tipo: 'audio', ocorridaEm: INSTANTE + 10 });
    gravarArquivoDeAnexo(m.acervo, {
      origemDaChegada: 'importacao',
      anexoId: audio,
      destino: m.destino,
      bytes: Buffer.from('audio-que-ainda-sera-transcrito'),
    });
    await passadaDeEnvio(m.dep, m.id);
    m.avancar(8 * DIA);
    const r = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(r.apagadas, 3);
    assert.equal(r.adiadas, 1);
    const caminho = listarAnexosPresentes(m.acervo, { limite: 10 }).find((a) => a.id === audio)?.caminho as string;
    assert.ok(existsSync(join(m.destino, caminho)));
  } finally {
    c.limpar();
  }
});

test('a copia local que a retencao ja tirou so e registrada, sem erro', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });
    const { rmSync } = await import('node:fs');
    rmSync(join(m.destino, presentes[0]?.caminho as string));
    m.avancar(8 * DIA);
    const r = await passadaDeApagarCopiaLocal(m.dep, m.id);
    assert.equal(r.jaAusentes, 1);
    assert.equal(r.apagadas, 2);
  } finally {
    c.limpar();
  }
});

test('o Anexo que a retencao descartou perde tambem a copia remota, e a Localizacao some', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    await passadaDeEnvio(m.dep, m.id);
    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });
    const descartado = presentes[0]?.id as string;
    descartarAnexo(m.acervo, descartado, { politica: 'teste' });

    const r = await passadaDeDescartados(m.dep, m.id);
    assert.equal(r.removidos, 1);
    assert.equal(m.remoto.arquivos.size, 2);
    assert.ok(!m.remoto.arquivos.has(chaveRemota(presentes[0]?.caminho as string)));
    const base = abrirLocalizacao(c.raiz, m.id);
    try {
      assert.equal(lerLocalizacoes(base, [descartado]).size, 0);
    } finally {
      base.fechar();
    }

    // Idempotente: o remoto ja nao tem o arquivo (404) e nada quebra.
    assert.equal((await passadaDeDescartados(m.dep, m.id)).falhos, 0);
  } finally {
    c.limpar();
  }
});

test('a conferencia por amostra acusa o arquivo que sumiu do remoto e limpa a divergencia quando ele volta', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    m.avancar(8 * DIA);
    await passadaDeApagarCopiaLocal(m.dep, m.id);
    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });

    const bom = await conferirPorAmostra(m.dep, m.id, 10);
    assert.deepEqual(bom, { conferidos: 3, divergentes: 0 });

    const relativo = caminhoRemoto(presentes[0]?.caminho as string);
    m.remoto.perdidos.add(relativo);
    const ruim = await conferirPorAmostra(m.dep, m.id, 10);
    assert.equal(ruim.divergentes, 1);
    assert.ok(m.saidas.some((s) => /DIVERGENCIA/.test(s)));
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.divergencias, 1);

    m.remoto.perdidos.delete(relativo);
    await conferirPorAmostra(m.dep, m.id, 10);
    assert.equal(estadoDoArmazenamento(m.dep, m.id)?.divergencias, 0);
  } finally {
    c.limpar();
  }
});

test('reconstruir refaz a base pela listagem do remoto, conferida contra o Acervo', async () => {
  const c = cenario();
  try {
    const m = montar(c, { apagarLocal: true });
    await passadaDeEnvio(m.dep, m.id);
    m.avancar(8 * DIA);
    await passadaDeApagarCopiaLocal(m.dep, m.id);
    const presentes = listarAnexosPresentes(m.acervo, { limite: 10 });
    m.remoto.duplicados.add(caminhoRemoto(presentes[0]?.caminho as string));
    // Um arquivo que nenhum Anexo reclama.
    m.remoto.arquivos.set(`remoto_de_teste:${PADROES_DO_DESTINO_REMOTO.pastaBase}/${m.id}/image/zz/orfao.jpg`, {
      conteudo: Buffer.from('orfao'),
      id: 'id-orfao',
    });

    const r = await reconstruirLocalizacao(m.dep, m.id);
    assert.equal(r.restauradas, 3);
    assert.equal(r.duplicatas, 1);
    assert.equal(r.semAnexo, 1);
    assert.equal(r.divergentes, 0);

    const base = abrirLocalizacao(c.raiz, m.id);
    try {
      const l = lerLocalizacoes(base, presentes.map((a) => a.id));
      assert.equal(l.size, 3);
      for (const x of l.values()) {
        assert.ok(x.idNoRemoto);
        assert.ok(x.copiaLocalRemovidaEm, 'a copia local ja nao existia: vira removida agora');
      }
      assert.equal(l.get(presentes[0]?.id as string)?.duplicatas, 1);
    } finally {
      base.fechar();
    }
  } finally {
    c.limpar();
  }
});

test('o estado mostra o que foi enviado, o que falta e a idade do pendente mais antigo', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    m.avancar(-10 * 60 * 1000); // os arquivos ainda sao novos demais: ficam pendentes
    await passadaDeEnvio(m.dep, m.id);
    const antes = estadoDoArmazenamento(m.dep, m.id);
    assert.equal(antes?.presentes, 3);
    assert.equal(antes?.enviados, 0);
    assert.equal(antes?.pendentes, 3);
    assert.equal(typeof antes?.idadeDoPendenteMaisAntigoSegundos, 'number');
    assert.equal(antes?.apagarLocal, false);

    m.avancar(20 * 60 * 1000);
    await passadaDeEnvio(m.dep, m.id);
    const depois = estadoDoArmazenamento(m.dep, m.id);
    assert.equal(depois?.enviados, 3);
    assert.equal(depois?.pendentes, 0);
    assert.equal(depois?.idadeDoPendenteMaisAntigoSegundos, null);
    assert.ok(depois?.ultimaVerificacaoEm);
    assert.ok((depois?.bytesEnviados ?? 0) > 0);
  } finally {
    c.limpar();
  }
});

test('Inquilino sem Destino Remoto e pulado com a razao, e nao entra na lista do servico', async () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Leia Organa');
    assert.ok(acervo);
    const remoto = new RemotoEmMemoria();
    const saidas: string[] = [];
    const dep: DependenciasDoServico = {
      dados: c.raiz,
      estado: c.raiz,
      remoto,
      agora: Date.now,
      dormir: () => Promise.resolve(),
      escrever: (l) => saidas.push(l),
    };
    assert.deepEqual(inquilinosComDestinoRemoto(dep), []);
    const r = await passadaDeEnvio(dep, id);
    assert.equal(r.examinados, 0);
    assert.ok(saidas.some((s) => /sem Destino de Midia e Destino Remoto/.test(s)));
    assert.equal(remoto.chamadas.length, 0);
    assert.equal(estadoDoArmazenamento(dep, id), undefined);
  } finally {
    c.limpar();
  }
});
