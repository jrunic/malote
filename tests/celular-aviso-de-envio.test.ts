import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executar } from '../src/cli/index.js';
import { executarEnviarRede } from '../src/cli/enviar-rede.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { emitirChaveDeAcesso } from '../src/registro/chave-de-acesso.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { registrarConversa, registrarIdentificador } from '../src/nucleo/escrita.js';
import { criarServidor, type OpcoesDoServidor } from '../src/rede/servidor.js';
import { servir } from '../src/cli/servir.js';
import { consultarDestinoDeWhatsapp } from '../src/adaptadores/whatsapp/resolver-celular.js';

// #1376: o pedido de Envio avisa, na saida, para onde o Envio vai quando o Acervo guarda o celular na outra forma, e que o
// Acervo nao conhece o endereco. Quem decide o destino de fato e o ouvinte, ao processar; o aviso e uma previa.

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';
/** Celular que o Acervo nao conhece em nenhuma forma, e um fixo (que tem uma forma so). */
const DESCONHECIDO = '5565988880000@s.whatsapp.net';
const FIXO = '556532221234@s.whatsapp.net';

interface Cena {
  raiz: string;
  inquilinoId: string;
  chave: string;
  grupoId: string;
  /** Conversa direta da Configuracao `padrao` na forma com o 9, com o celular gravado sem o 9. */
  diretaAlternativaId: string;
  limpar: () => void;
}

/** Um Inquilino com a Configuracao `padrao`, um celular gravado sem o 9 e um grupo. */
function montar(): Cena {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilinoId = criarInquilino(registro, { titularNome: 'Leia' });
  const padrao = resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'padrao');
  const chave = emitirChaveDeAcesso(registro, inquilinoId).valor;
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilinoId as never);
  registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
  const grupoId = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: GRUPO, coletiva: true, bruto: '{}' });
  const diretaAlternativaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: COM_NOVE,
    coletiva: false,
    configuracao: { id: padrao.id, fonte: 'whatsapp' },
    bruto: '{}',
  });
  acervo.fechar();
  return { raiz, inquilinoId, chave, grupoId, diretaAlternativaId, limpar };
}

async function enviarLocal(cena: Cena, ...args: string[]): Promise<{ codigo: number; saida: string }> {
  const linhas: string[] = [];
  const codigo = await executar(['enviar', '--inquilino', cena.inquilinoId, '--configuracao', 'padrao', '--texto', 'oi', ...args], {
    dados: cena.raiz,
    estado: cena.raiz,
    escrever: (l: string) => linhas.push(l),
  });
  return { codigo, saida: linhas.join('\n') };
}

function destinosGravados(cena: Cena): Array<string | null> {
  const a = abrirAcervoSomenteLeitura(join(cena.raiz, 'acervos'), cena.inquilinoId as never);
  try {
    return (a.preparar('SELECT destino_cru FROM envios ORDER BY rowid').all() as Array<{ destino_cru: string | null }>).map(
      (l) => l.destino_cru,
    );
  } finally {
    a.fechar();
  }
}

test('CLI local: o celular que o Acervo guarda na outra forma avisa para onde o Envio vai, e grava o pedido como veio', async () => {
  const cena = montar();
  try {
    const r = await enviarLocal(cena, '--para', COM_NOVE);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /O Acervo guarda este celular sem o 9: o Envio sai para \.\.\.1234@s\.whatsapp\.net, e nao para o endereco pedido\./);
    assert.deepEqual(destinosGravados(cena), [COM_NOVE], 'o ouvinte decide o destino ao processar; o pedido fica como veio');
  } finally {
    cena.limpar();
  }
});

test('CLI local --json: traz o endereco usado inteiro, e so o JSON', async () => {
  const cena = montar();
  try {
    const r = await enviarLocal(cena, '--para', COM_NOVE, '--json');
    const corpo = JSON.parse(r.saida) as Record<string, unknown>;
    assert.equal(corpo['enderecoUsado'], SEM_NOVE);
    assert.equal(corpo['enderecoDesconhecido'], undefined);
  } finally {
    cena.limpar();
  }
});

