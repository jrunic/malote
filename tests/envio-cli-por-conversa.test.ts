import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { executar } from '../src/cli/index.js';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';

// #1323: `malote enviar --conversa <id>` no modo local. A conta (`--configuracao`) e sempre explicita; recusa e
// codigo 2, como a Configuracao inexistente, e nunca erro de banco.

const TELEFONE = '5511900000001@s.whatsapp.net';
const OPACO = '123456789012345@lid';

interface Cena {
  raiz: string;
  inquilinoId: string;
  ids: { grupo: string; pessoa: string; opaca: string; opacaSemCanonica: string; deOutraConta: string; status: string; inexistenteDe: string; instagramComEnderecoDeWhatsapp: string };
  limpar: () => void;
}

function montar(): Cena {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilinoId = criarInquilino(registro, { titularNome: 'Leia' });
  const padrao = resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'padrao');
  const outra = resolverConfiguracao(registro, inquilinoId, 'whatsapp', 'outra');
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilinoId as never);
  const cfgPadrao = { id: padrao.id, fonte: 'whatsapp' } as const;
  const cfgOutra = { id: outra.id, fonte: 'whatsapp' } as const;
  const direta = (idExterno: string, configuracao: { id: string; fonte: 'whatsapp' }) =>
    registrarConversa(acervo, { fonte: 'whatsapp', idExterno, coletiva: false, configuracao, bruto: '{}' });
  const grupo = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '120363000000000001@g.us', coletiva: true, bruto: '{}' });
  const status = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: '5511900000009@status', coletiva: true, bruto: '{}' });
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: OPACO, canonico: TELEFONE });
  const pessoa = direta(TELEFONE, cfgPadrao);
  const opaca = direta(OPACO, cfgPadrao);
  const deOutraConta = direta('5511900000003@s.whatsapp.net', cfgOutra);
  // Par aprendido, mas a Conversa de telefone existe so na OUTRA Configuracao: para esta, a canonica ainda nao existe.
  aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: '555555555555555@lid', canonico: '5511900000002@s.whatsapp.net' });
  const opacaSemCanonica = direta('555555555555555@lid', cfgPadrao);
  direta('5511900000002@s.whatsapp.net', cfgOutra);
  // Isola a conferencia de fonte: o endereco PARECE de WhatsApp, entao a recusa do destinatario nao a mascara.
  const instagramComEnderecoDeWhatsapp = registrarConversa(acervo, {
    fonte: 'instagram',
    idExterno: '5511900000010@s.whatsapp.net',
    coletiva: false,
    configuracao: { id: 'cfg-instagram-de-teste', fonte: 'instagram' },
    bruto: '{}',
  });
  acervo.fechar();
  return { raiz, inquilinoId, ids: { grupo, pessoa, opaca, opacaSemCanonica, deOutraConta, status, inexistenteDe: 'nao-existe', instagramComEnderecoDeWhatsapp }, limpar };
}

async function enviar(cena: Cena, ...args: string[]): Promise<{ codigo: number; saida: string }> {
  const linhas: string[] = [];
  const codigo = await executar(['enviar', '--inquilino', cena.inquilinoId, '--texto', 'oi', ...args], {
    dados: cena.raiz,
    estado: cena.raiz,
    escrever: (l: string) => linhas.push(l),
  });
  return { codigo, saida: linhas.join('\n') };
}

function envios(cena: Cena): Array<{ conversa_id: string | null; destino_cru: string | null }> {
  const a = abrirAcervo(join(cena.raiz, 'acervos'), cena.inquilinoId as never);
  try {
    return a.preparar('SELECT conversa_id, destino_cru FROM envios ORDER BY rowid').all() as Array<{
      conversa_id: string | null;
      destino_cru: string | null;
    }>;
  } finally {
    a.fechar();
  }
}

test('--conversa de grupo: Envio ligado a Conversa, e a saida diz a conta e a Conversa', async () => {
  const cena = montar();
  try {
    const r = await enviar(cena, '--configuracao', 'padrao', '--conversa', cena.ids.grupo);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /Envio registrado/);
    assert.match(r.saida, new RegExp(`pela Configuracao padrao, para a Conversa ${cena.ids.grupo}`));
    assert.deepEqual(envios(cena), [{ conversa_id: cena.ids.grupo, destino_cru: null }]);
  } finally {
    cena.limpar();
  }
});

