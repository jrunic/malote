import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cenario, type Cenario } from './ajuda/acervo.js';
import { rodar, instalacaoTemporaria } from './ajuda/instalacao.js';
import { RemotoEmMemoria } from './ajuda/remoto-em-memoria.js';
import { armazenamento, type AmbienteDeArmazenamento } from '../src/cli/armazenamento.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import { PADROES_DO_DESTINO_REMOTO, configurarDestinoRemotoDeMidia } from '../src/registro/destino-remoto.js';
import { listarAnexosPresentes } from '../src/nucleo/anexos-presentes.js';

const DIA = 24 * 60 * 60 * 1000;

function montar(c: Cenario, apagarLocal = false) {
  const { id, acervo, destino } = c.inquilinoComArquivos();
  configurarDestinoDeMidia(c.registro, id, { natureza: 'local', endereco: destino });
  configurarDestinoRemotoDeMidia(c.registro, id, {
    remoto: 'remoto_de_teste',
    ...PADROES_DO_DESTINO_REMOTO,
    apagarLocal,
  });
  const remoto = new RemotoEmMemoria();
  const saidas: string[] = [];
  let leituras = 0;
  const base = Date.now() + 11 * 60 * 1000;
  const ambiente: AmbienteDeArmazenamento = {
    dados: c.raiz,
    estado: c.raiz,
    escrever: (t) => saidas.push(t),
    env: { MALOTE_RCLONE_BINARIO: '/nao/usado/rclone' },
    iniciarRemoto: () => Promise.resolve(remoto),
    agora: () => base + 1_000 * leituras++,
    dormir: () => Promise.resolve(),
  };
  return { id, acervo, destino, remoto, saidas, ambiente, base, avancar: (ms: number) => (leituras += Math.floor(ms / 1_000)) };
}

test('sem subcomando, ou com um que nao existe, mostra o uso e sai 2', async () => {
  const saidas: string[] = [];
  const ambiente: AmbienteDeArmazenamento = { dados: '/x', estado: '/x', escrever: (t) => saidas.push(t) };
  assert.equal(await armazenamento(['armazenamento'], ambiente), 2);
  assert.equal(await armazenamento(['armazenamento', 'inexistente'], ambiente), 2);
  assert.match(saidas.join('\n'), /Uso: malote armazenamento servir/);
});

test('os comandos que pedem Inquilino recusam sem --inquilino', async () => {
  for (const sub of ['passada', 'apagar-local', 'conferir', 'reconstruir', 'estado']) {
    const saidas: string[] = [];
    const codigo = await armazenamento(['armazenamento', sub], { dados: '/x', estado: '/x', escrever: (t) => saidas.push(t) });
    assert.equal(codigo, 2, sub);
    assert.match(saidas.join('\n'), /Informe --inquilino/, sub);
  }
});

test('sem o rclone declarado o servico nao sobe e os comandos de campo recusam, com o que fazer', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const semRclone: AmbienteDeArmazenamento = { ...m.ambiente, env: {} };
    for (const argumentos of [
      ['armazenamento', 'servir'],
      ['armazenamento', 'passada', '--inquilino', m.id],
      ['armazenamento', 'conferir', '--inquilino', m.id],
      ['armazenamento', 'reconstruir', '--inquilino', m.id],
      ['armazenamento', 'apagar-local', '--inquilino', m.id],
    ]) {
      m.saidas.length = 0;
      assert.equal(await armazenamento(argumentos, semRclone), 2, argumentos.join(' '));
      assert.match(m.saidas.join('\n'), /MALOTE_RCLONE_BINARIO/);
    }
    assert.equal(m.remoto.chamadas.length, 0);
  } finally {
    c.limpar();
  }
});

test('o rclone que nao sobe sai 1 (o unit reinicia), com a causa', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const ambiente: AmbienteDeArmazenamento = {
      ...m.ambiente,
      iniciarRemoto: () => Promise.reject(new Error('rclone encerrou ao subir (codigo 3): falha de teste')),
    };
    assert.equal(await armazenamento(['armazenamento', 'servir'], ambiente), 1);
    assert.match(m.saidas.join('\n'), /O rclone nao subiu: .*falha de teste/);
  } finally {
    c.limpar();
  }
});

