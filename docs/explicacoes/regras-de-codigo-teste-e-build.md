---
id: 202610066618
projeto: malote
tipo: explicacao
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: Detalhe, motivo e medição das regras de código, teste e build que o CONTEXTO.md resume — carga sob demanda.
tags: [explicacao, invariantes, Node]
---

# Regras de código, teste e build

Regras e decisões do repo **com o motivo e a medição que as sustentam**, movidas do `CONTEXTO.md` para que a carga default da sessão fique pequena. Leia antes de mexer no assunto; o `CONTEXTO.md` aponta para cá e nomeia as regras mais perigosas.

- **Teste que abre servidor, socket ou timer fecha tudo num `finally`.** Uma asserção que falha antes do `close` deixa o recurso vivo e o processo de
  teste não termina: a suíte foi de ~50 s para mais de 10 minutos, sem saída (`tests/cli-modo-rede.test.ts`, 05/10/2026). O retorno antecipado do
  `ouvir` depois da recusa de identidade é guardado contando os timers ativos antes e depois, e não por prazo.
- **Nenhum `process.exit(` direto em `src/`: quem encerra o processo é `cli/encerrar.ts`, que espera o
  stdout e o stderr entregarem o que já foi escrito (#1125).** `process.exit` logo depois de um
  `console.log` perde o que o pipe ainda não aceitou: a escrita em pipe é assíncrona quando passa do
  buffer (64 KB, medido no macOS e no Linux, Node 22), e o resto morre com o processo. Arquivo e
  terminal escondem o defeito, por isso só o agente, que lê por pipe, via a resposta cortada — o
  relato da #1091 (`Unterminated string`) foi dado como não reproduzido por 5 dias porque a
  reprodução usou arquivo e `fetch` direto. O defeito só aparece quando **uma escrita** passa do
  buffer (o `--json` e todo o modo rede); a saída em texto, linha a linha, passa. O teto de 10 s de
  `encerrar` existe para o processo não pendurar com leitor que nunca esvazia o pipe: perder a
  cauda é melhor que não sair. `tests/sem-exit-direto.test.ts` varre `src/`, e
  `tests/saida-por-pipe.test.ts` roda o executável por pipe, nos dois modos. **A saída desses testes
  tem de passar de ~1 MB**: o stdio de um filho do Node é um socketpair, não `pipe(2)`, e o buffer de envio
  do Linux (~208 KB) engolia os 170 KB da primeira versão — o teste do teto saiu em 0,35 s na CI em 1 de 2
  execuções do mesmo commit, e os outros dois teriam passado mesmo com o defeito. Medido no Linux com o
  `process.exit` direto: a saída para em 146–182 KB.
- **SQL se compila pela porta `preparar`, nunca por `db.prepare` direto.** `Acervo`, `Registro`
  e `AlvoDeTrilha` expõem `preparar`, que compila uma vez por conexão e reusa. Compilar por
  chamada vaza memória que a coleta de lixo **não alcança**: um `sqlite3_stmt` vive fora do
  heap do V8 e o `better-sqlite3` mantém cada statement referenciado na conexão para
  finalizá-lo no `close()`. Medido em 07/09/2026: **~3,8 KB de RSS por compilação**, com o
  `heapUsed` imóvel — o que faz o defeito não parecer problema de memória. Na importação eram
  4 statements por Mensagem; na conversão do acervo, 7,28 — **26 KB por Mensagem**, e um
  processo morto pelo OOM killer com 6,58 GB. A varredura canônica é
  `tests/sem-prepare-fora-da-porta.test.ts`, com o padrão tolerante a quebra de linha e a
  lista de exceções justificada uma a uma. **Quem introduzir `iterate`, `pluck`, `raw`,
  `expand` ou `bind` precisa de statement próprio** — os cinco guardam estado no statement, e
  a segunda chamada herdaria o da primeira.
- **Só `src/nucleo/` e `src/registro/` tocam em tabela.** Adaptador e CLI usam as portas; precisando de leitura que não existe, a porta nasce no núcleo — não um `db.prepare` no chamador. Tem histórico: a dívida foi paga em duas etapas (ciclos 4 e 13) e **voltou no meio**, porque o ciclo 9 escreveu um `SELECT 1 FROM conversas` na CLI depois de a classe ter sido declarada quitada nos adaptadores. A varredura é `perl -0ne 'while (/(\\w+)\\.db\\s*\\n?\\s*\\.prepare/g) { print "$ARGV\\n" }' $(find src -name '*.ts' -not -path 'src/nucleo/*' -not -path 'src/registro/*')`, e o esperado é vazio. **Ela atravessa quebra de linha de propósito, e a versão anterior não atravessava** — `grep '\.db\.prepare'` casa numa linha só, e o formatador quebra a cadeia em `acervo.db` / `.prepare(...)` quando ela passa da largura máxima. Medido em 01/09/2026: uma violação real, escrita no ciclo 14, passou invisível pela varredura antiga
- **Adaptador preserva o registro original INTEIRO, e não escolhe colunas.** Mensagem, Conversa, Participação e Anexo têm `bruto`; quem lê a Fonte grava a linha como ela veio (`SELECT *`, BLOB em base64, nulo omitido). Enumerar colunas é decidir hoje o que será útil depois — e foi assim que o produto anterior ficou com 1.007.822 mensagens de payload nulo, irrecuperáveis. Exceção declarada: participante de Conversa **direta** é derivado e não tem linha de roster, então nasce sem `bruto`
- **O DDL de um passo de migração é fotografia congelada, e nunca importa do schema fresco.** Parece duplicação e não é: quando um passo futuro alterar a tabela que outro criou, o antigo tem de continuar criando a forma de **então**, senão a cadeia deixa de reconstruir a história. Quem mantém a duplicação honesta é `tests/equivalencia-de-forma.test.ts` — base migrada por passos contra base criada do zero, comparadas por **estrutura** (`table_info`, `index_list`, `foreign_key_list`, gatilhos), nunca pelo texto de `sqlite_master.sql`, que difere por cosmética. **A base do piso também é fotografia congelada** (`tests/ajuda/{acervo,registro}-no-piso.ts`, extraídas do commit de linha de base): fabricá-la derivando do schema corrente contamina os dois lados da comparação, e foi medido em 01/09/2026 que o teste passa com o defeito presente. Ao acrescentar tabela ou coluna ao schema, escrever o passo junto — sem ele o teste de equivalência reprova, e é essa a intenção
- **Endereço se grava na forma CANÔNICA, sempre — resolvido antes de escrever.** Uma Fonte pode entregar o mesmo destinatário em mais de uma forma. A canônica é a que o material exportado grava, e é a que o catálogo e as Pessoas usam; a outra se traduz por `resolverEndereco` **antes** de virar `id_externo` de Conversa ou `valor` de Identificador. Gravar a forma alternativa cria uma segunda identidade para quem já está no acervo — medido em 02/09/2026: 18.653 Identificadores e 241 Conversas nasceram assim. A ordem não é livre: quem aprende correspondência tem de aprendê-la **antes** do laço que escreve endereço. E o valor é o endereço **inteiro**, com o separador — 5.027 dos 5.171 Identificadores do acervo real guardam assim, e cortar em dígitos reintroduz a duplicação pelo formato.
- **`tsx` é dependência de RUNTIME, e não de desenvolvimento — não mover de volta.** O produto roda **da fonte** no host, sem passo de build: `node --import tsx src/cli/index.ts`. Medido em 03/09/2026, contra o `package-lock.json` real: `npm ci --omit=dev` — que é como uma instalação de produção faz — remove `tsx` **e** `typescript`, e aí `npm run build` sai **127** com `tsc: command not found`; o host fica com um repositório que não sabe se executar, porque `dist/` é ignorado pelo git e não vem no pull. Salvar o caminho do build exigiria a árvore completa no host: **143 pacotes contra 85**, 68% a mais de superfície, dentro da própria política que existe para reduzi-la. Com `tsx` em `dependencies` a árvore de produção fica em **85** e a invocação foi verificada de ponta a ponta. Efeito colateral aceito e nomeado: sem build no host, nada lá verifica que o código compila — o portão do compilador é o `npm test` desta máquina, que roda `tsc` antes da suíte, e `production` só recebe o que passou por ele.
- **Nenhum módulo de `src/nucleo` ou `src/registro` importa `src/adaptadores`.** Medido em 12/09/2026: zero ocorrências. Quem compõe adaptador de mais de uma Fonte é `src/cli/` — `ouvir.ts` e `varredura.ts`. **A guarda existe** em `tests/fronteira-de-dependencia.test.ts` desde a #889, e tem poder provado com violação reintroduzida — inclusive na forma **dinâmica**, `import('...')`, que uma guarda escrita só para `from` deixaria passar. A proteção anti-vacuidade que decide usa `src/cli` como oráculo: se o detector não achar os imports que existem lá, ele não acha nada, e um padrão quebrado devolveria zero violações por não ver nada.
