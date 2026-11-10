---
id: 202611091900
projeto: malote
tipo: decisao
status: aprovado
data: 2026-11-09
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — a Conversa partida que o par da forma opaca deixou se une por uma Operação própria, só na mesma Configuração: move as Mensagens para a Conversa do número quando ela existe, promove a Conversa partida quando não existe, para no conflito, nunca apaga nem reescreve Chegada, e o que o desfazer devolve e o que não devolve. Refina a ADR 20261108"
tags: [adr, decisao, adaptador, whatsapp, identidade, correspondencia, conversa-partida, uniao]
---

# ADR — A união da Conversa partida

## Status

Aprovado — 2026-11-09. **Refina** a [`20261108-par-da-conversa-direta-pelo-campo-do-companheiro.md`](20261108-par-da-conversa-direta-pelo-campo-do-companheiro.md) na decisão 4 ("não se unem Conversas") e na alternativa "unir as Conversas no mesmo ato": a recepção continua sem unir, e a união passa a ser uma Operação à parte. Não muda a forma do Acervo nem a do Registro, não acrescenta dependência e não muda a recepção ao vivo.

## Contexto

Desde que o par da forma opaca se aprende, a Conversa direta por endereço opaco **congela**: o que ela tinha fica nela, e o que chega vai para a Conversa do número. O histórico de quem fala fica em duas Conversas, e `mensagens --conversa`, `exportar`, o resumo da Conversa e `identificar` mostram metade. O `--remetente` com o número sem `--conversa` lê tudo, mas é contorno.

Medido em novembro de 2026, só leitura, nos dois Acervos de uma instalação real, depois do aprendizado do estoque:

- **No Acervo maior, 58 Conversas partidas com par:** 28 têm a Conversa do número na mesma Configuração (943 Mensagens) e 30 não têm (315 Mensagens, nenhuma vazia). No menor, 2: uma com a Conversa do número e uma **ambígua** (as duas formas do celular gravadas como Conversa na mesma Configuração, 5 Mensagens).
- **Mover uma Mensagem não colide:** a identidade externa da Mensagem é única no Acervo inteiro, e nenhum número recebe duas Conversas partidas na mesma Configuração.
- **A história se intercala:** das 27 com Mensagens dos dois lados, 18 se sobrepõem no tempo. Não há corte limpo; a leitura por instante resolve.
- **O que pende da Mensagem não muda de Conversa** (Anexos, Edições, Citações), e as Chegadas apontam para a Conversa onde a Mensagem entrou.
- **A promoção muda o nome mostrado:** a listagem acha o Identificador pelo endereço da Conversa, e o nome não segue a Correspondência; das 30 a promover, 23 não têm Identificador do número e 9 perderiam o nome que mostram hoje.

## Decisão

1. **A união é uma Operação própria, do estoque**, por comando do operador (`identidade unir-conversas-do-contato`), em ensaio por padrão. A recepção não muda.
2. **Só na mesma Configuração e só com par já gravado.** O alvo é a Conversa direta do endereço do número na mesma Configuração, achada pelas duas formas do número. A união nunca aprende par nem cria Conversa.
3. **Com um alvo, move as Mensagens** e leva a marca de fixada que o alvo não tem. A Conversa partida **fica**, vazia, com as Participações que tinha (a Conversa direta tem duas Participações; levar a do endereço opaco poria um segundo Identificador do mesmo outro lado no alvo).
4. **Sem alvo, promove** a Conversa partida: o endereço dela passa a ser o do número na forma canônica, e o **Identificador desse endereço é registrado** sem Pessoa e sem nome, para a Conversa voltar a achar um Identificador. O id, o Conteúdo Bruto, as Mensagens, as Participações e as Chegadas ficam.
5. **Conflito não escreve:** mais de um alvo na mesma Configuração (inclusive as duas formas do nono dígito) ou duas Conversas partidas para o mesmo número. A execução segue com as demais, e o relatório nomeia o motivo, sem endereço nem texto.
6. **Nada se apaga e nada se reescreve na história:** a Conversa partida vazia continua existindo e aparece na listagem com 0 Mensagens; as Chegadas e os Envios não mudam; o Conteúdo Bruto da Conversa não é tocado.
7. **Uma Operação `por-efeito`, com uma linha de efeito por Mensagem movida**, por marca levada, por endereço promovido e por Identificador registrado; uma transação curta e imediata por Conversa, que relê e reclassifica sob o lock, com o ouvinte no ar. O `desfazer` devolve cada linha só enquanto o valor é o que a Operação gravou, por casos que vêm antes do ramo genérico da resolução retroativa.

