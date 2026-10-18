import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar } from '../src/cli/index.js';
import { criarExportador } from '../src/cli/exportar.js';
import { linhasDaMensagemEditada, textoParaExibir } from '../src/cli/edicoes-texto.js';
import { cenario } from './ajuda/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarEdicao } from '../src/nucleo/edicao.js';
import { lerMensagens } from '../src/nucleo/consulta.js';

const AGORA = Date.parse('2026-10-13T12:00:00Z');
const T0 = Date.parse('2026-10-01T10:00:00Z');

function cena() {
  const c = cenario();
  const { id: inquilino, acervo } = c.novoInquilino('Padme');
  const conversaId = registrarConversa(acervo, {
    fonte: 'whatsapp',
    idExterno: 'a@s.whatsapp.net',
    coletiva: false,
    configuracao: CFG_WHATSAPP,
  });
  const mensagem = (idExterno: string, conteudo: string | undefined, minuto: number): string =>
    registrarMensagem(acervo, {
      conversaId,
      fonte: 'whatsapp',
      idExterno,
      ocorridaEm: T0 + minuto * 60_000,
      agora: AGORA,
      direcao: 'recebida',
      ...(conteudo !== undefined ? { conteudo } : {}),
    });
  const editar = (mensagemId: string, idExterno: string, texto: string, minuto: number): void => {
    registrarEdicao(acervo, {
      mensagemId,
      fonte: 'whatsapp',
      idExterno,
      texto,
      editadaEm: T0 + minuto * 60_000,
      origem: 'cifrada',
      bruto: '{}',
      agora: AGORA,
    });
  };
  const ambiente = (linhas: string[]) => ({ dados: c.raiz, estado: c.raiz, escrever: (t: string) => linhas.push(t) });
  return { c, acervo, inquilino, conversaId, mensagem, editar, ambiente };
}

const iso = (minuto: number): string => new Date(T0 + minuto * 60_000).toISOString();

test('mensagens em texto: o texto atual com a marca (editada) e as versoes anteriores abaixo, a original primeiro', () => {
  const { c, acervo, inquilino, conversaId, mensagem, editar, ambiente } = cena();
  try {
    const id = mensagem('M1', 'versao um', 1);
    editar(id, 'EV-1', 'versao dois', 2);
    editar(id, 'EV-2', 'versao tres', 3);
    mensagem('M2', 'sem edicao', 4);
    acervo.fechar();

    const linhas: string[] = [];
    const codigo = executar(['mensagens', '--inquilino', inquilino, '--conversa', conversaId, '--ordem', 'cronologica'], ambiente(linhas));
    assert.equal(codigo, 0);
    assert.deepEqual(linhas, [
      `${iso(1)}  versao tres (editada)`,
      '    [antes] versao um',
      '    [antes] versao dois',
      `${iso(4)}  sem edicao`,
    ]);
  } finally {
    c.limpar();
  }
});

test('mensagens em texto: a Mensagem sem edicao sai como sempre, sem marca e sem linha extra', () => {
  const { c, acervo, inquilino, conversaId, mensagem, ambiente } = cena();
  try {
    mensagem('M1', 'oi', 1);
    mensagem('M2', undefined, 2);
    acervo.fechar();
    const linhas: string[] = [];
    executar(['mensagens', '--inquilino', inquilino, '--conversa', conversaId, '--ordem', 'cronologica'], ambiente(linhas));
    assert.deepEqual(linhas, [`${iso(1)}  oi`, `${iso(2)}  (sem texto)`]);
  } finally {
    c.limpar();
  }
});

