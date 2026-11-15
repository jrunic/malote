import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { abrirAcervo, type Acervo } from '../src/nucleo/acervo.js';
import { registrarMensagem } from '../src/nucleo/escrita.js';
import { abrirRegistro } from '../src/registro/registro.js';
import {
  lerPrecedenciasDeNome,
  type PrecedenciaDeNome,
} from '../src/registro/precedencia-de-nome.js';
import { executarExportarLocal, lerPedidoDeExport } from '../src/cli/exportar.js';
import {
  semearIdentidade,
  subirCenaDeIdentidade,
  CARLA,
  CARLA_LID,
  minuto,
} from './ajuda/identidade.js';
import { instalacaoComChave, instalacaoTemporaria, rodar } from './ajuda/instalacao.js';

const ESPERADO = { valor: CARLA_LID, canonico: CARLA, nome: 'Carla Souza' };

interface MensagemDaResposta {
  conteudo: string | null;
  autor: unknown;
}

test('as saidas de Mensagem por rede trazem o mesmo autor: por Conversa, sem Conversa, busca e Chegadas', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo, s) => {
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        conversaId: s.grupo,
        fonte: 'whatsapp',
        idExterno: 'ra-1',
        autorId: s.carlaLid,
        conteudo: 'oi do opaco',
        ocorridaEm: minuto(60),
        agora: Date.now(),
        direcao: 'recebida',
      });
    },
  });
  try {
    const ler = async (caminho: string): Promise<Record<string, unknown>> => {
      const r = await cena.pedir(caminho, cena.chave.valor);
      assert.equal(r.status, 200, `${caminho}: ${r.corpo}`);
      return JSON.parse(r.corpo) as Record<string, unknown>;
    };
    const achar = (mensagens: unknown, texto: string): MensagemDaResposta => {
      const m = (mensagens as MensagemDaResposta[]).find((x) => x.conteudo === texto);
      assert.ok(m, `a Mensagem "${texto}" esta na resposta`);
      return m;
    };
    const porConversa = await ler(`/conversas/${cena.s.grupo}/mensagens?limite=50`);
    assert.deepEqual(achar(porConversa['mensagens'], 'oi do opaco').autor, ESPERADO);
    const semConversa = await ler('/mensagens?limite=50');
    assert.deepEqual(achar(semConversa['mensagens'], 'oi do opaco').autor, ESPERADO);
    const busca = await ler('/buscar?texto=opaco');
    assert.deepEqual(achar(busca['mensagens'], 'oi do opaco').autor, ESPERADO);

    // Chegadas com conteudo: a Mensagem gravada depois do ponto de partida traz o mesmo autor.
    const inicio = (await ler('/chegadas?ponto-de-partida=1'))['proximo'] as string;
    const acervo = abrirAcervo(join(cena.raiz, 'acervos'), cena.inquilinoId);
    try {
      registrarMensagem(acervo, {
        origemDaChegada: 'ao-vivo',
        conversaId: cena.s.grupo,
        fonte: 'whatsapp',
        idExterno: 'ra-2',
        autorId: cena.s.carlaLid,
        conteudo: 'chegou agora',
        ocorridaEm: minuto(61),
        agora: Date.now(),
        direcao: 'recebida',
      });
    } finally {
      acervo.fechar();
    }
    const chegadas = await ler(`/chegadas?depois=${encodeURIComponent(inicio)}&conteudo=1`);
    const conteudos = (chegadas['chegadas'] as Array<{ conteudo?: MensagemDaResposta | null }>).map(
      (c) => c.conteudo,
    );
    assert.deepEqual(achar(conteudos, 'chegou agora').autor, ESPERADO);
  } finally {
    cena.encerrar();
  }
});

test('as saidas de Mensagem da CLI local trazem o mesmo autor: mensagens, buscar, chegadas e exportar', () => {
  const { raiz, limpar } = instalacaoTemporaria();
  try {
    const { inquilino } = instalacaoComChave(raiz);
    const json = (argumentos: string[]): unknown => {
      const r = rodar(raiz, argumentos);
      assert.equal(r.codigo, 0, `${argumentos.join(' ')}: ${r.saida}`);
      return JSON.parse(r.saida) as unknown;
    };
    const comAcervo = <T>(f: (acervo: Acervo) => T): T => {
      const acervo = abrirAcervo(join(raiz, 'acervos'), inquilino);
      try {
        return f(acervo);
      } finally {
        acervo.fechar();
      }
    };
    const s = comAcervo((acervo) => semearIdentidade(acervo));
    const inicio = (
      json(['chegadas', '--inquilino', inquilino, '--ponto-de-partida', '--json']) as {
        proximo: string;
      }
    ).proximo;
    comAcervo((acervo) =>
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        conversaId: s.grupo,
        fonte: 'whatsapp',
        idExterno: 'rl-1',
        autorId: s.carlaLid,
        conteudo: 'oi do opaco',
        ocorridaEm: minuto(60),
        agora: Date.now(),
        direcao: 'recebida',
      }),
    );
    const achar = (mensagens: unknown): MensagemDaResposta => {
      const m = (mensagens as MensagemDaResposta[]).find((x) => x?.conteudo === 'oi do opaco');
      assert.ok(m, 'a Mensagem esta na resposta');
      return m;
    };
    // a saida local de `mensagens --json` e a lista pura
    assert.deepEqual(
      achar(json(['mensagens', '--inquilino', inquilino, '--conversa', s.grupo, '--json'])).autor,
      ESPERADO,
    );
    assert.deepEqual(
      achar(json(['buscar', '--inquilino', inquilino, '--texto', 'opaco', '--json'])).autor,
      ESPERADO,
    );
    const chegadas = json([
      'chegadas',
      '--inquilino',
      inquilino,
      '--depois',
      inicio,
      '--com-conteudo',
      '--json',
    ]) as { chegadas: Array<{ conteudo?: unknown }> };
    assert.deepEqual(achar(chegadas.chegadas.map((c) => c.conteudo)).autor, ESPERADO);

    const lido = lerPedidoDeExport(['exportar', '--conversa', s.grupo, '--formato', 'json']);
    assert.ok('pedido' in lido);
    const saida: string[] = [];
    const registro = abrirRegistro(raiz);
    let precedencia: PrecedenciaDeNome;
    try {
      precedencia = lerPrecedenciasDeNome(registro, inquilino);
    } finally {
      registro.fechar();
    }
    comAcervo((acervo) =>
      executarExportarLocal(acervo, precedencia, lido.pedido, {
        escrever: (t) => saida.push(t),
        erro: (t) => saida.push(t),
      }),
    );
    const exportado = JSON.parse(saida.join('\n')) as { mensagens: unknown };
    assert.deepEqual(achar(exportado.mensagens).autor, ESPERADO);
  } finally {
    limpar();
  }
});
