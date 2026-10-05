import { once } from 'node:events';
import { criarServidor } from '../../src/rede/servidor.js';
import type { InstrucaoDeTeste } from '../../src/rede/contrato-da-leitura.js';

/**
 * Um `malote servir` de TESTE, em PROCESSO SEPARADO do cliente do teste. Servidor e cliente no mesmo processo
 * fariam o mutante sincrono travar o proprio relogio do teste e passar. A instrucao do gancho vem de parametros da
 * query (`__dormir`, `__lancar`, `__lancardepois`, `__sair`); o `servir` de producao nunca define o gancho.
 *
 * Uso: node --import tsx tests/ajuda/servidor-de-teste-lento.ts <dados> [trabalhadores] [prazoMs] [filaMaxima]
 */
const [dados, trab, prazo, fila] = process.argv.slice(2);
const servidor = criarServidor({
  dados: dados as string,
  porta: 0,
  ...(trab ? { trabalhadores: Number(trab) } : {}),
  ...(prazo ? { prazoMs: Number(prazo) } : {}),
  ...(fila ? { filaMaxima: Number(fila) } : {}),
  ganchoDeTeste: {
    instrucaoDoTrabalhador: (url: string): InstrucaoDeTeste | undefined => {
      const q = new URL(url, 'http://interno').searchParams;
      const instrucao: InstrucaoDeTeste = {};
      if (q.has('__dormir')) instrucao.dormirMs = Number(q.get('__dormir'));
      if (q.has('__lancar')) instrucao.lancar = q.get('__lancar') as string;
      if (q.has('__lancardepois')) instrucao.lancarDepoisDoCabecalho = q.get('__lancardepois') as string;
      if (q.has('__sair')) instrucao.sair = true;
      return Object.keys(instrucao).length > 0 ? instrucao : undefined;
    },
  },
});
servidor.listen(0, '127.0.0.1');
await once(servidor, 'listening');
const { port } = servidor.address() as { port: number };
process.stdout.write(`PORTA ${port}\n`);
const parar = (): void => {
  servidor.closeIdleConnections();
  void servidor.pararLeituras(1000).then(() => {
    servidor.closeAllConnections();
    process.exit(0);
  });
};
process.once('SIGTERM', parar);
process.once('SIGINT', parar);
