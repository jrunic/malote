---
id: 202611081900
projeto: malote
tipo: decisao
status: aprovado
data: 2026-11-08
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o malote aprende o par da forma opaca na Conversa direta pelo campo do companheiro que a plataforma manda com a Mensagem recebida, ao vivo e no estoque, sem unir Conversas: a Conversa por endereço opaco congela quando o par é aprendido; o que o desfazer cobre e o que não cobre"
tags: [adr, decisao, adaptador, whatsapp, identidade, correspondencia, conversa-partida]
---

# ADR — O par da Conversa direta pelo campo do companheiro

## Status

Aprovado — 2026-11-08. Não muda a forma do Acervo nem a do Registro e não acrescenta dependência. Complementa a regra do par do celular brasileiro (`docs/explicacoes/invariantes-de-identidade-nome-e-catalogo.md`).

## Contexto

O WhatsApp entrega o outro lado de uma Conversa direta ora pelo endereço do número, ora por um endereço opaco. Quando é o opaco, o aplicativo mostra o número, mas o malote não o sabia: `identificar` devolvia o endereço opaco sem número, e `mensagens --remetente` com o número não achava nada. Na Conversa coletiva o par já se aprendia pelo campo que a plataforma manda com o autor.

Medido em novembro de 2026, só leitura, nos Acervos de uma instalação real:

- **O dado já chega.** A Mensagem **recebida** de Conversa direta por endereço opaco traz o endereço do número do outro lado, num campo que a biblioteca em uso lê de toda mensagem decodificada; o Conteúdo Bruto o guardava e o código só o contava.
- **A Mensagem enviada pela conta não o traz** (nenhuma das enviadas em Conversa direta por endereço opaco), mas a biblioteca o preencheria em qualquer mensagem.
- **O campo é estável:** os pares já conhecidos por outro caminho concordaram com ele em todos os casos, e nenhuma Conversa trouxe mais de um número depois da regra do celular.
- **Quando o par já existia, a Conversa por endereço opaco tinha congelado:** nenhuma recebeu Mensagem depois do par, e as Mensagens novas foram para a Conversa do número. O histórico desses outros lados já estava em duas Conversas.

## Decisão

1. **A recepção ao vivo aprende o par da forma opaca na Conversa direta**: a Mensagem recebida (nunca a da conta), de Conversa por endereço opaco, com o campo, e cujo opaco ainda não resolve, grava o par (o opaco como alternativo, o número já resolvido pela regra do celular como canônico) antes de qualquer escrita de endereço do evento. Só abre Operação com par novo; com o par gravado, só compara.
2. **Conflito não escreve e não interrompe:** o primeiro par vence, a Mensagem é gravada e o ouvinte registra uma linha só com a contagem.
3. **O estoque tem comando próprio,** `identidade aprender-pares-da-conversa-direta`, irmão do aprendizado das formas do celular: ensaio por padrão, Operação `por-efeito` que só cria pares (as duas espécies), que o `desfazer` remove pelo caso que a tabela de correspondências já tem, e conferência independente.
4. **Não se unem Conversas.** A Conversa por endereço opaco congela quando o par é aprendido, a partir do próprio evento que traz o campo, e isso se declara na documentação e no ensaio do estoque (as Conversas partidas, por Configuração). A união é decisão à parte.
5. **A edição de uma Mensagem antiga continua valendo:** a Conversa da original e a do envelope se comparam pelo endereço resolvido dos dois lados.

## Consequências e riscos

- **Par errado é silencioso e persistente.** Um campo errado ligaria o outro lado ao número de outro, e toda Mensagem futura do opaco seria gravada na Conversa desse número. A troca de número do mesmo outro lado aparece como conflito e mantém as Mensagens novas na Conversa do número antigo. A mitigação é a medição acima e o conflito contado.
- **O `desfazer` não é uma volta.** Ele remove os pares do estoque, mas o ouvinte reaprende o par na Mensagem recebida seguinte (o envelope ao vivo é irreversível), e as Mensagens gravadas entretanto ficam na Conversa do número. Voltar de fato pede tirar a versão do ar e remover os pares aprendidos depois dela, por decisão de quem opera.
- **Conversa partida para todo outro lado que ganha par,** com a Conversa do número vazia quando a reentrega traz um evento antigo depois do par.
- **O par vale para o Inquilino inteiro:** congela também a Conversa opaca de outra Configuração com o mesmo outro lado.
- **Quem a conta procura primeiro fica sem número até responder.** Não há outra fonte do par na versão da biblioteca em uso.
- **Se a biblioteca deixar de mandar o campo, o aprendizado para sem sinal no produto.** O contador `diretaComPar` de `ouvinte estado --json` é a medida; quem vigia a instalação decide o alarme.
- **Custo:** a consulta do par a mais por Mensagem recebida desse tipo, e o INSERT do par uma vez por endereço opaco novo.

## Alternativas consideradas

- **Unir as Conversas no mesmo ato.** Mover Mensagens entre Conversas mexe em unicidade, Participações e Anexos; fica para decisão própria.
- **Aprender também da Mensagem enviada.** O campo nunca veio nela; aceitá-lo deixaria o número da própria conta apontar o outro lado para o Titular.
- **Esperar a linha 7.x da biblioteca**, que traz o campo alternativo por mensagem. Fora desta decisão (atualização de dependência com ADR própria).
- **Não fazer nada.** O outro lado continua achado só pelo endereço opaco, que ninguém digita.

## Como reverter

Uma versão nova que tira o aprendizado da Conversa direta da primeira passada: o ouvinte deixa de aprender. Os pares já gravados continuam valendo (a resolução segue qualquer par gravado); removê-los é uma Operação à parte, e as Mensagens gravadas na Conversa do número ficam onde estão.

## Referências

- `GLOSSARIO.md`, **Correspondência de endereço**.
- `docs/dominio/malote.md`, operações `receber-ao-vivo` e `aprender-pares-da-conversa-direta`.
- `docs/explicacoes/invariantes-de-identidade-nome-e-catalogo.md`.
