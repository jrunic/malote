import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario, type Cenario } from './ajuda/acervo.js';
import { RemotoEmMemoria } from './ajuda/remoto-em-memoria.js';
import { configurarDestinoDeMidia } from '../src/registro/destino-midia.js';
import { PADROES_DO_DESTINO_REMOTO, configurarDestinoRemotoDeMidia } from '../src/registro/destino-remoto.js';
import { listarAnexosPresentes } from '../src/nucleo/anexos-presentes.js';
import { passadaDeEnvio, type DependenciasDoServico } from '../src/cli/servico-de-armazenamento.js';
import { consultarLocalizacoes } from '../src/cli/localizacoes-de-anexos.js';
import { iniciarServidorDoServico } from '../src/cli/servidor-do-servico.js';
import { criarConsultorDeLocalizacoes } from '../src/cli/cliente-do-armazenamento.js';

function montar(c: Cenario, comRemoto = true) {
  const { id, acervo, destino } = c.inquilinoComArquivos();
  configurarDestinoDeMidia(c.registro, id, { natureza: 'local', endereco: destino });
  if (comRemoto) configurarDestinoRemotoDeMidia(c.registro, id, { remoto: 'remoto_de_teste', ...PADROES_DO_DESTINO_REMOTO });
  let n = 0;
  const base = Date.now() + 11 * 60 * 1000;
  const dep: DependenciasDoServico = {
    dados: c.raiz, estado: c.raiz, remoto: new RemotoEmMemoria(), agora: () => base + 1_000 * n++, dormir: () => Promise.resolve(), escrever: () => {},
  };
  return { id, dep, ids: listarAnexosPresentes(acervo, { limite: 10 }).map((a) => a.id) };
}

test('devolve o id no remoto e se a copia local saiu, so dos Anexos que tem Localizacao do remoto de agora', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    await passadaDeEnvio(m.dep, m.id);
    const r = consultarLocalizacoes(m.dep, m.id, [...m.ids, 'anexo-que-nao-existe']);
    assert.equal(r.tipo, 'localizacoes');
    assert.ok(r.tipo === 'localizacoes');
    assert.deepEqual(Object.keys(r.porAnexo).sort(), [...m.ids].sort());
    for (const l of Object.values(r.porAnexo)) {
      assert.match(l.idNoRemoto ?? '', /^id-\d+$/, 'o remoto em memoria da o id');
      assert.equal(l.copiaLocalRemovida, false);
    }
    // outro remoto declarado: a Localizacao antiga nao serve de link
    configurarDestinoRemotoDeMidia(c.registro, m.id, { remoto: 'outro_remoto', ...PADROES_DO_DESTINO_REMOTO });
    assert.deepEqual(consultarLocalizacoes(m.dep, m.id, m.ids), { tipo: 'localizacoes', porAnexo: {} });
  } finally {
    c.limpar();
  }
});

test('sem Destino Remoto ou sem base devolve vazio; lista grande ou identificador invalido e recusado', () => {
  const c = cenario();
  try {
    const m = montar(c, false);
    assert.deepEqual(consultarLocalizacoes(m.dep, m.id, m.ids), { tipo: 'localizacoes', porAnexo: {} });
    const comRemoto = cenario();
    try {
      const n = montar(comRemoto);
      assert.deepEqual(consultarLocalizacoes(n.dep, n.id, n.ids), { tipo: 'localizacoes', porAnexo: {} }, 'ainda nao enviou: sem base');
      assert.equal(consultarLocalizacoes(n.dep, n.id, Array.from({ length: 501 }, (_, i) => `a${i}`)).tipo, 'invalida');
      assert.equal(consultarLocalizacoes(n.dep, n.id, ['../../x']).tipo, 'invalida');
    } finally {
      comRemoto.limpar();
    }
  } finally {
    c.limpar();
  }
});

test('pelo soquete: o POST devolve as Localizacoes; corpo ruim e 400; Servico fora do ar e "servico-fora"', async () => {
  const c = cenario();
  try {
    const m = montar(c);
    await passadaDeEnvio(m.dep, m.id);
    const consultar = criarConsultorDeLocalizacoes(c.raiz);
    assert.deepEqual(await consultar({ inquilinoId: m.id, anexoIds: m.ids, prazoMs: 2_000 }), { tipo: 'servico-fora' }, 'antes de subir');
    const servidor = await iniciarServidorDoServico(m.dep);
    try {
      const r = await consultar({ inquilinoId: m.id, anexoIds: m.ids, prazoMs: 5_000 });
      assert.ok(r.tipo === 'localizacoes');
      assert.deepEqual(Object.keys(r.porAnexo).sort(), [...m.ids].sort());
      const ruim = await consultar({ inquilinoId: m.id, anexoIds: ['../../x'], prazoMs: 5_000 });
      assert.equal(ruim.tipo, 'inacessivel');
      const grande = await consultar({ inquilinoId: m.id, anexoIds: Array.from({ length: 501 }, (_, i) => `a${i}`), prazoMs: 5_000 });
      assert.equal(grande.tipo, 'inacessivel');
    } finally {
      await servidor.fechar();
    }
  } finally {
    c.limpar();
  }
});
