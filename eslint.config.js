// Configuração de lint do malote. Comentários em pt-BR; identificadores de
// domínio também, conforme o GLOSSARIO.md.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `ignoreRestSiblings` cobre o padrao de OMITIR campo por desestruturacao
      // — `const { messages: _fora, ...resto } = linha` —, que e como o
      // Conteudo Bruto tira do bruto da Conversa o vetor de mensagens e do
      // bruto da Mensagem as colunas emprestadas do JOIN de midia. Sem ela o
      // lint reprova justamente a variavel que existe para ser descartada.
      // `varsIgnorePattern` cobre o DESCARTE em laco — `for (const _ of gerador)`,
      // que e como se consome um gerador sem reter o item. `argsIgnorePattern`
      // nao alcanca esse caso: ali `_` e VARIAVEL, nao argumento. Sem ela o lint
      // reprova a unica forma que prova que a leitura nao materializa nada.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
);
