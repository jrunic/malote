import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import { type Acervo } from '../src/nucleo/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import { registrarIdentificador } from '../src/nucleo/escrita.js';
import { gravarAvisosDeGrupo } from '../src/adaptadores/whatsapp/metadados-de-coletiva-ao-vivo.js';
import { eventoDeGrupo, GRUPO_DE_TESTE } from './ajuda/metadados-de-coletiva-ao-vivo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const AGORA = Date.parse('2026-10-14T12:00:00Z');
const OPCOES = { origemDaChegada: 'ao-vivo' as const, agora: AGORA, configuracao: CFG_WHATSAPP };
const SEM_NOVE = '556599991234@s.whatsapp.net';
const COM_NOVE = '5565999991234@s.whatsapp.net';

function comAcervo(corpo: (acervo: Acervo) => void): void {
  const c = cenario();
  try {
    corpo(c.novoInquilino('Teste').acervo);
  } finally {
    c.limpar();
  }
}

const alteradoPor = (acervo: Acervo): string[] =>
  (acervo.db.prepare('SELECT alterado_por AS a FROM metadados_de_coletiva').all() as Array<{ a: string }>).map((l) => l.a);

test('quem alterou o grupo, no EVENTO, na forma alternativa de um Identificador ja gravado, grava a forma gravada', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    receberEvento(
      acervo,
      [eventoDeGrupo({ id: 'EV1', tipo: 'GROUP_CHANGE_SUBJECT', parametros: ['Assunto um'], autor: COM_NOVE, ts: Math.floor(AGORA / 1000) })],
      OPCOES,
    );
    assert.deepEqual(alteradoPor(acervo), [SEM_NOVE]);
  });
});

test('quem alterou o grupo, no AVISO, na forma alternativa de um Identificador ja gravado, grava a forma gravada', () => {
  comAcervo((acervo) => {
    registrarIdentificador(acervo, { fonte: 'whatsapp', valor: SEM_NOVE });
    gravarAvisosDeGrupo(acervo, [{ grupo: GRUPO_DE_TESTE, assunto: 'Assunto um', autor: COM_NOVE, bruto: '{}' }], AGORA);
    assert.deepEqual(alteradoPor(acervo), [SEM_NOVE]);
  });
});
