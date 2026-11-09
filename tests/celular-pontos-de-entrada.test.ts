import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * A lista FECHADA de quem grava endereco (#1376): cada chamada de uma porta que grava Identificador, Conversa, correspondencia
 * ou o autor de um metadado de coletiva, por arquivo e por porta, em `src/` inteiro. Registrar sem passar pela resolucao do
 * celular cria a duplicata que a correspondencia existe para impedir. A guarda olha quem GRAVA, e nao quem chama
 * `resolverEndereco`: ponto que nao resolve nada passaria por esta ultima. Chamada nova, ou a mais num arquivo da lista,
 * reprova aqui e obriga a decidir se ela resolve o celular. As contagens de `instagram` e `contatos` estao na lista so porque a
 * guarda olha `src/` inteiro: uma mudanca fora do WhatsApp que mexa nelas apenas atualiza `CHAMADAS`, sem outra decisao.
 */
const PORTAS = [
  'registrarIdentificador',
  'registrarConversa',
  'aprenderCorrespondencia',
  'registrarMetadadosDeColetiva',
  'declararEnderecosDaConta',
] as const;

const CHAMADAS: Record<string, Record<string, number>> = {
  'src/adaptadores/contatos/importar.ts': { registrarIdentificador: 1 },
  'src/adaptadores/instagram/importar.ts': { registrarIdentificador: 2, registrarConversa: 1 },
  // `aprenderCorrespondencia: 2`: o par do autor da coletiva e o par do opaco da Conversa direta (#1439); os dois com o
  // telefone resolvido por `resolverEnderecoDeWhatsapp`, na mesma primeira passada.
  'src/adaptadores/whatsapp/ao-vivo.ts': { registrarIdentificador: 3, registrarConversa: 2, aprenderCorrespondencia: 2 },
  // O estoque do par da Conversa direta (#1439): o opaco aponta para o telefone JA resolvido por `resolverEnderecoDeWhatsapp`.
  'src/adaptadores/whatsapp/aprender-pares-da-conversa-direta.ts': { aprenderCorrespondencia: 1 },
  'src/adaptadores/whatsapp/citacao.ts': { registrarIdentificador: 1 },
  'src/adaptadores/whatsapp/declarar-conta.ts': { declararEnderecosDaConta: 1 },
  'src/adaptadores/whatsapp/enviar.ts': { registrarConversa: 1 },
  'src/adaptadores/whatsapp/estado-ao-vivo.ts': { registrarIdentificador: 1, aprenderCorrespondencia: 1 },
  'src/adaptadores/whatsapp/importar.ts': { registrarIdentificador: 3, registrarConversa: 1, aprenderCorrespondencia: 1 },
  'src/adaptadores/whatsapp/metadados-de-coletiva-ao-vivo.ts': { registrarConversa: 2, registrarMetadadosDeColetiva: 2 },
  'src/adaptadores/whatsapp/resolver-celular.ts': { aprenderCorrespondencia: 2 },
  'src/nucleo/endereco-da-conta.ts': { registrarIdentificador: 1, aprenderCorrespondencia: 1 },
  'src/nucleo/resolucao-retroativa.ts': { registrarIdentificador: 1 },
};

/** Quem grava e NAO passa pelo resolvedor do celular, e por que. Todo o resto de `src/adaptadores/whatsapp` TEM de passar. */
const SEM_RESOLVEDOR: Record<string, string> = {
  'src/adaptadores/contatos/importar.ts': 'outra Fonte (contatos do Google)',
  'src/adaptadores/instagram/importar.ts': 'outra Fonte (Instagram)',
  'src/adaptadores/whatsapp/resolver-celular.ts': 'e o proprio resolvedor',
  'src/nucleo/endereco-da-conta.ts': 'recebe o JID ja resolvido por `declararContaDeWhatsapp`, que o ouvinte usa',
  'src/nucleo/resolucao-retroativa.ts':
    'so grava o canonico de um par que ja existe: os pares novos nascem resolvidos, e nos quatro Acervos medidos em 03/11/2026 nenhum canonico antigo e a forma nao gravada; a consulta de cadeia do campo (Plano 4) vigia o resto',
};

const semComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function arquivosTs(pasta: string): string[] {
  return readdirSync(pasta, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) return arquivosTs(caminho);
    return e.name.endsWith('.ts') ? [caminho.split(sep).join('/')] : [];
  });
}

function chamadas(texto: string, porta: string): number {
  const chamadasDaPorta = texto.match(new RegExp(`(?<![\\w.])${porta}\\(`, 'g')) ?? [];
  const definicoes = texto.match(new RegExp(`function\\s+${porta}\\(`, 'g')) ?? [];
  return chamadasDaPorta.length - definicoes.length;
}

