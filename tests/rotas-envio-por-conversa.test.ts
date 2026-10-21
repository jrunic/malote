import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { criarServidor } from '../src/rede/servidor.js';
import { cenario } from './ajuda/acervo.js';
import { emitirChaveDeAcesso } from '../src/registro/chave-de-acesso.js';
import { abrirRegistro } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';

// #1323: `POST /envios/solicitar` aceita `conversa` (o id) no lugar de `para`. A `configuracao` e sempre obrigatoria e
// nunca inferida. O id de Conversa e do Acervo do Inquilino da Chave: id de outro Inquilino responde 404.

const TELEFONE = '5511900000001@s.whatsapp.net';
const OPACO = '123456789012345@lid';
const GRUPO = '120363000000000001@g.us';

async function portaLivre(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as { port: number }).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return porta;
}

interface Cena {
  raiz: string;
  inquilinoId: string;
  chave: string;
  ids: { grupo: string; pessoa: string; opaca: string; opacaSemCanonica: string; deOutraConta: string; status: string; transmissao: string; instagram: string; instagramComEnderecoDeWhatsapp: string };
  limpar: () => void;
  outro: { inquilinoId: string; chave: string };
}

/** Um Inquilino com duas Configuracoes de WhatsApp (`padrao` e `outra`) e as Conversas de cada caso. */
function montarCena(): Cena {
  const c = cenario();
  const { id: inquilinoId, acervo } = c.novoInquilino('Leia');
  const { id: outroId, acervo: acervoOutro } = c.novoInquilino('Han');
  acervoOutro.fechar();
  const registro = abrirRegistro(c.raiz);
  const padrao = resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'padrao');
  const outra = resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'outra');
  resolverConfiguracao(registro, inquilinoId, 'instagram', 'perfil');
  resolverConfiguracao(registro, outroId, 'whatsapp', 'padrao');
  const chave = emitirChaveDeAcesso(registro, inquilinoId).valor;
  const chaveOutro = emitirChaveDeAcesso(registro, outroId).valor;
  registro.fechar();

  const cfgPadrao = { id: padrao.id, fonte: 'whatsapp' } as const;
  const cfgOutra = { id: outra.id, fonte: 'whatsapp' } as const;
  const direta = (idExterno: string, configuracao: { id: string; fonte: 'whatsapp' }) =>
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: false, configuracao, bruto: '{}' });
  const coletiva = (idExterno: string) => registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: true, bruto: '{}' });

  const grupo = coletiva(GRUPO);
  const status = coletiva('5511900000009@status');
  const transmissao = coletiva('1234567890@broadcast');
  const pessoa = direta(TELEFONE, cfgPadrao);
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: TELEFONE });
  const opaca = direta(OPACO, cfgPadrao);
  // Um par aprendido sem Conversa canonica nesta Configuracao: so a OUTRA conta tem a de telefone.
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: '555555555555555@lid', canonico: '5511900000002@s.whatsapp.net' });
  const opacaSemCanonica = direta('555555555555555@lid', cfgPadrao);
  direta('5511900000002@s.whatsapp.net', cfgOutra);
  const deOutraConta = direta('5511900000003@s.whatsapp.net', cfgOutra);
  const instagram = registrarConversa(acervo, {
    fonte: 'instagram',
    idExterno: 'perfil_de_teste',
    coletiva: false,
    configuracao: { id: 'cfg-instagram-de-teste', fonte: 'instagram' },
    bruto: '{}',
  });
  // Isola a conferencia de fonte: o endereco PARECE de WhatsApp, entao a recusa do destinatario nao a mascara.
  const instagramComEnderecoDeWhatsapp = registrarConversa(acervo, {
    fonte: 'instagram',
    idExterno: '5511900000010@s.whatsapp.net',
    coletiva: false,
    configuracao: { id: 'cfg-instagram-de-teste', fonte: 'instagram' },
    bruto: '{}',
  });
  acervo.fechar();
  return {
    raiz: c.raiz,
    inquilinoId,
    chave,
    ids: { grupo, pessoa, opaca, opacaSemCanonica, deOutraConta, status, transmissao, instagram, instagramComEnderecoDeWhatsapp },
    limpar: c.limpar,
    outro: { inquilinoId: outroId, chave: chaveOutro },
  };
}

async function pedir(cena: Cena, corpo: Record<string, unknown>, chave = cena.chave): Promise<{ status: number; corpo: Record<string, unknown> | undefined }> {
  const porta = await portaLivre();
  const srv = criarServidor({ dados: cena.raiz, porta });
  await new Promise<void>((r) => srv.listen(porta, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/envios/solicitar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${chave}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto === '' ? undefined : (JSON.parse(texto) as Record<string, unknown>) };
  } finally {
    srv.close();
  }
}

