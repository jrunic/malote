---
id: 202608261136
projeto: malote
tipo: decisao
status: aprovado
data: 2026-08-26
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o malote não raspa página de perfil para resolver identidade; a plataforma proíbe coleta automatizada e a técnica exige assumir identidade de outro agente, e a vinculação assistida por volume cobre 80% do acervo com 50 vínculos humanos"
tags: [adr, decisao, identidade, adaptador, raspagem, instagram, termos-de-uso]
---

# ADR — Identidade não vem de raspagem de página de perfil

## Status

Aprovado — 2026-08-26.

## Contexto

O material exportado de uma plataforma de mensagens pode não conter o endereço da contraparte. É o caso do Instagram, medido sobre um acervo real de 460 conversas e 30.496 mensagens:

- a conversa traz o **nome de exibição**, nunca o apelido de perfil — o nome do diretório é o título normalizado em 460 de 460 casos;
- o apelido de perfil existe no material, mas nas listas de seguidores e seguidos, **sem nome de exibição** em nenhuma das 2.457 entradas;
- **não há chave que ligue as duas coisas.**

Sem essa ligação, uma Pessoa vista no Instagram não se cruza com a mesma Pessoa vista em outra Fonte.

Existe um caminho técnico. A página pública de perfil devolve, num único metadado, o nome de exibição e um identificador numérico estável a troca de apelido — o que resolveria também a mudança de apelido, que de outra forma produz Identificador novo sem aviso. Medido: 40 requisições, 40 respostas bem-sucedidas, nome obtido em 35.

**Mas esse caminho não está disponível para nós.** Duas medições dizem por quê:

1. O `robots.txt` da plataforma declara, em texto próprio, que a coleta automatizada é **proibida sem permissão expressa por escrito**, e a regra para agente não listado é `Disallow: /`.
2. O metadado **não é servido a um cliente comum** — um navegador logado-fora recebe apenas o esqueleto da aplicação. Ele só aparece quando a requisição se apresenta como um dos agentes de prévia de link autorizados. Obter o dado exige, portanto, **assumir a identidade de outro agente** para receber o que é negado ao nosso.

O segundo ponto é o que decide. Não se trata de zona cinzenta de termos de uso: trata-se de contornar um controle de acesso declarado, apresentando-se como quem não se é. Um produto instalado por terceiros que embutisse essa técnica distribuiria a violação junto com o binário, e quem instala herdaria a decisão sem nunca ter lido esta página.

## Decisão

**O malote não resolve identidade por raspagem de página de perfil.** Nenhum adaptador do produto assume identidade de outro agente, ignora `robots.txt` ou contorna controle de acesso de plataforma para obter dado.

No lugar disso, entra a **vinculação assistida por volume**: o produto ordena as Conversas sem endereço conhecido por quantidade de Mensagem e oferece ao Titular ligar o endereço à Conversa, uma a uma, do maior para o menor.

A medição é o que torna a substituição viável — o acervo é fortemente concentrado:

| Conversas vinculadas à mão | Mensagens cobertas |
|---|---|
| 10 | 49% |
| 20 | 63% |
| 50 | **80%** |
| 100 | 92% |

E 214 das 460 conversas (47%) têm cinco Mensagens ou menos, somando 1,7% do acervo. A cauda que a raspagem alcançaria custa 2.457 requisições e cobre a fração irrelevante do acervo.

Cada vínculo feito assim é **afirmado por humano** — a procedência mais alta do modelo, e a única que nenhuma execução automática pode desfazer.

## Consequências

### Positivas

- O produto não pede a quem instala que viole termo de uso de plataforma, nem embute técnica de evasão.
- Nada no produto depende de formato de página de terceiro, que muda sem aviso e quebra em silêncio.
- O vínculo de maior valor passa a ser o de maior confiança: quem tem mais Mensagem é vinculado por humano, não por coincidência de nome.
- Sem dependência nova e sem tráfego de saída para a plataforma.

### Negativas

- **A cauda fica sem endereço.** Conversas pouco ativas seguem identificadas só por nome, e não cruzam com outras Fontes. É 1,7% do acervo medido — irrelevante para busca, não para completude.
- **Mudança de apelido continua invisível.** Sem o identificador numérico da plataforma, trocar de apelido produz Identificador novo, e uni-los é operação manual.
- **Trabalho humano onde havia promessa de automação.** Cinquenta vínculos é uma tarde; não é zero.

### Implementação

- A operação de vinculação lista Conversas sem endereço ordenadas por contagem de Mensagem decrescente, e mostra quantas Mensagens cada vínculo passa a cobrir.
- Todo vínculo registra a procedência. Vínculo afirmado por humano nunca é sobrescrito por execução automática.
- Casamento por coincidência de nome, quando existir, produz **proposta**, nunca vínculo — e só é proposto quando o nome é único dos dois lados. Medição que obriga a regra: 22 Conversas do acervo compartilham o mesmo título, o marcador de conta indisponível; casar por nome sem a guarda de unicidade fundiria 22 pessoas distintas numa só.
- O catálogo de perfis do próprio material continua sendo lido — ele contribui Identificador, ainda que sem nome. Só acrescenta; nunca remove.

## Escopo

Vale para este repositório e para todos os seus adaptadores, presentes e futuros. Não é uma decisão sobre o Instagram: é sobre o método. Adaptador de qualquer Fonte que precise de dado servido apenas mediante identidade falsa de agente esbarra nesta ADR.

Não vincula o que o usuário faz com o próprio acervo fora do produto.

## Alternativas Consideradas

| Alternativa | Por que não |
|---|---|
| **Raspar a página de perfil** | a plataforma proíbe coleta automatizada em `robots.txt`, e o dado só é servido a quem se apresenta como agente autorizado que não somos. Distribuir isso num produto instalado por terceiros transfere a violação para quem instala |
| **API oficial da plataforma** | a interface pública de perfil de terceiro foi descontinuada; a que resta exige conta comercial, revisão de aplicativo e não devolve dados de quem conversa com o usuário |
| **Casar nome de exibição com apelido por semelhança** | medido: sem a página de perfil não há nome de exibição no catálogo, e comparar o apelido com o título casa 113 de 455 conversas — palpite por nome, que fundiria pessoas distintas. Vira proposta, nunca vínculo |
| **Catálogo de contatos externo** | resolve endereço para Fontes que usam telefone ou e-mail, e é complementar a esta decisão. Não devolve apelido de perfil de plataforma de rede social |
| **Exigir confirmação humana de todo vínculo** | seguro e inviável: 460 conversas. A ordenação por volume entrega a mesma segurança onde ela importa, com 50 |

## Nota sobre a ADR de recepção ao vivo

A decisão de usar biblioteca não-oficial para recepção ao vivo aceitou risco de outra natureza, e a diferença é a que sustenta as duas: lá o usuário **autentica a própria conta** num cliente não-oficial, expondo o que é dele, para receber as próprias mensagens — que é a função central do produto. Aqui, o produto se apresentaria como outro agente para ler dado de **terceiros** que a plataforma nos nega, para função acessória. Aquela ADR já havia recusado automação de navegador; esta recusa a raspagem pelo mesmo espírito, com a medição na mão.

## Referências

- `docs/dominio/malote.md` — agregados Pessoa, Identificador e Adaptador; Identificador sem Pessoa é estado válido
- `docs/decisoes/20260824-adocao-de-biblioteca-nao-oficial-para-recepcao-ao-vivo.md` — a decisão de risco de outra natureza
- `CONTEXTO.md` — política de dependência nova exige ADR