test('passada sem --grupo sobe o video e depois o resto, resume e para o rclone no fim', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    assert.equal(await armazenamento(['armazenamento', 'passada', '--inquilino', m.id], m.ambiente), 0);
    assert.equal(m.remoto.arquivos.size, 3);
    const linhas = m.saidas.filter((l) => /\(video\)|\(resto\)/.test(l));
    assert.equal(linhas.length, 2);
    assert.match(linhas[0] as string, /\(video\).*2 enviado\(s\)/);
    assert.match(linhas[1] as string, /\(resto\).*1 enviado\(s\)/);
    assert.equal(m.remoto.parado, true, 'o rclone e parado mesmo quando tudo deu certo');
  } finally {
    c.limpar();
  }
});

test('passada com falha de envio sai 1 e o rclone e parado mesmo assim', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    m.remoto.hashErrado = true;
    assert.equal(await armazenamento(['armazenamento', 'passada', '--inquilino', m.id, '--grupo', 'todos'], m.ambiente), 1);
    assert.equal(m.remoto.parado, true);
  } finally {
    c.limpar();
  }
});

test('passada --ensaio nao fala com o remoto e nao cria a base', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    assert.equal(await armazenamento(['armazenamento', 'passada', '--inquilino', m.id, '--ensaio'], m.ambiente), 0);
    assert.equal(m.remoto.chamadas.length, 0);
    assert.ok(m.saidas.some((l) => /\[ensaio\]/.test(l)));
    assert.ok(!existsSync(join(c.raiz, 'armazenamento')));
  } finally {
    c.limpar();
  }
});

test('--limite e validado como inteiro positivo e limita a passada', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    assert.equal(
      await armazenamento(['armazenamento', 'passada', '--inquilino', m.id, '--grupo', 'todos', '--limite', '1'], m.ambiente),
      0,
    );
    assert.equal(m.remoto.arquivos.size, 1);
  } finally {
    c.limpar();
  }
});

test('apagar-local: travado nao examina nada; liberado apaga depois da Janela', async () => {
  const c = cenario();
  try {
    const travado = montar(c, false);
    await armazenamento(['armazenamento', 'passada', '--inquilino', travado.id], travado.ambiente);
    travado.saidas.length = 0;
    assert.equal(await armazenamento(['armazenamento', 'apagar-local', '--inquilino', travado.id], travado.ambiente), 0);
    assert.match(travado.saidas.join('\n'), /TRAVADO/);
  } finally {
    c.limpar();
  }
  const c2 = cenario();
  try {
    const m = montar(c2, true);
    await armazenamento(['armazenamento', 'passada', '--inquilino', m.id], m.ambiente);
    m.avancar(8 * DIA);
    m.saidas.length = 0;
    assert.equal(await armazenamento(['armazenamento', 'apagar-local', '--inquilino', m.id], m.ambiente), 0);
    assert.match(m.saidas.join('\n'), /3 copia\(s\) local\(is\) apagada\(s\)/);
    for (const a of listarAnexosPresentes(m.acervo, { limite: 10 })) assert.ok(!existsSync(join(m.destino, a.caminho)));
  } finally {
    c2.limpar();
  }
});

test('conferir sai 1 quando acha divergencia e 0 quando esta tudo certo; reconstruir resume a base refeita', async () => {
  const c = cenario();
  try {
    const m = montar(c, true);
    await armazenamento(['armazenamento', 'passada', '--inquilino', m.id], m.ambiente);
    m.avancar(8 * DIA);
    await armazenamento(['armazenamento', 'apagar-local', '--inquilino', m.id], m.ambiente);

    assert.equal(await armazenamento(['armazenamento', 'conferir', '--inquilino', m.id, '--amostra', '10'], m.ambiente), 0);
    m.remoto.hashErrado = true;
    assert.equal(await armazenamento(['armazenamento', 'conferir', '--inquilino', m.id, '--amostra', '10'], m.ambiente), 1);
    m.remoto.hashErrado = false;

    m.saidas.length = 0;
    assert.equal(await armazenamento(['armazenamento', 'reconstruir', '--inquilino', m.id], m.ambiente), 0);
    assert.match(m.saidas.join('\n'), /base refeita: 3 restaurada\(s\)/);
  } finally {
    c.limpar();
  }
});

