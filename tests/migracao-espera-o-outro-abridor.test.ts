import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { cenario } from './ajuda/acervo.js';
import { abrirAcervo } from '../src/nucleo/acervo.js';
import { CFG_WHATSAPP } from './ajuda/configuracao.js';

// #1523: na subida de uma release que migra o Acervo, as unidades abrem o mesmo arquivo juntas. A que perde a corrida pelo
// lock esperava so o `busy_timeout` de 5 s e morria com SQLITE_BUSY, contra os 13 a 16 s da migracao do Acervo do Titular
// (ensaio de 16/11/2026). Quem precisa migrar espera mais; o outro abridor, ao pegar o lock, ve a versao nova e segue.

test('quem abre um Acervo de forma anterior espera mais de 5 s o outro abridor migrar, em vez de morrer com banco ocupado', async () => {
  const c = cenario();
  try {
    const { id, acervo } = c.novoInquilino('Teste');
    acervo.db.exec('DROP INDEX idx_mensagens_citada_autor');
    acervo.db.prepare('UPDATE versao_schema SET versao = 32').run();
    const caminho = acervo.caminho;
    acervo.fechar();

    // O "outro abridor" e OUTRO processo (o better-sqlite3 e sincrono: no mesmo processo ele nao soltaria o lock).
    const segura = spawn(
      process.execPath,
      [
        '-e',
        `const D=require('better-sqlite3');const d=new D(process.argv[1]);d.exec('BEGIN IMMEDIATE');` +
          `console.log('preso');setTimeout(()=>{d.exec('ROLLBACK');d.close()},6500)`,
        caminho,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      await new Promise<void>((ok) => segura.stdout.once('data', () => ok()));
      const inicio = Date.now();
      const migrado = abrirAcervo(join(c.raiz, 'acervos'), id, { configuracoes: [CFG_WHATSAPP] });
      try {
        assert.ok(Date.now() - inicio >= 5000, 'esperou o lock ser solto');
        assert.equal((migrado.db.prepare('SELECT versao FROM versao_schema').get() as { versao: number }).versao, 33);
      } finally {
        migrado.fechar();
      }
    } finally {
      segura.kill();
    }
  } finally {
    c.limpar();
  }
});
