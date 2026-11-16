import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarNome } from '../src/nucleo/identidade.js';
import { registrarMensagem } from '../src/nucleo/escrita.js';
import { subirCenaDeIdentidade, minuto, EDU } from './ajuda/identidade.js';

// Bloco codificado medido em campo (#1137): metadado sem texto que a plataforma grava no lugar do nome.
const BLOCO = '+EAAYrP740wYgAQ==';

interface ComNome {
  identificadorId?: string;
  nome: string | null;
}
interface Resposta {
  identificadores: Array<ComNome & { nomes: ComNome[] }>;
  presenca: Record<'presentes' | 'sairamAntes' | 'aindaNaoEntraram' | 'semInformacao', ComNome[]>;
  autores: ComNome[];
  mensagens: Array<{ conteudo: string | null; autor?: ComNome }>;
}

test('identificar, participantes, autores e o autor da Mensagem mostram o push name e nao o bloco; o bloco segue em nomes', async () => {
  const cena = await subirCenaDeIdentidade({
    semearMais: (acervo, s) => {
      registrarNome(acervo, {
        identificadorId: s.edu,
        origem: 'whatsapp',
        nome: BLOCO,
        autoridade: 'titular',
      });
      registrarNome(acervo, {
        identificadorId: s.edu,
        origem: 'whatsapp',
        nome: 'Edu Real',
        autoridade: 'terceiro',
      });
      // o Edu so participa: para entrar em `autores` (a leitura da exportacao por rede) ele precisa escrever uma Mensagem
      registrarMensagem(acervo, {
        origemDaChegada: 'importacao',
        conversaId: s.grupo,
        fonte: 'whatsapp',
        idExterno: 'nb-1',
        autorId: s.edu,
        conteudo: 'oi',
        ocorridaEm: minuto(70),
        agora: Date.now(),
        direcao: 'recebida',
      });
    },
  });
  try {
    const ler = async (caminho: string): Promise<Resposta> => {
      const r = await cena.pedir(caminho, cena.chave.valor);
      assert.equal(r.status, 200, caminho);
      return JSON.parse(r.corpo) as Resposta;
    };
    const ident = await ler(`/identificadores?valor=${encodeURIComponent(EDU)}`);
    const edu = ident.identificadores[0]!;
    assert.equal(edu.nome, 'Edu Real');
    assert.ok(
      edu.nomes.some((n) => n.nome === BLOCO),
      'o dado nao e apagado',
    );

    const part = await ler(`/conversas/${cena.s.grupo}/participantes`);
    const todos = [
      ...part.presenca.presentes,
      ...part.presenca.sairamAntes,
      ...part.presenca.aindaNaoEntraram,
      ...part.presenca.semInformacao,
    ];
    assert.equal(todos.find((p) => p.identificadorId === cena.s.edu)?.nome, 'Edu Real');

    const autores = await ler(`/conversas/${cena.s.grupo}/autores`);
    assert.equal(autores.autores.find((a) => a.identificadorId === cena.s.edu)?.nome, 'Edu Real');

    // O autor da Mensagem (#1517, criterio 1c) le a precedencia pelo helper da rede: o nome real vence o bloco ali tambem.
    const mensagens = await ler(`/conversas/${cena.s.grupo}/mensagens?limite=50`);
    assert.equal(mensagens.mensagens.find((m) => m.conteudo === 'oi')?.autor?.nome, 'Edu Real');
  } finally {
    cena.encerrar();
  }
});