function envios(cena: Cena): Array<{ conversa_id: string | null; destino_cru: string | null; conteudo_texto: string }> {
  const a = abrirAcervoSomenteLeitura(`${cena.raiz}/acervos`, cena.inquilinoId);
  try {
    return a.preparar('SELECT conversa_id, destino_cru, conteudo_texto FROM envios ORDER BY rowid').all() as Array<{
      conversa_id: string | null;
      destino_cru: string | null;
      conteudo_texto: string;
    }>;
  } finally {
    a.fechar();
  }
}

const base = { configuracao: 'padrao', tipo: 'texto', texto: 'oi' };

test('conversa de um grupo: 202, o Envio fica gravado na Conversa, sem endereco cru, e a resposta diz a conta', async () => {
  const cena = montarCena();
  try {
    const r = await pedir(cena, { ...base, conversa: cena.ids.grupo });
    assert.equal(r.status, 202);
    assert.equal(r.corpo?.['conversa'], cena.ids.grupo);
    assert.equal(r.corpo?.['configuracao'], 'padrao');
    assert.equal(r.corpo?.['redirecionadaDe'], undefined);
    assert.deepEqual(envios(cena), [{ conversa_id: cena.ids.grupo, destino_cru: null, conteudo_texto: 'oi' }]);
  } finally {
    cena.limpar();
  }
});

test('por para a resposta tambem diz a conta, e o pedido de hoje nao muda', async () => {
  const cena = montarCena();
  try {
    const r = await pedir(cena, { ...base, para: TELEFONE });
    assert.equal(r.status, 202);
    assert.equal(r.corpo?.['configuracao'], 'padrao');
    assert.equal(r.corpo?.['conversa'], undefined);
    assert.deepEqual(envios(cena), [{ conversa_id: null, destino_cru: TELEFONE, conteudo_texto: 'oi' }]);
  } finally {
    cena.limpar();
  }
});

test('conversa e para juntos, ou nenhum dos dois, ou sem configuracao: 400, e nada e gravado', async () => {
  const cena = montarCena();
  try {
    const { configuracao: _semConta, ...semConta } = base;
    const casos = [
      await pedir(cena, { ...base, conversa: cena.ids.grupo, para: GRUPO }),
      await pedir(cena, { ...base }),
      await pedir(cena, { ...semConta, conversa: cena.ids.grupo }),
    ];
    for (const r of casos) {
      assert.equal(r.status, 400);
      // O erro nomeia a regra: a conta e sempre informada, e o destino e conversa OU para.
      assert.match(String(r.corpo?.['erro']), /configuracao e, como destino, conversa OU para/);
    }
    assert.deepEqual(envios(cena), []);
  } finally {
    cena.limpar();
  }
});

test('Conversa inexistente e Conversa de outro Inquilino: 404 de corpo vazio, indistinguiveis', async () => {
  const cena = montarCena();
  try {
    const inexistente = await pedir(cena, { ...base, conversa: 'nao-existe' });
    assert.equal(inexistente.status, 404);
    assert.equal(inexistente.corpo, undefined);
    // O id do grupo existe, mas no Acervo do OUTRO Inquilino ele nao existe.
    const deOutro = await pedir(cena, { ...base, conversa: cena.ids.grupo }, cena.outro.chave);
    assert.equal(deOutro.status, 404);
    assert.equal(deOutro.corpo, undefined);
    assert.deepEqual(envios(cena), []);
  } finally {
    cena.limpar();
  }
});

test('feed de status e lista de transmissao nao sao destinatarios: 400', async () => {
  const cena = montarCena();
  try {
    for (const conversa of [cena.ids.status, cena.ids.transmissao]) {
      const r = await pedir(cena, { ...base, conversa });
      assert.equal(r.status, 400);
      assert.match(String(r.corpo?.['erro']), /destinatario/);
    }
    assert.deepEqual(envios(cena), []);
  } finally {
    cena.limpar();
  }
});

