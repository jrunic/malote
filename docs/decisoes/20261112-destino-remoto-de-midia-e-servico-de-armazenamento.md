---
id: 202611121010
projeto: malote
tipo: decisao
status: aprovado
data: 2026-11-12
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o Inquilino pode ter um Destino Remoto de Mídia, mantido por um Serviço de Armazenamento à parte que sobe, verifica por hash e só então apaga a cópia local depois de uma Janela; a Localização do Anexo é base própria refazível, fora do Acervo; o arquivo nunca é renomeado. Reabre o recorte v1 do Destino de Mídia"
tags: [adr, decisao, armazenamento, destino-remoto, midia, localizacao, risco]
---

# ADR — Destino Remoto de Mídia e Serviço de Armazenamento

## Status

Aprovado — 2026-11-12. Revisa o recorte v1 do Destino de Mídia (28/08/2026), que deixava o transporte remoto de fora.

## Contexto

O Destino de Mídia é um caminho de sistema de arquivos por Inquilino, e o produto não tinha como tirar a mídia do disco do host. A ADR do rclone (`20261112-rclone-como-dependencia-nativa-do-armazenamento-remoto`) decide como falar com um remoto. Esta decide o que o produto guarda, quem faz o quê e o que não muda.

Restrições que o desenho respeita: o caminho do arquivo de um Anexo não pode conter dado pessoal (invariante do Anexo); o Acervo é de um Inquilino e só o núcleo e o Registro tocam em tabela; a recepção ao vivo não pode esperar rede; e uma remoção de arquivo local que não tenha o remoto íntegro é perda definitiva.

## Decisão

1. **O Destino Remoto é acréscimo, não substituto.** O Inquilino continua com o Destino de Mídia local (onde o arquivo chega e fica pela Janela de Cópia Local) e pode ter, além dele, um Destino Remoto: o nome de um remoto que o rclone do host resolve, a pasta-base, a Janela, a trava de apagar a cópia local, o fuso do rótulo do Índice de Mídia e os limites de ritmo. Por ser acréscimo, mora em tabela própria do Registro e a natureza do Destino de Mídia continua `local`; o Registro sobe de versão por um passo declarado que só acrescenta a tabela.
2. **Um Serviço de Armazenamento, processo à parte.** Só ele fala com o remoto. Para cada Anexo presente, sobe o arquivo, verifica no remoto o hash de conteúdo e o tamanho contra a Impressão de Anexo do Acervo, registra a Localização do Anexo e, **depois da Janela contada do instante da verificação e com a trava liberada pelo Operador**, reverifica e apaga a cópia local. A recepção ao vivo e a importação não esperam o serviço e não mudam.
3. **A trava de apagar começa fechada.** Enquanto fechada, o serviço copia e verifica e nunca apaga. Liberá-la é decisão explícita do Operador, registrada na trilha com o antes e o depois.
4. **A Localização do Anexo é base própria do serviço, refazível, fora do Acervo.** Uma base por Inquilino, na categoria de estado (o que se refaz). Guarda o caminho remoto, o identificador do arquivo no remoto quando existe, o tamanho, o hash verificado, o instante da verificação e o instante em que a cópia local saiu. Como o caminho remoto é função do Anexo, a base se reconstrói por listagem do remoto. **Política de forma:** forma diferente da corrente é recusada com a instrução de recriar; não há passos de migração (a mesma lógica do Acervo, que se recria do material, e não a do Registro, que não se recria). Só o serviço a escreve; quem apenas lê a abre somente leitura.
5. **O Acervo não muda de forma.** A Presença `presente` passa a significar que o arquivo existe no Destino de Mídia, no disco ou, depois de verificado, só no Destino Remoto. Mover para o remoto e apagar a cópia local não é Chegada.
6. **O arquivo nunca é renomeado.** O caminho remoto é derivado do local pelo núcleo, com um nível de pasta em vez de dois (cerca de 1,5 mil pastas no estoque inteiro, contra quase uma pasta por arquivo), começa pelo segmento do Inquilino e não carrega dado pessoal.
7. **Quem vê a mídia por nome de conversa usa o Índice de Mídia, não o nome do arquivo.** (Spec do ciclo.)

## Consequências

### Positivas

- O disco do host deixa de crescer com a mídia, sem mudar a forma do Acervo e sem renomear arquivo.
- Nenhum arquivo local sai sem o remoto íntegro, provado por hash e reverificado.
- A Localização se perde sem perder dado: refaz-se por listagem.

### Negativas

- Depois da Janela, o remoto passa a ser a única cópia do arquivo, e a mídia não está no backup de categoria dos dados. O risco é do Operador, mitigado pela verificação, pela trava, por uma checagem periódica por amostra e pela lixeira do remoto, que o produto não promete.
- **Arquivo com mais de um nome no disco só libera espaço quando todos os nomes saem.** O produto não conhece quem mais referencia o arquivo; apagar a cópia do malote pode deixar os bytes no disco por outro nome.
- O conteúdo no remoto fica sob o provedor: o produto não promete confidencialidade contra o Operador (ADR `20260824-confidencialidade-nao-garantida-contra-o-operador`) nem contra o provedor que o Operador escolheu.
- A Janela contada da verificação faz o estoque antigo só liberar disco uma Janela depois de verificado.

### Implementação

Plano em quatro partes: fundação (Registro, layout remoto, Localização, porta de leitura), Serviço de Armazenamento, leitura pelo servidor e consumidores do arquivo local, e o Índice de Mídia.

## Alternativas consideradas

- **Trocar a natureza do Destino de Mídia para remota.** Rejeitada: o Destino local continua necessário como lugar de chegada e de cópia pela Janela; trocar a natureza obrigaria recriar a tabela do Destino e esconderia a cópia local.
- **Guardar a Localização no Acervo.** Rejeitada: mudaria a forma do Acervo por um cache refazível e faria do serviço um segundo escritor do Acervo.
- **Apagar a cópia local logo depois de verificar.** Rejeitada: a transcrição e a recuperação de falha de envio leem o arquivo local, e a Janela é o tempo de a fila andar.
- **Renomear o arquivo com o nome da conversa.** Rejeitada: viola a invariante do caminho sem dado pessoal e exige renomear de novo a cada nome que muda.

## Referências

- ADR `20261112-rclone-como-dependencia-nativa-do-armazenamento-remoto`
- ADR `20260901-politica-de-forma-por-base`
- ADR `20260916-armazenamento-por-categoria-xdg`
- ADR `20260824-confidencialidade-nao-garantida-contra-o-operador`
