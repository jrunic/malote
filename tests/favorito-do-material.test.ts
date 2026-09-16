import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { backupFalso, paraCoreData } from './ajuda/material-falso.js';
import { importarMaterial } from '../src/adaptadores/whatsapp/importar.js';
import { mensagensMarcadas } from '../src/nucleo/marca-do-titular.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-09-13T12:00:00Z');

function materialCom(favoritas: readonly string[]) {
  return backupFalso({
    conversas: [
      { pk: 1, endereco: '5565911110001@s.whatsapp.net', nome: 'Ana Prado', tipoDeSessao: 0 },
    ],
    mensagens: ['m1', 'm2', 'm3'].map((id) => ({
      stanzaId: id,
      chatSessionPk: 1,
      texto: `mensagem ${id}`,
      dataCoreData: paraCoreData('2021-06-15T10:00:00Z'),
      ...(favoritas.includes(id) ? { favorita: true } : {}),
    })),
  });
}

test('mensagem favorita no material vira Marca do Titular; as outras NAO', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');
    const b = materialCom(['m2']);
    try {
      const r = importarMaterial(acervo, b.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      assert.equal(r.favoritos, 1, 'o relatorio tem de contar a marca');

      const marcadas = mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id });
      assert.equal(marcadas.length, 1, '3 Mensagens, 1 favorita');

      // E e a CERTA: contar 1 passaria se o codigo marcasse a primeira sempre.
      const externa = acervo.db
        .prepare('SELECT id_externo FROM mensagens WHERE id = ?')
        .get(marcadas[0]) as { id_externo: string };
      assert.equal(externa.id_externo, 'm2');
    } finally {
      b.limpar();
    }
  } finally {
    c.limpar();
  }
});

/**
 * O teste que PRODUCAO exige, e que o de cima nao cobre.
 *
 * Producao ja tem todas as Mensagens do material — mais de 1,2 milhao. Se a
 * marca vivesse num ramo que so roda para Mensagem NOVA, a reimportacao
 * marcaria zero, e a release publicaria o defeito. Mesma familia do `??` que a
 * v0.13.0 pagou: verde no material fresco, producao reprova.
 */
test('reimportar marca favorito em Mensagem que JA EXISTIA', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Titular');

    // 1a passada: SEM favorito nenhum. As Mensagens nascem aqui.
    const antes = materialCom([]);
    try {
      importarMaterial(acervo, antes.raiz, { agora: AGORA, configuracao: CFG_WHATSAPP });
      assert.deepEqual(mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id }), []);
    } finally {
      antes.limpar();
    }

    // 2a passada: o Titular favoritou m3 no aparelho, e o material novo traz.
    // Nenhuma Mensagem nova e criada — e a marca tem de entrar assim mesmo.
    const depois = materialCom(['m3']);
    try {
      const r = importarMaterial(acervo, depois.raiz, {
        agora: AGORA,
        configuracao: CFG_WHATSAPP,
        reprocessar: true,
      });
      // Parte da ASSERCAO, nao cenario: sem isto o teste passaria por acidente
      // num caminho que criou Mensagem nova — que e o que producao nao toma.
      assert.equal(r.mensagensCriadas, 0, 'nenhuma Mensagem podia nascer na 2a passada');
      assert.equal(r.mensagensJaExistentes, 3);
      assert.equal(r.favoritos, 1);
      assert.equal(mensagensMarcadas(acervo, { marca: 'favorito', configuracaoId: CFG_WHATSAPP.id }).length, 1);
    } finally {
      depois.limpar();
    }
  } finally {
    c.limpar();
  }
});
