import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { executar } from '../src/cli/index.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import {
  definirIntervaloEsperado,
  lerIntervaloEsperado,
} from '../src/registro/intervalo-esperado.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { registrarMaterialConcluido } from '../src/nucleo/sincronizacao.js';

/** Monta Inquilino com uma Configuração de WhatsApp, devolvendo os dois ids. */
function instalacaoComConfiguracao(): {
  raiz: string;
  inquilino: string;
  configuracao: string;
  limpar: () => void;
} {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const inquilino = criarInquilino(registro, { titularNome: 'Leia Organa' });
  const cfg = resolverConfiguracao(registro, inquilino, 'whatsapp');
  registro.fechar();
  return { raiz, inquilino, configuracao: cfg.id, limpar };
}

function rodar(raiz: string, argumentos: string[]): { codigo: number; saida: string } {
  const linhas: string[] = [];
  const codigo = executar(argumentos, { dados: raiz, estado: raiz, escrever: (t: string) => linhas.push(t) });
  return { codigo, saida: linhas.join('\n') };
}

/** Registra um Material com data recuada, para simular passagem de tempo. */
function registrarMaterialHaDias(raiz: string, inquilino: string, cfg: string, dias: number): void {
  const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
  try {
    registrarMaterialConcluido(acervo, {
      configuracaoId: cfg,
      fonte: 'whatsapp',
      impressao: `impressao-${dias}`,
      conversasCriadas: 1,
      mensagensCriadas: 1,
    });
    const quando = new Date(Date.now() - dias * 86_400_000).toISOString();
    acervo.db.prepare('UPDATE materiais SET registrado_em = ? WHERE configuracao_id = ?')
      .run(quando, cfg);
  } finally {
    acervo.fechar();
  }
}

test('o intervalo esperado é por Configuração, e é opcional', () => {
  const i = instalacaoComConfiguracao();
  try {
    const registro = abrirRegistro(i.raiz);
    try {
      assert.equal(lerIntervaloEsperado(registro, i.configuracao), null, 'nasce sem intervalo');
      definirIntervaloEsperado(registro, i.configuracao, 30);
      assert.equal(lerIntervaloEsperado(registro, i.configuracao)?.dias, 30);
      assert.throws(() => definirIntervaloEsperado(registro, i.configuracao, 0), /maior que zero/);
    } finally {
      registro.fechar();
    }
  } finally {
    i.limpar();
  }
});

test('sem intervalo declarado, nunca há atraso — código 0', () => {
  const i = instalacaoComConfiguracao();
  try {
    registrarMaterialHaDias(i.raiz, i.inquilino, i.configuracao, 999);
    const r = rodar(i.raiz, ['material', 'atraso', '--inquilino', i.inquilino]);
    assert.equal(r.codigo, 0, 'ausência de intervalo nunca vira alarme');
  } finally {
    i.limpar();
  }
});

test('Material recente dentro do intervalo — código 0', () => {
  const i = instalacaoComConfiguracao();
  try {
    const registro = abrirRegistro(i.raiz);
    definirIntervaloEsperado(registro, i.configuracao, 30);
    registro.fechar();
    registrarMaterialHaDias(i.raiz, i.inquilino, i.configuracao, 3);

    const r = rodar(i.raiz, ['material', 'atraso', '--inquilino', i.inquilino]);
    assert.equal(r.codigo, 0);
    assert.match(r.saida, /em dia/);
  } finally {
    i.limpar();
  }
});

test('Material mais velho que o intervalo — código diferente de 0, nomeando a Configuração', () => {
  const i = instalacaoComConfiguracao();
  try {
    const registro = abrirRegistro(i.raiz);
    definirIntervaloEsperado(registro, i.configuracao, 30);
    registro.fechar();
    registrarMaterialHaDias(i.raiz, i.inquilino, i.configuracao, 45);

    const r = rodar(i.raiz, ['material', 'atraso', '--inquilino', i.inquilino]);
    assert.notEqual(r.codigo, 0, 'o contrato deste comando é o código de saída');
    assert.match(r.saida, /whatsapp\/padrao/, 'a saída nomeia a Configuração atrasada');
    assert.match(r.saida, /atrasad/i);
  } finally {
    i.limpar();
  }
});

test('intervalo declarado e nenhum Material conta a partir da declaração', () => {
  const i = instalacaoComConfiguracao();
  try {
    const registro = abrirRegistro(i.raiz);
    definirIntervaloEsperado(registro, i.configuracao, 30);
    // Recua a declaracao: instalacao configurada ha 45 dias e ingestao que
    // nunca rodou. E o caso que mais importa, e o que ficaria em silencio se
    // ausencia de Material fosse lida como "nada a cobrar".
    registro.db
      .prepare('UPDATE intervalos_esperados SET declarado_em = ? WHERE configuracao_id = ?')
      .run(new Date(Date.now() - 45 * 86_400_000).toISOString(), i.configuracao);
    registro.fechar();

    const r = rodar(i.raiz, ['material', 'atraso', '--inquilino', i.inquilino]);
    assert.notEqual(r.codigo, 0, 'setup feito e ingestão que nunca rodou é atraso');
    assert.match(r.saida, /nenhum Material/i);
  } finally {
    i.limpar();
  }
});