test('--conversa --json traz a conta, a Conversa e o redirecionamento, e so o JSON', async () => {
  const cena = montar();
  try {
    const r = await enviar(cena, '--configuracao', 'padrao', '--conversa', cena.ids.opaca, '--json');
    assert.equal(r.codigo, 0, r.saida);
    const corpo = JSON.parse(r.saida) as Record<string, unknown>;
    assert.equal(corpo['configuracao'], 'padrao');
    assert.equal(corpo['conversa'], cena.ids.pessoa);
    assert.equal(corpo['redirecionadaDe'], cena.ids.opaca);
    assert.deepEqual(envios(cena), [{ conversa_id: cena.ids.pessoa, destino_cru: null }]);
  } finally {
    cena.limpar();
  }
});

test('--conversa de forma alternativa: o texto diz qual Conversa foi usada no lugar de qual', async () => {
  const cena = montar();
  try {
    const r = await enviar(cena, '--configuracao', 'padrao', '--conversa', cena.ids.opaca);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, new RegExp(`Conversa ${cena.ids.pessoa} usada no lugar de ${cena.ids.opaca}`));
  } finally {
    cena.limpar();
  }
});

test('--conversa de forma alternativa SEM canonica: o texto fala do endereco canonico e o Envio vai por endereco', async () => {
  const cena = montar();
  try {
    const r = await enviar(cena, '--configuracao', 'padrao', '--conversa', cena.ids.opacaSemCanonica);
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /pela Configuracao padrao, para o endereco canonico da Conversa dada/);
    assert.doesNotMatch(r.saida, new RegExp(`para a Conversa ${cena.ids.opacaSemCanonica}`));
    assert.match(r.saida, new RegExp(`O endereco canonico foi usado no lugar da Conversa ${cena.ids.opacaSemCanonica}`));
    assert.deepEqual(envios(cena), [{ conversa_id: null, destino_cru: '5511900000002@s.whatsapp.net' }]);
  } finally {
    cena.limpar();
  }
});

test('por --para a saida tambem diz a conta, com o endereco mascarado', async () => {
  const cena = montar();
  try {
    const r = await enviar(cena, '--configuracao', 'padrao', '--para', '5511999990000@s.whatsapp.net');
    assert.equal(r.codigo, 0, r.saida);
    assert.match(r.saida, /pela Configuracao padrao, para \.\.\.0000@s\.whatsapp\.net/);
    assert.doesNotMatch(r.saida, /5511999990000/);
  } finally {
    cena.limpar();
  }
});

test('recusas de uso saem 2, com mensagem, e nada e gravado', async () => {
  const cena = montar();
  try {
    const casos: Array<{ nome: string; args: string[]; casa: RegExp }> = [
      { nome: 'os dois destinos', args: ['--configuracao', 'padrao', '--conversa', cena.ids.grupo, '--para', TELEFONE], casa: /--conversa OU --para/ },
      { nome: 'nenhum destino', args: ['--configuracao', 'padrao'], casa: /Uso:/ },
      { nome: 'sem a conta', args: ['--conversa', cena.ids.grupo], casa: /Uso:/ },
      { nome: 'Conversa inexistente', args: ['--configuracao', 'padrao', '--conversa', cena.ids.inexistenteDe], casa: /Conversa .* nao existe/ },
      { nome: 'feed de status', args: ['--configuracao', 'padrao', '--conversa', cena.ids.status], casa: /destinatario/ },
      { nome: 'Conversa de outra Fonte', args: ['--configuracao', 'padrao', '--conversa', cena.ids.instagramComEnderecoDeWhatsapp], casa: /so o whatsapp tem Envio/ },
      { nome: 'direta de outra conta', args: ['--configuracao', 'padrao', '--conversa', cena.ids.deOutraConta], casa: /outra Configuracao/ },
      { nome: 'Configuracao inexistente', args: ['--configuracao', 'nao-existe', '--conversa', cena.ids.grupo], casa: /nao existe/ },
    ];
    for (const caso of casos) {
      const r = await enviar(cena, ...caso.args);
      assert.equal(r.codigo, 2, `${caso.nome}: ${r.saida}`);
      assert.match(r.saida, caso.casa, caso.nome);
    }
    assert.deepEqual(envios(cena), []);
    // E a conta certa da direta funciona.
    const certa = await enviar(cena, '--configuracao', 'outra', '--conversa', cena.ids.deOutraConta);
    assert.equal(certa.codigo, 0, certa.saida);
  } finally {
    cena.limpar();
  }
});