test('mensagens em texto: a legenda editada de uma midia sem texto nao inventa versao anterior; legenda apagada fica (sem texto)', () => {
  const { c, acervo, inquilino, conversaId, mensagem, editar, ambiente } = cena();
  try {
    const comLegenda = mensagem('M1', undefined, 1);
    editar(comLegenda, 'EV-1', 'legenda nova', 2);
    const apagada = mensagem('M2', 'texto', 3);
    editar(apagada, 'EV-2', '', 4);
    acervo.fechar();
    const linhas: string[] = [];
    executar(['mensagens', '--inquilino', inquilino, '--conversa', conversaId, '--ordem', 'cronologica'], ambiente(linhas));
    assert.deepEqual(linhas, [
      `${iso(1)}  legenda nova (editada)`,
      `${iso(3)}  (sem texto) (editada)`,
      '    [antes] texto',
    ]);
  } finally {
    c.limpar();
  }
});

test('buscar em texto mostra a Mensagem editada do mesmo jeito', () => {
  const { c, acervo, inquilino, mensagem, editar, ambiente } = cena();
  try {
    const id = mensagem('M1', 'palavraoriginal aqui', 1);
    editar(id, 'EV-1', 'corrigido', 2);
    acervo.fechar();
    const linhas: string[] = [];
    executar(['buscar', '--texto', 'palavraoriginal', '--inquilino', inquilino], ambiente(linhas));
    assert.deepEqual(linhas, [`${iso(1)}  corrigido (editada)`, '    [antes] palavraoriginal aqui']);
  } finally {
    c.limpar();
  }
});

test('mensagens --json traz as edicoes e o texto atual', () => {
  const { c, acervo, inquilino, conversaId, mensagem, editar, ambiente } = cena();
  try {
    const id = mensagem('M1', 'original', 1);
    editar(id, 'EV-1', 'corrigido', 2);
    acervo.fechar();
    const linhas: string[] = [];
    executar(['mensagens', '--inquilino', inquilino, '--conversa', conversaId, '--json'], ambiente(linhas));
    const saida = JSON.parse(linhas.join('\n')) as Array<{ conteudo: string; textoAtual: string; edicoes: Array<{ texto: string; origem: string }> }>;
    assert.equal(saida[0]?.conteudo, 'original');
    assert.equal(saida[0]?.textoAtual, 'corrigido');
    assert.deepEqual(saida[0]?.edicoes.map((e) => [e.texto, e.origem]), [['corrigido', 'cifrada']]);
  } finally {
    c.limpar();
  }
});

test('exportar txt mostra o texto atual, a marca e as versoes anteriores; o json leva os campos', () => {
  const { c, acervo, conversaId, mensagem, editar } = cena();
  try {
    const id = mensagem('M1', 'versao um', 1);
    editar(id, 'EV-1', 'versao dois\nem duas linhas', 2);
    mensagem('M2', 'sem edicao', 3);
    const lidas = lerMensagens(acervo, { conversaId, ordem: 'cronologica' });
    const exportar = (formato: 'txt' | 'json'): string[] => {
      const linhas: string[] = [];
      const e = criarExportador({
        formato,
        conversaId,
        filtros: {},
        exportadoEm: '2026-10-13T12:00:00.000Z',
        autores: [],
        escrever: (l) => linhas.push(l),
      });
      e.acrescentar(lidas);
      e.concluir();
      return linhas;
    };
    const txt = exportar('txt');
    assert.deepEqual(txt, [
      '2026-10-01 10:01:00  (sistema): versao dois',
      '    em duas linhas (editada)',
      '    [antes] versao um',
      '2026-10-01 10:03:00  (sistema): sem edicao',
    ]);
    const json = JSON.parse(exportar('json').join('')) as { mensagens: Array<{ textoAtual: string; edicoes: unknown[] }> };
    assert.equal(json.mensagens[0]?.textoAtual, 'versao dois\nem duas linhas');
    assert.equal(json.mensagens[0]?.edicoes.length, 1);
    assert.deepEqual(json.mensagens[1]?.edicoes, []);
  } finally {
    c.limpar();
  }
});

test('servidor anterior a esta versao nao devolve os campos: o texto sai como sempre', () => {
  const m = { conteudo: 'oi' };
  assert.equal(textoParaExibir(m), 'oi');
  assert.deepEqual(linhasDaMensagemEditada(m), []);
  assert.equal(textoParaExibir({ conteudo: null }), '(sem texto)');
});