test('Conversa de Fonte sem Envio, ou fonte divergente da Conversa: 400', async () => {
  const cena = montarCena();
  try {
    assert.equal((await pedir(cena, { ...base, conversa: cena.ids.instagram })).status, 400);
    assert.equal((await pedir(cena, { ...base, conversa: cena.ids.grupo, fonte: 'instagram' })).status, 400);
    // Conversa de outra Fonte com endereco de forma de WhatsApp: so a conferencia de fonte a recusa.
    const outraFonte = await pedir(cena, { ...base, conversa: cena.ids.instagramComEnderecoDeWhatsapp });
    assert.equal(outraFonte.status, 400);
    assert.match(String(outraFonte.corpo?.['erro']), /instagram/);
    assert.equal((await pedir(cena, { ...base, conversa: cena.ids.grupo, fonte: 'whatsapp' })).status, 202);
  } finally {
    cena.limpar();
  }
});

test('direta: so a Configuracao dona da Conversa pode enviar; a outra recebe 400 e nada e gravado', async () => {
  const cena = montarCena();
  try {
    const errada = await pedir(cena, { ...base, conversa: cena.ids.deOutraConta });
    assert.equal(errada.status, 400);
    assert.match(String(errada.corpo?.['erro']), /direta pertence a outra Configuracao/);
    const certa = await pedir(cena, { ...base, configuracao: 'outra', conversa: cena.ids.deOutraConta });
    assert.equal(certa.status, 202);
    assert.equal(envios(cena).length, 1);
    // Num grupo qualquer Configuracao serve: o grupo e do Inquilino.
    assert.equal((await pedir(cena, { ...base, configuracao: 'outra', conversa: cena.ids.grupo })).status, 202);
  } finally {
    cena.limpar();
  }
});

test('Configuracao inexistente com conversa valida: 404', async () => {
  const cena = montarCena();
  try {
    assert.equal((await pedir(cena, { ...base, configuracao: 'nao-existe', conversa: cena.ids.grupo })).status, 404);
  } finally {
    cena.limpar();
  }
});

test('Conversa em forma alternativa com par canonico: o Envio vai para a canonica, e a resposta diz as duas', async () => {
  const cena = montarCena();
  try {
    const r = await pedir(cena, { ...base, conversa: cena.ids.opaca });
    assert.equal(r.status, 202);
    assert.equal(r.corpo?.['conversa'], cena.ids.pessoa);
    assert.equal(r.corpo?.['redirecionadaDe'], cena.ids.opaca);
    assert.deepEqual(envios(cena), [{ conversa_id: cena.ids.pessoa, destino_cru: null, conteudo_texto: 'oi' }]);
  } finally {
    cena.limpar();
  }
});

test('forma alternativa SEM Conversa canonica na Configuracao: grava o endereco canonico e diz de qual Conversa veio', async () => {
  const cena = montarCena();
  try {
    const r = await pedir(cena, { ...base, conversa: cena.ids.opacaSemCanonica });
    assert.equal(r.status, 202);
    assert.equal(r.corpo?.['conversa'], undefined);
    assert.equal(r.corpo?.['redirecionadaDe'], cena.ids.opacaSemCanonica);
    assert.deepEqual(envios(cena), [{ conversa_id: null, destino_cru: '5511900000002@s.whatsapp.net', conteudo_texto: 'oi' }]);
  } finally {
    cena.limpar();
  }
});

test('repeticao segura: o mesmo identificador por conversa repete (200), e por para com o mesmo endereco e o mesmo pedido', async () => {
  const cena = montarCena();
  try {
    const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
    const primeira = await pedir(cena, { ...base, conversa: cena.ids.grupo, identificadorDeEnvio: id });
    assert.equal(primeira.status, 202);
    const repetida = await pedir(cena, { ...base, conversa: cena.ids.grupo, identificadorDeEnvio: id });
    assert.equal(repetida.status, 200);
    assert.equal(repetida.corpo?.['repetido'], true);
    assert.equal(repetida.corpo?.['envioId'], primeira.corpo?.['envioId']);
    assert.equal(repetida.corpo?.['configuracao'], 'padrao');
    assert.equal(repetida.corpo?.['conversa'], cena.ids.grupo);
    // Por endereco, com o mesmo identificador, o mesmo conteudo e a mesma Configuracao: e o mesmo pedido.
    const porEndereco = await pedir(cena, { ...base, para: GRUPO, identificadorDeEnvio: id });
    assert.equal(porEndereco.status, 200);
    assert.equal(porEndereco.corpo?.['envioId'], primeira.corpo?.['envioId']);
    // Conteudo diferente com o mesmo identificador: 409.
    const diferente = await pedir(cena, { ...base, texto: 'outro texto', conversa: cena.ids.grupo, identificadorDeEnvio: id });
    assert.equal(diferente.status, 409);
    assert.equal(envios(cena).length, 1);
  } finally {
    cena.limpar();
  }
});
