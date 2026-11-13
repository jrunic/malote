---
id: 202611121000
projeto: malote
tipo: decisao
status: aprovado
data: 2026-11-12
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o armazenamento remoto de mídia usa o rclone, binário nativo declarado pelo Operador, opcional e sem instalação automática, invocado por subprocesso só pelo Serviço de Armazenamento; nenhuma dependência npm nova"
tags: [adr, decisao, armazenamento, rclone, dependencia-nativa, midia, risco]
---

# ADR — rclone como dependência nativa do armazenamento remoto de mídia

## Status

Aprovado — 2026-11-12.

## Contexto

A mídia de um Inquilino só existe no disco do host. Num host de produção medido em 11/11/2026 ela ocupava 299 GB num disco de 591 GB com 97% de uso e crescia de 40 a 80 GB por mês: quando o disco enche, a recepção deixa de gravar mídia, Mensagem e Acervo. O Operador tem espaço em um serviço de nuvem e precisa que a mídia possa sair do disco do host sem que o produto perca a prova de que cada arquivo está íntegro.

Falar com um provedor de nuvem de dentro do produto custa caro e não é neutro:

- Uma biblioteca do provedor é dependência npm nova. O repositório é público, a árvore de dependências é fixa (`baileys`, `better-sqlite3` e `tsx`) e dependência nova exige ADR.
- A autenticação (OAuth, renovação de token, cotas) passaria a ser do produto, instalado por terceiros que não têm a infraestrutura de quem o escreveu.
- Cada provedor adicional repete tudo isso.

O produto já tem um precedente para o outro lado do dilema: a transcrição de áudio usa binários nativos que o Operador declara, que são opcionais e que nunca são instalados nem baixados pelo malote (ADR `20260928-dependencia-nativa-do-whisper-cpp-para-transcricao-de-audio`).

Medido num piloto em 11/11/2026, contra o Google Drive, com o rclone 1.76: a listagem devolve o identificador do arquivo e o SHA-256 (que é a Impressão de Anexo que o Acervo já guarda); o envio interrompido não deixa arquivo visível e a retomada não duplica; um processo `rclone` novo leva em média 4,3 s para consultar um arquivo e 5,8 s para lê-lo, e um `rclone rcd` aquecido leva 0,33 s e 1,3 a 1,6 s até o primeiro byte; 16 transferências simultâneas sustentaram 4,8 arquivos pequenos por segundo, sem erro de cota.

## Decisão

1. **O rclone é dependência de execução, não de código.** Nenhum pacote npm novo; a árvore de dependências fica como está.
2. **O Operador o declara.** O produto lê o nome do remoto que o rclone do host já resolve (por variáveis de ambiente do rclone ou pelo arquivo de configuração dele, à escolha de quem instala) e o caminho do binário por variável de ambiente. Credencial nunca é do produto.
3. **É opcional.** Sem o binário declarado, o produto sobe e funciona por inteiro, e só o armazenamento remoto fica parado, com o motivo no estado. Nada o instala nem o baixa.
4. **Portão único.** Só o Serviço de Armazenamento invoca o rclone, por subprocesso com prazo, sinal de morte e limite de saída; um teste de fronteira reprova qualquer outro módulo que o invoque ou leia as variáveis dele.
5. **Aquecido, não por pedido.** Como o processo frio custa de 4 a 6 s por chamada, o serviço mantém um `rclone rcd` em localhost, autenticado por variável de ambiente (nunca por argumento de linha de comando), e é o único que fala com ele.
6. **Versão e interface testadas, não presumidas.** Os testes usam um executável que imita a interface usada; o rclone real roda só em medição de campo. A versão é fixada por quem instala.

## Consequências

### Positivas

- O produto fala com qualquer provedor que o rclone fale, sem código novo por provedor.
- A credencial e a renovação de token ficam fora do produto.
- A verificação por hash e a listagem com identificador vêm prontas.

### Negativas

- Dependência de um binário externo cuja interface o produto não controla.
- O acesso à API do `rclone rcd` equivale a shell do usuário que o roda: só escuta em localhost, com autenticação, e o guia de host registra o limite.
- A variável de ambiente com o acesso ao remoto fica legível, pelo sistema de arquivos de processos, ao mesmo usuário do host.

### Implementação

O Serviço de Armazenamento, o portão das variáveis e a documentação seguem a spec do ciclo e a ADR do Destino Remoto de Mídia.

## Alternativas consideradas

- **Biblioteca do provedor dentro do produto.** Rejeitada: dependência npm nova, OAuth no produto público e repetição por provedor.
- **Montar o remoto como pasta e tratá-lo como Destino de Mídia local.** Rejeitada: uma montagem que cai trava a recepção, não há verificação por hash e a renomeação é cara.
- **Transporte de objetos (S3) dentro do produto.** Rejeitada: o mesmo custo da biblioteca, só para uma família de provedores.

## Referências

- ADR `20260928-dependencia-nativa-do-whisper-cpp-para-transcricao-de-audio`
- ADR `20261112-destino-remoto-de-midia-e-servico-de-armazenamento`
- ADR `20260824-confidencialidade-nao-garantida-contra-o-operador`
