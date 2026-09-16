import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cenario } from './ajuda/acervo.js';
import type { Acervo } from '../src/nucleo/acervo.js';
import { receberEvento } from '../src/adaptadores/whatsapp/ao-vivo.js';
import {
  mensagemDireta,
  mensagemColetivaComPar,
  mensagemColetivaSemPar,
  mensagemComMidia,
  mensagemEnviada,
  eventoDeProtocolo,
  ENDERECOS,
} from './ajuda/evento-ao-vivo.js';
import { registrarConversa } from '../src/nucleo/escrita.js';
import { aprenderCorrespondencia, resolverEndereco } from '../src/nucleo/correspondencia.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

const QUANDO = Math.floor(Date.UTC(2026, 8, 2) / 1000);
const OPCOES = { agora: Date.UTC(2026, 8, 2, 12), configuracao: CFG_WHATSAPP };

function contar(acervo: Acervo, tabela: string): number {
  return (acervo.db.prepare(`SELECT COUNT(*) AS n FROM "${tabela}"`).get() as { n: number }).n;
}

test('mensagem direta vira Conversa e Mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Leia Organa');
    const r = receberEvento(acervo, [mensagemDireta('AAAA1111BBBB2222CCCC', QUANDO)], OPCOES);
    assert.equal(r.gravados, 1);
    assert.equal(contar(acervo, 'conversas'), 1);
    assert.equal(contar(acervo, 'mensagens'), 1);
  } finally {
    c.limpar();
  }
});

test('o MESMO evento duas vezes nao duplica nada', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Han Solo');
    const m = mensagemDireta('AAAA1111BBBB2222CCCC', QUANDO);
    receberEvento(acervo, [m], OPCOES);
    receberEvento(acervo, [m], OPCOES);
    // Nao e cenario imaginado: 288 mensagens chegaram em 282 identificadores
    // distintos numa janela de 11 horas.
    assert.equal(contar(acervo, 'mensagens'), 1);
    assert.equal(contar(acervo, 'conversas'), 1);
  } finally {
    c.limpar();
  }
});

test('coletiva com par aprende a correspondencia e grava o CANONICO', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Chewbacca');
    receberEvento(acervo, [mensagemColetivaComPar('DDDD3333EEEE4444FFFF', QUANDO)], OPCOES);

    assert.equal(resolverEndereco(acervo, 'whatsapp', ENDERECOS.NOVA_FORMA), ENDERECOS.OUTRO);

    // O Identificador e o endereco CANONICO INTEIRO, nunca a forma nova e
    // nunca so os digitos. Medido em 02/09/2026: 5.027 dos 5.171
    // Identificadores do acervo guardam o endereco completo, e 53,7% dos
    // enderecos vistos ao vivo ja existiam la por essa forma.
    const valores = (
      acervo.db.prepare("SELECT valor FROM identificadores WHERE fonte = 'whatsapp'").all() as {
        valor: string;
      }[]
    ).map((v) => v.valor);
    assert.ok(valores.includes(ENDERECOS.OUTRO), 'o endereço canônico inteiro entrou');
    assert.ok(!valores.some((v) => v.includes('@lid')), 'a forma nova NÃO entrou');
    assert.ok(!valores.includes('5565911110002'), 'não entrou cortado');
  } finally {
    c.limpar();
  }
});

test('coletiva SEM par nao inventa traducao', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Lando');
    receberEvento(acervo, [mensagemColetivaSemPar('GGGG5555HHHH6666IIII', QUANDO)], OPCOES);
    // 6 de 370. Sem o par, a forma nova entra como está — lacuna declarada,
    // não erro, e nunca uma tradução adivinhada.
    assert.equal(contar(acervo, 'correspondencias_de_endereco'), 0);
    assert.equal(contar(acervo, 'mensagens'), 1);
  } finally {
    c.limpar();
  }
});

test('Conversa na forma nova encontra a que a importacao criou', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Padme');
    // A importação já criou a Conversa pelo endereço canônico.
    registrarConversa(acervo, {
      fonte: 'whatsapp',
      idExterno: ENDERECOS.TELEFONE,
      coletiva: false, configuracao: CFG_WHATSAPP,
    });
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: ENDERECOS.NOVA_FORMA,
      canonico: ENDERECOS.TELEFONE,
    });
    assert.equal(contar(acervo, 'conversas'), 1);

    // Agora a MESMA Conversa chega na forma nova.
    const evento = mensagemDireta('MMMM9999NNNN0000OOOO', QUANDO);
    evento.key.remoteJid = ENDERECOS.NOVA_FORMA;
    receberEvento(acervo, [evento], OPCOES);

    // Se a tradução não acontecesse, nasceria uma segunda Conversa.
    assert.equal(contar(acervo, 'conversas'), 1, 'não duplicou');
  } finally {
    c.limpar();
  }
});