test('estado em JSON traz o que a frota precisa e nao fala com o remoto', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const ambiente: AmbienteDeArmazenamento = {
      ...m.ambiente,
      iniciarRemoto: () => Promise.reject(new Error('o estado nao deve subir o rclone')),
    };
    assert.equal(await armazenamento(['armazenamento', 'estado', '--inquilino', m.id, '--json'], ambiente), 0);
    const estado = JSON.parse(m.saidas.join('\n')) as Record<string, unknown>;
    for (const campo of [
      'inquilino',
      'remoto',
      'apagarLocal',
      'presentes',
      'enviados',
      'pendentes',
      'falhos',
      'duplicatas',
      'divergencias',
      'bytesEnviados',
      'copiasLocaisRemovidas',
      'idadeDoPendenteMaisAntigoSegundos',
      'ultimaVerificacaoEm',
    ]) {
      assert.ok(campo in estado, campo);
    }
    assert.equal(estado['presentes'], 3);
    assert.equal(estado['pendentes'], 3);
    assert.equal(estado['apagarLocal'], false);
    assert.ok(!JSON.stringify(estado).includes('nao deve subir'));

    m.saidas.length = 0;
    assert.equal(await armazenamento(['armazenamento', 'estado', '--inquilino', m.id], ambiente), 0);
    assert.match(m.saidas.join('\n'), /Anexos presentes: 3 \| enviados: 0 \| pendentes: 3/);
  } finally {
    c.limpar();
  }
});

test('estado de Inquilino sem Destino Remoto sai 2', async () => {
  const c = cenario();
  try {
    const { id } = c.novoInquilino('Leia Organa');
    const saidas: string[] = [];
    const codigo = await armazenamento(['armazenamento', 'estado', '--inquilino', id], {
      dados: c.raiz,
      estado: c.raiz,
      escrever: (t) => saidas.push(t),
    });
    assert.equal(codigo, 2);
  } finally {
    c.limpar();
  }
});

test('servir faz uma passada completa, para no SIGTERM e solta os tratadores de sinal', async () => {
  const c = cenario();
  const antesTermo = process.listenerCount('SIGTERM');
  const antesInt = process.listenerCount('SIGINT');
  try {
    const m = montar(c);
    const ambiente: AmbienteDeArmazenamento = {
      ...m.ambiente,
      dormir: () => {
        process.emit('SIGTERM');
        return Promise.resolve();
      },
    };
    assert.equal(await armazenamento(['armazenamento', 'servir'], ambiente), 0);
    assert.equal(m.remoto.arquivos.size, 3, 'a passada rodou antes de dormir');
    assert.equal(m.remoto.parado, true);
    const texto = m.saidas.join('\n');
    assert.match(texto, /servico no ar/);
    assert.match(texto, /parando depois do arquivo em andamento/);
    assert.match(texto, /servico parado/);
    assert.equal(process.listenerCount('SIGTERM'), antesTermo);
    assert.equal(process.listenerCount('SIGINT'), antesInt);
  } finally {
    c.limpar();
  }
});

test('o servico passa a apagar a copia local so depois da Janela e da trava, no laco completo', async () => {
  const c = cenario();
  try {
    const m = montar(c, true);
    let passadas = 0;
    const ambiente: AmbienteDeArmazenamento = {
      ...m.ambiente,
      dormir: () => {
        passadas += 1;
        if (passadas === 1) m.avancar(8 * DIA); // depois da primeira passada, a Janela vence
        else process.emit('SIGTERM');
        return Promise.resolve();
      },
    };
    assert.equal(await armazenamento(['armazenamento', 'servir'], ambiente), 0);
    for (const a of listarAnexosPresentes(m.acervo, { limite: 10 })) {
      assert.ok(!existsSync(join(m.destino, a.caminho)), 'a segunda passada apagou a copia local');
    }
  } finally {
    c.limpar();
  }
});

test('o comando nao roda pela porta sincrona de `executar`', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const r = rodar(raiz, ['armazenamento', 'estado', '--inquilino', 'x']);
    assert.equal(r.codigo, 2);
    assert.match(r.saida, /malote armazenamento/);
  } finally {
    limpar();
  }
});

function travaDoServico(raiz: string): string {
  return join(raiz, 'armazenamento', 'servico.pid');
}

function escreverTrava(raiz: string, pid: number): void {
  mkdirSync(join(raiz, 'armazenamento'), { recursive: true });
  writeFileSync(travaDoServico(raiz), String(pid));
}

test('com MALOTE_SERVIDOR (modo rede) o comando recusa: o armazenamento e LOCAL', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    const ambiente: AmbienteDeArmazenamento = { ...m.ambiente, servidor: 'http://127.0.0.1:1' };
    for (const argumentos of [
      ['armazenamento', 'servir'],
      ['armazenamento', 'estado', '--inquilino', m.id],
      ['armazenamento', 'passada', '--inquilino', m.id],
    ]) {
      m.saidas.length = 0;
      assert.equal(await armazenamento(argumentos, ambiente), 2, argumentos.join(' '));
      assert.match(m.saidas.join('\n'), /operacao LOCAL/);
    }
    assert.equal(m.remoto.chamadas.length, 0);
  } finally {
    c.limpar();
  }
});

