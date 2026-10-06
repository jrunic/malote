import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { umaColetiva } from './ajuda/etiqueta.js';
import { registrarEtiqueta, registrarIdentificador } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia } from '../src/nucleo/correspondencia.js';
import { resolverRetroativamente } from '../src/nucleo/resolucao-retroativa.js';
import { desfazerOperacao } from '../src/nucleo/desfazer.js';
import { conferirEtiquetasRepetidas } from '../src/nucleo/integridade.js';

const T0 = Date.parse('2026-10-05T15:00:00Z');
const LID = '109876543210987@lid';
const TEL = '5565911110001@s.whatsapp.net';

function quem(acervo: Parameters<typeof registrarIdentificador>[0], valor: string): string {
  return registrarIdentificador(acervo, { fonte: 'whatsapp', valor }).id;
}

function evento(conversaId: string, identificadorId: string, texto: string, idExterno: string) {
  return { conversaId, identificadorId, texto, ocorridaEm: T0, fonte: 'whatsapp' as const, idExterno };
}

function contar(acervo: Parameters<typeof registrarIdentificador>[0]): number {
  return (acervo.db.prepare('SELECT COUNT(*) AS n FROM etiquetas_de_participacao').get() as { n: number }).n;
}

test('o evento gravado sob o LID passa ao Identificador do telefone quando o par e aprendido, sem perder linha', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const lid = quem(acervo, LID);
    const tel = quem(acervo, TEL);
    registrarEtiqueta(acervo, evento(conversa, lid, 'Torre A', 'EV1'));
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: TEL });

    const antes = contar(acervo);
    const r = resolverRetroativamente(acervo, { comEfeito: true });
    assert.equal(contar(acervo), antes, 'a resolucao perdeu ou criou linha de etiqueta');
    assert.equal(r.linhasRepontadas['etiquetas_de_participacao'], 1);
    const linha = acervo.db
      .prepare('SELECT identificador_id AS id FROM etiquetas_de_participacao WHERE id_externo = ?')
      .get('EV1') as { id: string };
    assert.equal(linha.id, tel);
  } finally {
    c.limpar();
  }
});

test('o MESMO evento sob os dois Identificadores funde na linha do canonico, sem UNIQUE estourando', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const lid = quem(acervo, LID);
    const tel = quem(acervo, TEL);
    // As duas linhas existem porque o par ainda era desconhecido na hora de cada uma.
    registrarEtiqueta(acervo, evento(conversa, lid, 'Torre A', 'EV1'));
    registrarEtiqueta(acervo, evento(conversa, tel, 'Torre A', 'EV1'));
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: TEL });

    // A fixture PRODUZ o defeito antes de medir a correcao: detector que ja
    // estava em zero nao prova nada.
    assert.equal(conferirEtiquetasRepetidas(acervo), 1, 'a fixture nao criou a duplicacao');

    const r = resolverRetroativamente(acervo, { comEfeito: true });
    assert.equal(r.linhasFundidas['etiquetas_de_participacao'], 1);
    assert.equal(contar(acervo), 1);
    const linha = acervo.db.prepare('SELECT identificador_id AS id FROM etiquetas_de_participacao').get() as { id: string };
    assert.equal(linha.id, tel, 'prevalece a linha do CANONICO');
    assert.equal(conferirEtiquetasRepetidas(acervo), 0);
  } finally {
    c.limpar();
  }
});

test('desfazer devolve a linha fundida, inclusive a de texto VAZIO (a remocao que colide)', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    const conversa = umaColetiva(acervo);
    const lid = quem(acervo, LID);
    const tel = quem(acervo, TEL);
    registrarEtiqueta(acervo, evento(conversa, lid, '', 'EV-REMOCAO'));
    registrarEtiqueta(acervo, evento(conversa, tel, '', 'EV-REMOCAO'));
    aprenderCorrespondencia(acervo, { fonte: 'whatsapp', alternativo: LID, canonico: TEL });

    const r = resolverRetroativamente(acervo, { comEfeito: true });
    assert.equal(contar(acervo), 1);
    const d = desfazerOperacao(acervo, r.operacaoId as string);
    assert.equal(d.recusados.length, 0, `o desfazer recusou: ${JSON.stringify(d.recusados)}`);
    assert.equal(contar(acervo), 2, 'o desfazer nao repos a linha fundida');
    // O texto vazio sobrevive como VAZIO: a coluna e NOT NULL, e um NULL aqui
    // quebraria o INSERT de reposicao.
    const vazias = acervo.db
      .prepare("SELECT COUNT(*) AS n FROM etiquetas_de_participacao WHERE texto = ''")
      .get() as { n: number };
    assert.equal(vazias.n, 2);
  } finally {
    c.limpar();
  }
});
