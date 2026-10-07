---
id: 202610067004
projeto: malote
tipo: explicacao
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: Regras do modo rede, do servidor de leitura, da busca e da exportação, com motivo e medição — carga sob demanda.
tags: [explicacao, invariantes, Node]
---

# Invariantes da rede e do servidor

Regras e decisões do repo **com o motivo e a medição que as sustentam**, movidas do `CONTEXTO.md` para que a carga default da sessão fique pequena. Leia antes de mexer no assunto; o `CONTEXTO.md` aponta para cá e nomeia as regras mais perigosas.

- **`participantes` faz UMA consulta de etiquetas por Conversa, e a leitura da vigente é por janela (`ROW_NUMBER`), nunca por membro.** Há teste com espião em `preparar` (30 membros, 1 pedido). A etiqueta herda o `em` do próprio comando e **não** muda o conjunto de membros nem a regra de Alcance. O desempate de instantes iguais é pela identidade do evento (a plataforma declara o instante em segundos). Medido em produção antes de implementar: `participantes` na maior Conversa coletiva (275 mil Mensagens) levou 0,77 a 1,12 s por consulta, dispersão maior que o teto de +10% que a spec pedia; o teto não é verificável por relógio e a estrutura é a garantia.
- **`identificar` parte do Identificador gravado e lista as formas da correspondência à parte; nome em
  lote, nunca por linha (#1126).** O Acervo grava o endereço na forma canônica e guarda a alternativa só
  como correspondência (valor contra valor, sem id); parte das alternativas existe também como linha, por
  herança — por isso a resposta tem duas listas e a forma sem linha leva `identificador: null`. O nome
  corrente de um conjunto (a listagem de Conversas, os participantes) sai de **uma consulta** com a
  precedência aplicada em memória (`nomesEmLote`): o handler do servidor é síncrono, e a listagem sem filtro
  já faz uma contagem correlacionada por linha sobre ~1,4 M Mensagens. O Identificador do outro lado da
  Conversa direta vem de um `LEFT JOIN` pela chave única `(fonte, valor)`, nunca de chave montada em JS.
  Baseline medida em produção (04/10/2026) para o aceite: `conversas` sem filtro **0,62 a 2,12 s e
  1.407.993 bytes**; teto com os campos novos: 3 s e 2,0 MB.
- **Listar Anexos e exportar Conversa seguem o que o ciclo 31 mediu: uma consulta por página (nunca uma por
  Mensagem), `ordem=cronologica` em TODA página do export, e nome por autor, nunca por participante.** Na maior
  Conversa (270.453 Mensagens) a página de 500 custa 0,45 s e 276 KB; paginar tudo é ~541 páginas, ~4 min e
  ~150 MB, por isso a listagem de Anexos é rota própria. O default de ordem de
  `GET /conversas/<id>/mensagens` **muda com o cursor** (cronológica sem, decrescente com): um export que omite
  `ordem` na segunda página repete e pula. `participantes` não dá nome a quem escreveu: numa Conversa de
  101.527 Mensagens, 850 dos 2.200 autores (39%, e 23% das Mensagens) não constam dele, então o nome vem de
  `GET /conversas/<id>/autores`. O filtro por remetente parte do Identificador (`identificadoresDoRemetente`
  concorda com `identificarPorValor`, e um teste fixa isso), e `autorIds` vazio devolve NADA, nunca tudo.
- **Leitura do servidor roda em worker, com prazo; o worker nunca escreve (#1132).** O servidor era um processo e uma
  thread, e a consulta lenta (1,2 a 8 s) bloqueava todos os clientes, e a abandonada seguia rodando. Cada `GET` vai a um
  pool de workers (`despachante.ts`), com prazo desde a chegada, `504`, abandono pelo cliente, reserva de N−1 workers e
  metade da fila por Inquilino. O `req` e o `res` do worker são `method`/`url` e `writeHead`/`end`/`headersSent`, e
  LANÇAM em qualquer outro membro (`contrato-da-leitura.ts`); rota de leitura nova que precise de mais falha no teste.
  As rotas de leitura abrem o Registro somente-leitura (`tests/rotas-registro-somente-leitura.test.ts` conta: só o POST
  de Envio abre para escrita). O gancho de teste é serializável (`instrucaoDoTrabalhador`), e o teste de bloqueio roda o
  servidor em PROCESSO SEPARADO: no mesmo processo, o mutante síncrono travaria o relógio do próprio teste e passaria.
  O corpo binário atravessa por transferência (sem cópia): `GET /midia` serve até 890 MB.
- **O texto que o usuário digita é TEXTO, nunca sintaxe: `buscarMensagens` o cita palavra por palavra
  (`termoParaFts5`) antes de ir ao `MATCH` do FTS5, e o servidor tem rede de segurança para o que escapar (#1131).**
  O termo ia cru, e `a.b`, `a&b`, `AND` ou uma aspas solta lançavam `SqliteError` dentro do manipulador: excecao ali
  derruba o PROCESSO, que atende todos os Inquilinos, e o servidor de produção caiu duas vezes assim (o export
  de uma Conversa de 206 mil Mensagens morreu com 502 por uma dessas). `servidor.ts` captura a exceção da rota
  e responde `500` de corpo vazio, logando mensagem e caminho SEM a query (pode ter texto de conversa); isso não
  substitui tratar o erro na rota, só impede que um defeito vire queda. Palavra citada se comporta como a solta
  de antes (caixa e acento ignorados, E entre palavras); `AND`/`OR`/`NOT`, `*` e `NEAR` deixam de ser operadores.
- **Processo de fundo dentro de `malote servir` (o worker de transcrição, e qualquer futuro
  análogo) NUNCA abre o Acervo para escrita sem checar a versão gravada primeiro.**
  `abrirAcervo` migra a base — e um processo que atende requisição de fora não pode ter esse
  poder, pelo mesmo motivo que a leitura por rede abre somente-leitura. Sem a checagem
  (`versaoDoAcervoEmDisco` antes de `abrirAcervo`), o primeiro boot pós-deploy migraria a
  base sozinho, antes de qualquer Ação Documentada — repetindo o quase-incidente da v0.21.0
  por desenho, não por acidente. Acervo em forma divergente é pulado e relatado, nunca
  migrado pelo worker; quem migra continua sendo `malote acervo migrar`/o ouvinte.
- **O modo REDE é fail-closed e a guarda morre ANTES de qualquer I/O.** Só os comandos de
  leitura declarados em `COMANDOS_DE_REDE` consultam por HTTP; comando de escrita com
  `--servidor` recusa **antes de abrir Registro ou Acervo** — invocação errada não nasce
  `registro.db` (testado com instalação vazia). A resolução de modo é global: nunca desce
  para dentro de handler.
  **Exceção nomeada (ciclo 28):** `enviar` é o único comando de escrita que o cliente
  despacha por rede, com despacho próprio no ponto de entrada — ele **não** entra em
  `COMANDOS_DE_REDE`, que continua sendo a allowlist de leitura. A variável de ambiente do
  servidor liga o modo; `--servidor` sozinha só troca a URL. No modo rede o Inquilino vem
  só da chave e `--inquilino` é recusado. O cliente gera o Identificador de Envio e o
  manda; o código 7 diz o identificador e que repetir com `--identificador` é seguro (o
  servidor não cria segundo Envio). **Ordem de release:** o servidor (host de produção) recebe a
  versão antes de qualquer cliente — servidor antigo ignora o campo e duplicaria, e o
  cliente só avisa em resposta que chegou. `envio estado` também é despachado por rede
  (ciclo 29), no ponto de entrada e fora de `COMANDOS_DE_REDE`; `envio reprocessar`
  continua só local.
- **Cliente HTTP mora em `src/cli/`, nunca em `src/rede/`.** `src/rede/` é a zona do
  baileys e a fronteira proíbe `cli` importá-la — a guarda pegou a violação no commit em
  que nasceu (ciclo 21).
- **Paginação de Mensagens usa cursor COMPOSTO `(ocorrida_em, id)`, opaco.** O instante
  sozinho não pagina: instantes iguais pulam ou repetem. O consumidor devolve o token
  `proximo` que recebeu; a rota trata token inválido como **400**, nunca como primeira
  página. O oráculo: três Mensagens no mesmo instante, limite 2, virar a página.
- **Termo do usuário em `LIKE` é literal** — `%` e `_` escapados com `ESCAPE`; busca que
  interpreta curinga é busca errada em silêncio.
- **A CLI no modo rede tem código de saída POR CLASSE de falha** (3 credencial, 4 conexão,
  5 servidor, 6 uso, 7 timeout com resultado desconhecido) — é o que permite agente
  tratar erro de consulta deterministicamente. `--chave` continua sendo Chave de Operador;
  a Chave de Acesso vai só por env.
- **O Inquilino de toda consulta por rede vem da CREDENCIAL, e nunca do chamador.** A verificação de Chave devolve **quem** — `{chaveId, inquilinoId}` —, e não um booleano: é dela que sai o alcance. Devolver `true` obrigaria quem chama a perguntar o alcance depois, e a janela entre *"é válida"* e *"o que ela abre"* é onde o isolamento se perde. Enviar `?inquilino=` não muda nada, e há guarda com sinal próprio para isso.
- **A leitura por rede abre o Acervo SOMENTE-LEITURA.** Abrir para escrita **migra** a base, e um servidor que atende requisição de fora não pode ter esse poder — mesma razão pela qual `ouvinte estado` lê um arquivo. A porta recusa forma divergente, e isso é o certo: superfície de consulta não conserta base, avisa.
- **Uma recusa só, com corpo vazio, para credencial ausente, inválida e revogada.** Distinguir vaza a existência de Inquilinos alheios. A promessa é sobre o que a resposta **diz** — corpo e código —, e **não sobre quanto tempo ela leva**: canal lateral de tempo não se elimina, e prometer seria promessa que nenhum código cumpre. Rota desconhecida **com** credencial válida responde 404, e não 401 — quem tem Chave já provou que pode saber que o servidor existe, e separar os códigos dá a cada guarda um sinal próprio.
