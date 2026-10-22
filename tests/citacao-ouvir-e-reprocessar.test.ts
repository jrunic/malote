import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { instalacaoTemporaria } from './ajuda/instalacao.js';
import { GRUPO, LID_DE_OUTRO, LID_DA_CONTA, JID_DA_CONTA } from './ajuda/etiqueta-ao-vivo.js';
import { abrirRegistro, criarInquilino } from '../src/registro/registro.js';
import { resolverConfiguracao } from '../src/registro/configuracao-adaptador.js';
import { registrarEnderecosDoVinculo } from '../src/registro/endereco-da-conta.js';
import { abrirAcervo, abrirAcervoSomenteLeitura } from '../src/nucleo/acervo.js';
import { declararEnderecosDaConta } from '../src/nucleo/endereco-da-conta.js';
import { registrarConversa, registrarMensagem } from '../src/nucleo/escrita.js';
import { caminhosDaConta, ouvir } from '../src/cli/ouvir.js';
import { derramar } from '../src/cli/derrame.js';
import { executar } from '../src/cli/index.js';

// O endereco da propria conta chega a Citacao pelos caminhos que o Registro alimenta: o ouvinte ao vivo, o reprocessar do
// derrame e o comando do estoque. Cada um precisa de teste proprio: sao chamadores diferentes de uma mesma leitura.

function instalacao(): { raiz: string; id: string; limpar: () => void } {
  const { raiz, limpar } = instalacaoTemporaria();
  const registro = abrirRegistro(raiz);
  const id = criarInquilino(registro, { titularNome: 'Padme' });
  const cfg = resolverConfiguracao(registro, id, 'whatsapp', 'teste');
  registrarEnderecosDoVinculo(registro, cfg.id, { telefone: '5565911110099', jid: JID_DA_CONTA, lid: LID_DA_CONTA });
  registro.fechar();
  const acervo = abrirAcervo(join(raiz, 'acervos'), id);
  declararEnderecosDaConta(acervo, { fonte: 'whatsapp', canonico: JID_DA_CONTA, alternativo: LID_DA_CONTA });
  acervo.fechar();
  return { raiz, id, limpar };
}

function respostaAMinhaMensagem(id: string): unknown {
  return {
    key: { remoteJid: GRUPO, id, fromMe: false, participant: LID_DE_OUTRO },
    messageTimestamp: Math.floor(Date.parse('2026-10-01T10:00:00Z') / 1000),
    message: { extendedTextMessage: { text: 'sim', contextInfo: { stanzaId: 'ANTIGA-MINHA', participant: LID_DA_CONTA } } },
  };
}

function direcaoDaCitada(raiz: string, id: string, idExterno: string): string | null {
  const acervo = abrirAcervoSomenteLeitura(join(raiz, 'acervos'), id);
  try {
    return (acervo.preparar('SELECT citada_direcao AS d FROM mensagens WHERE id_externo = ?').get(idExterno) as { d: string | null }).d;
  } finally {
    acervo.fechar();
  }
}

test('o ouvinte ao vivo conhece a propria conta pelo Registro: a citada dela sai enviada', async () => {
  const { raiz, id, limpar } = instalacao();
  try {
    const caminhos = caminhosDaConta(raiz, 'viva');
    mkdirSync(caminhos.vinculo, { recursive: true });
    writeFileSync(join(caminhos.vinculo, 'creds.json'), '{}');
    const ouvintes = new Map<string, (dado: unknown) => void>();
    const biblioteca = {
      default: () => ({
        ev: { on: (fluxo: string, f: (dado: unknown) => void) => ouvintes.set(fluxo, f) },
        requestPairingCode: () => Promise.resolve('12345678'),
      }),
      useMultiFileAuthState: () => Promise.resolve({ state: {}, saveCreds: () => undefined }),
      DisconnectReason: { loggedOut: 401 },
    };
    const linhas: string[] = [];
    const codigo = await ouvir(['ouvir', '--inquilino', id, '--conta', 'viva', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      carregarBiblioteca: () => {
        setImmediate(() => {
          ouvintes.get('messages.upsert')?.({ type: 'notify', messages: [respostaAMinhaMensagem('V1')] });
          setImmediate(() =>
            ouvintes.get('connection.update')?.({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }),
          );
        });
        return Promise.resolve(biblioteca as never);
      },
    });
    assert.notEqual(codigo, undefined, linhas.join('\n'));
    assert.equal(direcaoDaCitada(raiz, id, 'V1'), 'enviada');
  } finally {
    limpar();
  }
});

test('ouvinte reprocessar (o derrame) conhece a propria conta pelo Registro', () => {
  const { raiz, id, limpar } = instalacao();
  try {
    derramar(caminhosDaConta(raiz, 'teste').derrame, [respostaAMinhaMensagem('D1')]);
    const linhas: string[] = [];
    const codigo = executar(['ouvinte', 'reprocessar', '--inquilino', id, '--conta', 'teste', '--configuracao', 'teste'], {
      dados: raiz,
      estado: raiz,
      escrever: (t: string) => linhas.push(t),
      ouvinteEscrevendo: () => false,
    });
    assert.equal(codigo, 0, linhas.join('\n'));
    assert.equal(direcaoDaCitada(raiz, id, 'D1'), 'enviada');
  } finally {
    limpar();
  }
});

function gravarRespostaNoGrupo(raiz: string, id: string, idExterno: string): void {
  const acervo = abrirAcervo(join(raiz, 'acervos'), id);
  try {
    const cv = registrarConversa(acervo, { fonte: 'whatsapp', idExterno: GRUPO, coletiva: true });
    registrarMensagem(acervo, {
      conversaId: cv, fonte: 'whatsapp', idExterno, ocorridaEm: Date.parse('2026-10-01T10:00:00Z'), agora: Date.parse('2026-10-21T10:00:00Z'),
      direcao: 'recebida', bruto: JSON.stringify(respostaAMinhaMensagem(idExterno)),
    });
  } finally {
    acervo.fechar();
  }
}

function estocar(raiz: string, id: string): void {
  const linhas: string[] = [];
  const codigo = executar(['citacao', 'extrair', '--inquilino', id, '--com-efeito', '--confirmo'], {
    dados: raiz,
    estado: raiz,
    escrever: (t: string) => linhas.push(t),
  });
  assert.equal(codigo, 0, linhas.join('\n'));
}

test('citacao extrair conhece a conta pelo Registro: com UMA conta, a citada da coletiva dela sai enviada', () => {
  const { raiz, id, limpar } = instalacao();
  try {
    gravarRespostaNoGrupo(raiz, id, 'E1');
    estocar(raiz, id);
    assert.equal(direcaoDaCitada(raiz, id, 'E1'), 'enviada');
  } finally {
    limpar();
  }
});

test('citacao extrair com DUAS contas: na coletiva nao ha como saber qual recebeu, e a direcao fica nula', () => {
  const { raiz, id, limpar } = instalacao();
  try {
    const registro = abrirRegistro(raiz);
    const outra = resolverConfiguracao(registro, id, 'whatsapp', 'outra');
    registrarEnderecosDoVinculo(registro, outra.id, { telefone: '5565911110088', jid: '5565911110088@s.whatsapp.net', lid: null });
    registro.fechar();
    gravarRespostaNoGrupo(raiz, id, 'E2');
    estocar(raiz, id);
    assert.equal(direcaoDaCitada(raiz, id, 'E2'), null);
  } finally {
    limpar();
  }
});