test('--limite e --amostra invalidos sao erro de uso (2), nunca viram 1 em silencio', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    for (const [flag, valor] of [['limite', 'abc'], ['limite', '0'], ['limite', '-3'], ['limite', '1.5'], ['amostra', 'x'], ['amostra', '0']] as const) {
      m.saidas.length = 0;
      const sub = flag === 'limite' ? 'passada' : 'conferir';
      assert.equal(await armazenamento(['armazenamento', sub, '--inquilino', m.id, `--${flag}`, valor], m.ambiente), 2, `${flag}=${valor}`);
      assert.match(m.saidas.join('\n'), new RegExp(`--${flag} precisa ser um inteiro maior que zero`));
    }
    assert.equal(m.remoto.chamadas.length, 0, 'nada foi executado');
  } finally {
    c.limpar();
  }
});

test('com o servico no ar: segunda instancia e comandos que ESCREVEM recusam; estado e passada --ensaio seguem', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    escreverTrava(c.raiz, process.ppid); // um processo vivo que nao e este
    // Se a trava deixasse de valer, o `servir` SUBIRIA e nunca pararia: o `dormir` emite o sinal para o teste REPROVAR em vez de pendurar.
    const comParadaDeSeguranca: AmbienteDeArmazenamento = {
      ...m.ambiente,
      dormir: () => {
        process.emit('SIGTERM');
        return Promise.resolve();
      },
    };
    for (const argumentos of [
      ['armazenamento', 'servir'],
      ['armazenamento', 'passada', '--inquilino', m.id],
      ['armazenamento', 'apagar-local', '--inquilino', m.id],
      ['armazenamento', 'conferir', '--inquilino', m.id],
      ['armazenamento', 'reconstruir', '--inquilino', m.id],
    ]) {
      m.saidas.length = 0;
      assert.equal(await armazenamento(argumentos, comParadaDeSeguranca), 2, argumentos.join(' '));
      assert.match(m.saidas.join('\n'), /ja ha um servico no ar|O servico esta no ar/i);
    }
    assert.equal(m.remoto.chamadas.length, 0);
    assert.equal(await armazenamento(['armazenamento', 'estado', '--inquilino', m.id], m.ambiente), 0);
    assert.equal(await armazenamento(['armazenamento', 'passada', '--inquilino', m.id, '--ensaio'], m.ambiente), 0);
  } finally {
    c.limpar();
  }
});

test('servir solta a trava ao parar, e trava de um processo que ja morreu nao impede', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    escreverTrava(c.raiz, 2_147_483_000); // pid que nao existe
    const ambiente: AmbienteDeArmazenamento = {
      ...m.ambiente,
      dormir: () => {
        assert.equal(Number(readFileSync(travaDoServico(c.raiz), 'utf8')), process.pid, 'durante o servico a trava e deste processo');
        process.emit('SIGTERM');
        return Promise.resolve();
      },
    };
    assert.equal(await armazenamento(['armazenamento', 'servir'], ambiente), 0);
    assert.ok(!existsSync(travaDoServico(c.raiz)), 'a trava foi solta');
  } finally {
    c.limpar();
  }
});

test('reconstruir com a listagem do remoto vazia e a base cheia recusa (1) e so com --confirmo refaz', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    await armazenamento(['armazenamento', 'passada', '--inquilino', m.id], m.ambiente);
    m.remoto.arquivos.clear();
    m.saidas.length = 0;
    assert.equal(await armazenamento(['armazenamento', 'reconstruir', '--inquilino', m.id], m.ambiente), 1);
    assert.match(m.saidas.join('\n'), /RECUSADA, a base nao foi tocada.*VAZIA/);
    assert.equal(await armazenamento(['armazenamento', 'reconstruir', '--inquilino', m.id, '--confirmo'], m.ambiente), 0);
  } finally {
    c.limpar();
  }
});

test('a linha da passada conta os limites de cota, e eles nao fazem a passada sair 1', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    m.remoto.copiasComCota = 1;
    assert.equal(await armazenamento(['armazenamento', 'passada', '--inquilino', m.id, '--grupo', 'todos'], m.ambiente), 0);
    assert.match(m.saidas.join('\n'), /1 limite\(s\) de cota/);
  } finally {
    c.limpar();
  }
});
