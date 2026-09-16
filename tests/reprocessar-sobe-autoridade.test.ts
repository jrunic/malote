import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { nomesDoIdentificador } from '../src/nucleo/identidade.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-13T12:00:00Z');

/**
 * O PLANO 1 verificou a subida monotona pela PORTA; a Acao Documentada da
 * adocao invoca o IMPORTADOR. Sao caminhos diferentes, e e o segundo que a
 * resolucao das linhas anteriores ao ciclo 18 depende — se reimportar nao
 * chegasse a chamar a porta, o veiculo nao existiria e ninguem notaria.
 */
test('reprocessar sobe a Autoridade de uma linha indeterminada, pelo importador', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const b = backupFalso({
      conversas: [
        { pk: 1, endereco: '5565911110099@s.whatsapp.net', nome: 'Ana Prado', tipoDeSessao: 0 },
      ],
      mensagens: [
        {
          stanzaId: 'm1',
          chatSessionPk: 1,
          texto: 'ola',
          dataCoreData: paraCoreData('2021-06-15T10:00:00Z'),
        },
      ],
    });
    try {
      importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      const ident = acervo.db
        .prepare('SELECT id FROM identificadores WHERE valor = ?')
        .get('5565911110099@s.whatsapp.net') as { id: string };

      // Rebaixa a linha ao estado das anteriores ao ciclo 18: gravadas quando
      // nao havia campo. WHERE por Identificador, para nao atingir o resto.
      acervo.db
        .prepare('UPDATE atribuicoes_de_nome SET autoridade = NULL WHERE identificador_id = ?')
        .run(ident.id);
      assert.equal(nomesDoIdentificador(acervo, ident.id)[0]?.autoridade, null, 'partida');

      // SEM reprocessar o Material ja entrou, entao a passagem e PULADA — e sem
      // esta metade o teste nao distinguiria "subiu por reprocessar" de "subiria
      // de qualquer jeito".
      const r1 = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      assert.equal(r1.jaRegistrado, true, 'sem reprocessar, a passagem e pulada');
      assert.equal(
        nomesDoIdentificador(acervo, ident.id)[0]?.autoridade,
        null,
        'e nada muda',
      );

      const r2 = importarMaterial(acervo, b.raiz, {
        agora: AGORA,
        configuracao: CFG_WHATSAPP,
        reprocessar: true,
      });
      assert.equal(r2.jaRegistrado, false, 'com reprocessar, percorre de novo');

      const depois = nomesDoIdentificador(acervo, ident.id);
      assert.equal(depois.length, 1, 'atualiza a linha, nao cria gemea');
      assert.equal(depois[0]?.autoridade, 'titular', 'a subida acontece de ponta a ponta');
    } finally {
      b.limpar();
    }
  } finally {
    c.limpar();
  }
});
