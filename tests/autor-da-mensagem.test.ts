import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarMensagens, lerMensagens, lerMensagensPorIds } from '../src/nucleo/consulta.js';
import { registrarIdentificador, registrarMensagem } from '../src/nucleo/escrita.js';
import { registrarNome } from '../src/nucleo/identidade.js';
import {
  acervoDeIdentidade,
  PRECEDENCIA,
  BRUNO,
  CARLA,
  CARLA_LID,
  SOLTO_LID,
  minuto,
} from './ajuda/identidade.js';
import type { Acervo } from '../src/nucleo/acervo.js';

let n = 1000;
function escrever(
  acervo: Acervo,
  conversaId: string,
  autorId: string | undefined,
  direcao: 'enviada' | 'recebida',
  quando: number,
  conteudo = `t ${n + 1}`,
): string {
  n += 1;
  return registrarMensagem(acervo, {
    origemDaChegada: 'importacao',
    conversaId,
    fonte: 'whatsapp',
    idExterno: `autor-${n}`,
    ...(autorId === undefined ? {} : { autorId }),
    conteudo,
    ocorridaEm: quando,
    agora: Date.now(),
    direcao,
  });
}

test('o autor da forma opaca traz o endereco gravado, o canonico e o nome do contato (caso de origem)', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escrever(acervo, s.grupo, s.carlaLid, 'recebida', minuto(30));
    const m = lerMensagens(acervo, { conversaId: s.grupo, precedencia: PRECEDENCIA }).find(
      (x) => x.autorId === s.carlaLid,
    )!;
    assert.deepEqual(m.autor, { valor: CARLA_LID, canonico: CARLA, nome: 'Carla Souza' });
    assert.equal(m.autorId, s.carlaLid, 'o id continua como estava');
  } finally {
    limpar();
  }
});

test('o nome vem do contato pelas duas formas: o nome do proprio opaco, quando ha, vence pela precedencia', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    // o opaco ganha um nome de catalogo (titular); a precedencia o poe acima do da plataforma do numero
    registrarNome(acervo, {
      identificadorId: s.carlaLid,
      origem: 'contatos',
      nome: 'Carla Agenda',
      autoridade: 'titular',
    });
    escrever(acervo, s.grupo, s.carlaLid, 'recebida', minuto(31));
    const m = lerMensagens(acervo, { conversaId: s.grupo, precedencia: PRECEDENCIA }).find(
      (x) => x.autorId === s.carlaLid,
    )!;
    assert.equal(m.autor?.nome, 'Carla Agenda');
  } finally {
    limpar();
  }
});

test('sem par, o canonico e nulo e o endereco gravado e a unica forma', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escrever(acervo, s.grupo, s.solto, 'recebida', minuto(32));
    const m = lerMensagens(acervo, { conversaId: s.grupo, precedencia: PRECEDENCIA }).find(
      (x) => x.autorId === s.solto,
    )!;
    assert.deepEqual(m.autor, { valor: SOLTO_LID, canonico: null, nome: null });
  } finally {
    limpar();
  }
});

test('Mensagem enviada pela conta e Mensagem sem autor trazem autor nulo', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escrever(acervo, s.grupo, undefined, 'enviada', minuto(33));
    escrever(acervo, s.grupo, s.bruno, 'enviada', minuto(34));
    escrever(acervo, s.grupo, undefined, 'recebida', minuto(35));
    const ms = lerMensagens(acervo, { conversaId: s.grupo, precedencia: PRECEDENCIA });
    const enviadas = ms.filter((x) => x.direcao === 'enviada');
    assert.equal(enviadas.length, 2);
    for (const e of enviadas) assert.equal(e.autor, null);
    const semAutor = ms.filter((x) => x.autorId === null);
    assert.equal(semAutor.length, 2);
    for (const e of semAutor) assert.equal(e.autor, null);
    // e as recebidas com autor do grupo trazem o autor: o nulo acima nao e o de sempre
    assert.ok(
      ms
        .filter((x) => x.direcao === 'recebida' && x.autorId !== null)
        .every((x) => x.autor !== null),
    );
  } finally {
    limpar();
  }
});

test('sem precedencia o nome e nulo, o resto do autor continua', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    escrever(acervo, s.grupo, s.carlaLid, 'recebida', minuto(36));
    const m = lerMensagens(acervo, { conversaId: s.grupo }).find((x) => x.autorId === s.carlaLid)!;
    assert.deepEqual(m.autor, { valor: CARLA_LID, canonico: CARLA, nome: null });
  } finally {
    limpar();
  }
});

test('o Bruno, canonico com alternativa so em correspondencia, traz o proprio endereco e o canonico igual a ele', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const m = lerMensagens(acervo, { conversaId: s.diretaDeBruno, precedencia: PRECEDENCIA })[0]!;
    assert.deepEqual(m.autor, { valor: BRUNO, canonico: BRUNO, nome: 'Bruno Contato' });
  } finally {
    limpar();
  }
});

test('a leitura por ids e a busca trazem o mesmo autor que a leitura por Conversa', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    const id = escrever(acervo, s.grupo, s.carlaLid, 'recebida', minuto(37), 'oi do opaco');
    const esperado = { valor: CARLA_LID, canonico: CARLA, nome: 'Carla Souza' };
    assert.deepEqual(lerMensagensPorIds(acervo, [id], PRECEDENCIA)[0]!.autor, esperado);
    const achada = buscarMensagens(acervo, { texto: 'opaco', precedencia: PRECEDENCIA }).find(
      (m) => m.id === id,
    )!;
    assert.deepEqual(achada.autor, esperado);
  } finally {
    limpar();
  }
});

test('o autor da pagina inteira sai em lote: o mesmo numero de consultas para 3 e para 30 autores', () => {
  const { acervo, s, limpar } = acervoDeIdentidade();
  try {
    for (let i = 0; i < 30; i += 1) {
      const autor = registrarIdentificador(acervo, {
        fonte: 'whatsapp',
        valor: `${700000 + i}@lid`,
      }).id;
      registrarNome(acervo, {
        identificadorId: autor,
        origem: 'whatsapp',
        nome: `Autor ${i}`,
        autoridade: 'terceiro',
      });
      escrever(acervo, s.grupo, autor, 'recebida', minuto(100 + i));
    }
    const original = acervo.preparar.bind(acervo);
    const contar = (limite: number): number => {
      let consultas = 0;
      acervo.preparar = (sql: string) => {
        if (
          /FROM correspondencias_de_endereco\b|FROM atribuicoes_de_nome\b|JOIN correspondencias_de_endereco\b/.test(
            sql,
          )
        )
          consultas += 1;
        return original(sql);
      };
      try {
        const lidas = lerMensagens(acervo, {
          conversaId: s.grupo,
          de: minuto(100),
          limite,
          precedencia: PRECEDENCIA,
        });
        assert.equal(lidas.length, limite);
        assert.ok(lidas.every((m) => m.autor?.nome?.startsWith('Autor ')));
      } finally {
        acervo.preparar = original;
      }
      return consultas;
    };
    const de3 = contar(3);
    const de30 = contar(30);
    assert.ok(de3 > 0, 'a leitura consulta a correspondencia e os nomes');
    assert.equal(de30, de3);
  } finally {
    limpar();
  }
});