## Consequências e riscos

- **Par errado vira Mensagens na Conversa errada.** Mover com par errado põe as Mensagens de quem fala na Conversa de outro número; o `desfazer` as devolve. Promover com par errado é pior: a Conversa promovida passa a receber as Mensagens futuras do número, e desfazer a promoção devolve o endereço opaco a uma Conversa que já tem Mensagens das duas formas; a Mensagem seguinte do número cria uma Conversa nova (três cortes). O que protege é só unir par já gravado, e o conflito do par contado desde que ele se aprende.
- **O `desfazer` não é volta total.** O que chegou depois na Conversa do número ou na promovida fica onde está.
- **O nome pode piorar nas promovidas** até a Fonte entregar nome para o número ou até a resolução retroativa fundir os dois Identificadores. O ensaio conta quantas.
- **Quem filtra o Diário de Chegadas pelo id da Conversa do número** não vê as Chegadas antigas das Mensagens movidas. O filtro por Configuração e a leitura por Marcador continuam completos.
- **Quem guardou fora do malote o id da Conversa de uma Mensagem** vê o id mudar depois do movimento.
- **O ambíguo das duas formas fica partido** até a reconciliação das duas formas do número, que é outro trabalho.
- **Custo:** uma leitura e uma atualização por linha de efeito no `desfazer`; na execução, transações de dezenas de milissegundos por Conversa no Acervo maior.

## Alternativas consideradas

- **O nome da Conversa direta seguir a Correspondência.** Preserva o nome de todas, mas muda a leitura de todas as superfícies (`conversas`, `detalhar`, a busca por nome e a leitura de nomes em lote) e sai do recorte de unir.
- **Desempatar o ambíguo pela forma canônica do resolvedor.** Une a Conversa partida a uma das duas e deixa a outra partida: quem fala continua em duas Conversas.
- **Levar as Participações do endereço opaco.** Fere a regra das duas Participações da Conversa direta sem ganho de leitura.
- **Apagar a Conversa partida vazia ou escondê-la da listagem.** Apagar perde a âncora das Chegadas e dos Envios antigos; esconder muda a listagem. Fica para decisão própria, se fizer falta.
- **Criar uma Conversa nova do número em vez de promover.** Move tudo sem ganho: o id muda, as Chegadas ficam na antiga e o histórico continua em duas.
- **Unir na recepção, no ato do par.** Escrita longa no caminho quente do ouvinte, sem ensaio e sem volta por Operação.
- **Não fazer nada.** O histórico de quem fala segue em duas Conversas.

## Como reverter

Por Operação: `operacao desfazer` devolve as Mensagens, a marca, o endereço e remove o Identificador registrado, linha a linha, enquanto ninguém mudou o valor depois (com a ressalva dos riscos acima). Por código: uma versão sem o comando não desfaz uniões já feitas; a recepção não depende dele.

## Referências

- `GLOSSARIO.md`, **Conversa partida** e **Correspondência de endereço**.
- `docs/dominio/malote.md`, operações `receber-ao-vivo` e `unir-conversas-do-contato`.
- `docs/explicacoes/invariantes-de-identidade-nome-e-catalogo.md`.