test('CLI local: o numero que o Acervo nao conhece em nenhuma forma avisa que sai como foi pedido', async () => {
  const cena = montar();
  try {
    const r = await enviarLocal(cena, '--para', DESCONHECIDO);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /O Acervo nao conhece este endereco em nenhuma das duas formas: o Envio sai como foi pedido\./);
    const j = await enviarLocal(cena, '--para', DESCONHECIDO, '--json');
    const corpo = JSON.parse(j.saida) as Record<string, unknown>;
    assert.equal(corpo['enderecoDesconhecido'], true);
    assert.equal(corpo['enderecoUsado'], undefined);
  } finally {
    cena.limpar();
  }
});

test('CLI local: o pedido por Conversa nao leva aviso de endereco (grupo e direta na forma alternativa)', async () => {
  const cena = montar();
  try {
    for (const id of [cena.grupoId, cena.diretaAlternativaId]) {
      const r = await enviarLocal(cena, '--conversa', id);
      assert.equal(r.codigo, 0, r.saida);
      assert.doesNotMatch(r.saida, /O Acervo/);
      const j = await enviarLocal(cena, '--conversa', id, '--json');
      assert.equal((JSON.parse(j.saida) as Record<string, unknown>)['enderecoUsado'], undefined);
    }
  } finally {
    cena.limpar();
  }
});

test('CLI local: a forma que o Acervo guarda e o grupo nao levam aviso nenhum', async () => {
  const cena = montar();
  try {
    for (const alvo of [SEM_NOVE, GRUPO]) {
      const r = await enviarLocal(cena, '--para', alvo);
      assert.equal(r.codigo, 0, r.saida);
      assert.doesNotMatch(r.saida, /O Acervo/);
    }
  } finally {
    cena.limpar();
  }
});

async function portaLivre(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return porta;
}