function mapaReal(): Record<string, Record<string, number>> {
  const mapa: Record<string, Record<string, number>> = {};
  for (const arquivo of arquivosTs('src')) {
    const texto = semComentarios(readFileSync(arquivo, 'utf8'));
    for (const porta of PORTAS) {
      const n = chamadas(texto, porta);
      if (n > 0) (mapa[arquivo] ??= {})[porta] = n;
    }
  }
  return mapa;
}

test('so as chamadas da lista gravam endereco em src/ (por arquivo e por porta)', () => {
  assert.deepEqual(mapaReal(), CHAMADAS);
});

const semImports = (texto: string): string => texto.replace(/import\s+(type\s+)?[\s\S]*?from\s+'[^']*';/g, '');

/** Referencias a uma porta que NAO sao chamada (alias por variavel, passar como valor); a definicao conta como chamada. */
function usosComoValor(texto: string, porta: string): number {
  return (semImports(texto).match(new RegExp(`(?<![\\w.])${porta}(?!\\s*\\()`, 'g')) ?? []).length;
}

test('nenhuma porta de gravacao e importada com outro nome, em namespace ou usada como valor', () => {
  for (const arquivo of arquivosTs('src')) {
    const texto = semComentarios(readFileSync(arquivo, 'utf8'));
    assert.ok(!/import\s+\*\s+as\s+\w+\s+from\s+'\./.test(texto), `${arquivo} importa um modulo relativo em namespace`);
    for (const porta of PORTAS) {
      assert.ok(!new RegExp(`\\b${porta}\\s+as\\s+\\w+`).test(texto), `${arquivo} importa ${porta} com outro nome`);
      assert.equal(usosComoValor(texto, porta), 0, `${arquivo} usa ${porta} como valor (alias ou argumento)`);
    }
  }
});

test('todo arquivo do Adaptador de WhatsApp que grava passa pela resolucao do celular', () => {
  for (const arquivo of Object.keys(CHAMADAS)) {
    if (arquivo in SEM_RESOLVEDOR || !arquivo.startsWith('src/adaptadores/whatsapp/')) continue;
    const texto = semComentarios(readFileSync(arquivo, 'utf8'));
    assert.ok(texto.includes("from './resolver-celular.js'"), `${arquivo} nao importa o resolvedor`);
    assert.ok(texto.includes('resolverEnderecoDeWhatsapp('), `${arquivo} importa e nao chama o resolvedor`);
  }
});

test('cada motivo de excecao ainda corresponde a um arquivo que grava', () => {
  for (const arquivo of Object.keys(SEM_RESOLVEDOR)) assert.ok(arquivo in CHAMADAS, `${arquivo} nao grava mais: tirar o motivo`);
});

test('a identidade da conta e declarada pelo adaptador, que resolve antes', () => {
  const adaptador = semComentarios(readFileSync('src/adaptadores/whatsapp/declarar-conta.ts', 'utf8'));
  assert.ok(adaptador.includes('resolverEnderecoDeWhatsapp('));
  const cli = semComentarios(readFileSync(join('src', 'cli', 'ouvir.ts'), 'utf8'));
  assert.ok(cli.includes('declararContaDeWhatsapp('), 'o ouvinte tem de declarar a conta pelo adaptador');
  assert.ok(!cli.includes('declararEnderecosDaConta('), 'o ouvinte nao pode chamar a declaracao do nucleo direto');
});

test('o detector ve a chamada, nao ve a so de comentario e nao conta a definicao', () => {
  assert.equal(chamadas(semComentarios('registrarIdentificador(acervo, x);'), 'registrarIdentificador'), 1);
  assert.equal(chamadas(semComentarios('// registrarIdentificador(acervo, x);'), 'registrarIdentificador'), 0);
  assert.equal(chamadas(semComentarios('/* registrarConversa(\n acervo) */'), 'registrarConversa'), 0);
  assert.equal(chamadas(semComentarios('export function registrarConversa(acervo: A) {}'), 'registrarConversa'), 0);
  assert.equal(chamadas(semComentarios('x.registrarConversa(acervo);'), 'registrarConversa'), 0);
});

test('o detector de uso como valor ve o alias por variavel e nao ve import, definicao nem chamada', () => {
  assert.equal(usosComoValor('const gravar = registrarConversa;', 'registrarConversa'), 1);
  assert.equal(usosComoValor('lista.map(registrarConversa);', 'registrarConversa'), 1);
  assert.equal(usosComoValor("import { registrarConversa } from './x.js';", 'registrarConversa'), 0);
  assert.equal(usosComoValor('export function registrarConversa(a: A) {}', 'registrarConversa'), 0);
  assert.equal(usosComoValor('registrarConversa(acervo, {});', 'registrarConversa'), 0);
});