test('midia nasce nunca-obtido, com o bruto preservado', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Bail');
    receberEvento(acervo, [mensagemComMidia('PPPP1111QQQQ2222RRRR', QUANDO)], OPCOES);
    const a = acervo.db.prepare('SELECT presenca, bruto FROM anexos').get() as
      | { presenca: string; bruto: string | null }
      | undefined;
    assert.ok(a, 'o Anexo nasceu');
    assert.equal(a.presenca, 'nunca-obtido');
    assert.ok(a.bruto !== null && a.bruto.length > 0, 'o Conteúdo Bruto foi preservado');
  } finally {
    c.limpar();
  }
});

test('ruido de protocolo NAO vira Mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Obi-Wan');
    const r = receberEvento(acervo, [eventoDeProtocolo('SSSS3333TTTT4444UUUU', QUANDO)], OPCOES);
    // 42 de 288 na captura real. O backup NUNCA os terá, e gravá-los criaria
    // Mensagens que nenhum outro caminho produz — divergência fabricada pelo
    // próprio adaptador.
    assert.equal(contar(acervo, 'mensagens'), 0);
    assert.equal(r.gravados, 0);
    assert.equal(r.ignorados['protocolMessage'], 1, 'ignorado é contado, não silencioso');
  } finally {
    c.limpar();
  }
});

test('uma Operacao por evento, e nao uma por escrita', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Yoda');
    receberEvento(acervo, [mensagemDireta('VVVV5555WWWW6666XXXX', QUANDO)], OPCOES);
    const ops = acervo.db
      .prepare("SELECT COUNT(*) AS n FROM operacoes WHERE natureza = 'receber-ao-vivo'")
      .get() as { n: number };
    // `registrarNome` abre Operação por conta própria, INCONDICIONALMENTE —
    // medido em 01/09/2026. Sem o envelope, um ouvinte que roda por meses gera
    // uma Operação por nome visto. A reentrância junta tudo numa só.
    assert.equal(ops.n, 1);
    assert.equal(contar(acervo, 'linhas_de_efeito'), 0, 'efeito desligado: recepção é ingestão');
  } finally {
    c.limpar();
  }
});

test('instante implausivel e DESCARTADO com contagem, e o evento seguinte entra', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Ahsoka');
    const torto = mensagemDireta('YYYY7777ZZZZ8888AAAA', 0);
    const bom = mensagemDireta('BBBB9999CCCC0000DDDD', QUANDO);
    const r = receberEvento(acervo, [torto, bom], OPCOES);
    // Sem catch por evento, o primeiro derrubaria o lote e o segundo se
    // perderia. Descartar com contagem é o destino que a #606 fixou.
    assert.equal(r.recusados.length, 1);
    assert.equal(r.recusados[0]?.idExterno, 'YYYY7777ZZZZ8888AAAA');
    assert.equal(contar(acervo, 'mensagens'), 1, 'o evento seguinte entrou');
  } finally {
    c.limpar();
  }
});

test('conflito de correspondencia NAO perde a mensagem', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Mace');
    // A forma nova já aponta para outro endereço.
    aprenderCorrespondencia(acervo, {
      fonte: 'whatsapp',
      alternativo: ENDERECOS.NOVA_FORMA,
      canonico: ENDERECOS.TELEFONE,
    });
    const r = receberEvento(acervo, [mensagemColetivaComPar('EEEE1111FFFF2222GGGG', QUANDO)], OPCOES);
    // O conflito é achado, não motivo para perder o que chegou.
    assert.equal(r.conflitos.length, 1);
    assert.equal(contar(acervo, 'mensagens'), 1, 'a Mensagem entrou assim mesmo');
    assert.equal(
      resolverEndereco(acervo, 'whatsapp', ENDERECOS.NOVA_FORMA),
      ENDERECOS.TELEFONE,
      'a primeira correspondência permanece',
    );
  } finally {
    c.limpar();
  }
});

test('mensagem enviada pelo Titular nao inventa autor externo', () => {
  const c = cenario();
  try {
    const { acervo } = c.novoInquilino('Qui-Gon');
    receberEvento(acervo, [mensagemEnviada('HHHH3333IIII4444JJJJ', QUANDO)], OPCOES);
    const m = acervo.db.prepare('SELECT autor_id FROM mensagens').get() as {
      autor_id: string | null;
    };
    // O endereço da Conversa é o do OUTRO lado; usá-lo como autor de uma
    // enviada diria que o outro escreveu o que o Titular escreveu.
    assert.equal(m.autor_id, null);
  } finally {
    c.limpar();
  }
});