async function pedirPorRede(
  cena: Cena,
  destino: { para: string } | { conversa: string },
  comConsulta: boolean,
): Promise<Record<string, unknown>> {
  const porta = await portaLivre();
  const srv = criarServidor({
    dados: cena.raiz,
    porta,
    ...(comConsulta ? { consultarDestinoDeEnvio: consultarDestinoDeWhatsapp } : {}),
  });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/envios/solicitar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cena.chave}`, 'content-type': 'application/json' },
      body: JSON.stringify({ configuracao: 'padrao', tipo: 'texto', texto: 'oi', ...destino }),
    });
    assert.equal(r.status, 202);
    return (await r.json()) as Record<string, unknown>;
  } finally {
    srv.close();
  }
}

test('rota: a resposta diz o endereco usado quando o Acervo guarda a outra forma, e que o endereco e desconhecido', async () => {
  const cena = montar();
  try {
    const usado = await pedirPorRede(cena, { para: COM_NOVE }, true);
    assert.equal(usado['enderecoUsado'], SEM_NOVE);
    assert.equal(usado['enderecoDesconhecido'], undefined);
    const desconhecido = await pedirPorRede(cena, { para: DESCONHECIDO }, true);
    assert.equal(desconhecido['enderecoDesconhecido'], true);
    assert.equal(desconhecido['enderecoUsado'], undefined);
    const gravada = await pedirPorRede(cena, { para: SEM_NOVE }, true);
    assert.equal(gravada['enderecoUsado'], undefined);
    assert.equal(gravada['enderecoDesconhecido'], undefined);
  } finally {
    cena.limpar();
  }
});

test('rota: o pedido por Conversa nao consulta o endereco, e a resposta nao leva aviso (grupo e direta na forma alternativa)', async () => {
  const cena = montar();
  try {
    for (const id of [cena.grupoId, cena.diretaAlternativaId]) {
      const corpo = await pedirPorRede(cena, { conversa: id }, true);
      assert.equal(corpo['conversa'], id);
      assert.equal(corpo['enderecoUsado'], undefined);
      assert.equal(corpo['enderecoDesconhecido'], undefined);
    }
  } finally {
    cena.limpar();
  }
});

test('rota sem a consulta injetada: a resposta de hoje, sem aviso (a rede nao conhece a regra do celular)', async () => {
  const cena = montar();
  try {
    const corpo = await pedirPorRede(cena, { para: COM_NOVE }, false);
    assert.equal(corpo['enderecoUsado'], undefined);
    assert.equal(corpo['enderecoDesconhecido'], undefined);
  } finally {
    cena.limpar();
  }
});

async function clienteDeRede(corpo: Record<string, unknown>, para: string): Promise<string> {
  const srv = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify(corpo));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const linhas: string[] = [];
  try {
    const codigo = await executarEnviarRede(['enviar', '--configuracao', 'padrao', '--para', para, '--texto', 'oi'], {
      servidor: url,
      chave: 'chave-de-teste',
      env: {},
      escrever: (t) => linhas.push(t),
    });
    assert.equal(codigo, 0, linhas.join('\n'));
    return linhas.join('\n');
  } finally {
    srv.close();
  }
}

test('cliente de rede: imprime o aviso que o servidor devolveu, nas duas situacoes', async () => {
  const usado = await clienteDeRede({ aceita: true, envioId: 'e1', configuracao: 'padrao', enderecoUsado: SEM_NOVE }, COM_NOVE);
  assert.match(usado, /O Acervo guarda este celular sem o 9: o Envio sai para \.\.\.1234@s\.whatsapp\.net, e nao para o endereco pedido\./);
  const desconhecido = await clienteDeRede({ aceita: true, envioId: 'e1', configuracao: 'padrao', enderecoDesconhecido: true }, COM_NOVE);
  assert.match(desconhecido, /O Acervo nao conhece este endereco em nenhuma das duas formas: o Envio sai como foi pedido\./);
  // Um par entre numeros diferentes nao tem "forma" a dizer, e o fixo nao tem "duas formas".
  const outroNumero = await clienteDeRede(
    { aceita: true, envioId: 'e1', configuracao: 'padrao', enderecoUsado: '556599990000@s.whatsapp.net' },
    SEM_NOVE,
  );
  assert.match(outroNumero, /O Acervo guarda este numero em outro endereco: o Envio sai para \.\.\.0000@s\.whatsapp\.net/);
  assert.doesNotMatch(outroNumero, /com o 9|sem o 9/);
  const fixo = await clienteDeRede(
    { aceita: true, envioId: 'e1', configuracao: 'padrao', enderecoDesconhecido: true },
    FIXO,
  );
  assert.match(fixo, /O Acervo nao conhece este endereco: o Envio sai como foi pedido\.$/m);
  assert.doesNotMatch(fixo, /duas formas/);
  const nenhum = await clienteDeRede({ aceita: true, envioId: 'e1', configuracao: 'padrao' }, COM_NOVE);
  assert.doesNotMatch(nenhum, /O Acervo/);
});

test('servir entrega a consulta do destino ao servidor: a rede nao a conhece, quem a compoe e o comando', async () => {
  const dados = mkdtempSync(join(tmpdir(), 'malote-servir-'));
  try {
    let recebidas: OpcoesDoServidor | undefined;
    // O worker nao carrega: o `servir` recusa subir (codigo 1) logo depois de criar o servidor, que e o que o teste mede.
    await servir(['--porta', '0'], {
      dados,
      estado: dados,
      escrever: () => undefined,
      iniciarWorker: () => () => {},
      criar: (o) => {
        recebidas = o;
        return criarServidor({ ...o, arquivoDoTrabalhador: new URL('file:///nao/existe/trabalhador.ts') });
      },
    });
    assert.equal(recebidas?.consultarDestinoDeEnvio, consultarDestinoDeWhatsapp);
  } finally {
    rmSync(dados, { recursive: true, force: true });
  }
});
