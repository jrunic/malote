import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { listarOperacoesCruas } from '../src/nucleo/trilha.js';
import { declararContaDeWhatsapp } from '../src/adaptadores/whatsapp/declarar-conta.js';

const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';
const LID = '100000000000001@lid';

test('a identidade da conta, com o JID na forma alternativa de um Identificador gravado, nao cria outro nem monta cadeia', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });

    declararContaDeWhatsapp(acervo, { jid: COM_NOVE, lid: LID });

    const pares = acervo.db
      .prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco ORDER BY alternativo')
      .all();
    assert.deepEqual(pares, [
      { alternativo: LID, canonico: SEM_NOVE },
      { alternativo: COM_NOVE, canonico: SEM_NOVE },
    ]);
    const n = acervo.db.prepare('SELECT COUNT(*) AS n FROM identificadores WHERE valor IN (?, ?)').get(SEM_NOVE, COM_NOVE) as { n: number };
    assert.equal(n.n, 1);
  } finally {
    c.limpar();
  }
});

test('conta sem LID: so o JID e resolvido, e nenhum par LID nasce', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    declararContaDeWhatsapp(acervo, { jid: COM_NOVE, lid: null });
    const pares = acervo.db.prepare('SELECT alternativo, canonico FROM correspondencias_de_endereco').all();
    assert.deepEqual(pares, [{ alternativo: SEM_NOVE, canonico: COM_NOVE }]);
  } finally {
    c.limpar();
  }
});

test('a segunda declaracao da conta (a reconexao) nao escreve nada: nenhuma Operacao nova, nenhum par novo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Teste');
    declararContaDeWhatsapp(acervo, { jid: COM_NOVE, lid: LID });
    const operacoes = listarOperacoesCruas(acervo).length;
    const pares = (acervo.db.prepare('SELECT COUNT(*) AS n FROM correspondencias_de_endereco').get() as { n: number }).n;

    declararContaDeWhatsapp(acervo, { jid: COM_NOVE, lid: LID });
    declararContaDeWhatsapp(acervo, { jid: SEM_NOVE, lid: LID });

    assert.equal(listarOperacoesCruas(acervo).length, operacoes);
    assert.equal((acervo.db.prepare('SELECT COUNT(*) AS n FROM correspondencias_de_endereco').get() as { n: number }).n, pares);
  } finally {
    c.limpar();
  }
});
