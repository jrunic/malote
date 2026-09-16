---
id: 202608241313
projeto: malote
tipo: decisao
status: aprovado
data: 2026-08-24
escopo: repo:malote
plataforma: "*"
dominios: [tecnologia]
descricao: "ADR — o produto não protege o conteúdo contra o Operador da instalação; a garantia é auditoria de emissão de chave, e quem precisa de mais roda a própria instalação"
tags: [adr, decisao, seguranca, multi-inquilino, criptografia, auditoria]
---

# ADR — Confidencialidade não é garantida contra o Operador

## Status

Aprovado — 2026-08-24.

## Contexto

Uma instalação do malote hospeda vários Inquilinos isolados. Quem administra a instalação — o Operador — cria Inquilino, emite e revoga Chave de Acesso e configura Destino de Mídia. Nenhuma operação de leitura de conteúdo aceita Chave de Operador.

Essa separação parece garantir que o Operador não lê o conteúdo dos Inquilinos. **Não garante.** O Operador emite Chave de Acesso para qualquer Inquilino e lê por ela. A separação é de superfície; o que a sustenta é o rastro da emissão, não a impossibilidade da leitura.

Fechar o buraco exigiria criptografia. Ao desenhar essa saída, aparece um conflito entre três propriedades que o produto quer ao mesmo tempo:

1. **Ingestão contínua no host** — o adaptador de recepção ao vivo grava o que chega, 24/7, sem a máquina do usuário ligada.
2. **Busca no servidor** — é o que torna a API útil para pessoa e para agente. Sem ela, a superfície de rede não entrega nada que valha.
3. **Texto claro inacessível ao Operador.**

Ingestão e busca exigem que a instalação enxergue o conteúdo. Cifrar de modo que o Operador não decifre significa cifrar com chave que o host não tem — e então o host não indexa. **As três não coexistem.**

Há ainda um contorno que valeria para qualquer esquema de criptografia adotado: o host precisa ver os bytes **na chegada**, para gravar e derivar. Criptografia protegeria o dado em repouso e o backup; nunca o instante da ingestão, nem um Operador malicioso com acesso à máquina.

## Decisão

**O malote não protege o conteúdo contra o Operador da instalação, e não promete o contrário em nenhuma superfície.**

A resposta a quem precisa dessa garantia não é criptografia — é **rodar a própria instalação**. Quem é o Operador é quem é o dono do dado.

O que o produto garante no lugar:

- Toda emissão e toda revogação de Chave de Acesso é registrada de forma imutável.
- **O Titular lista as Chaves de Acesso do próprio Inquilino**, incluindo as que não pediu, com data de emissão e estado — nunca o valor. Sem isso, a auditoria só serviria a quem já tem o poder.
- Nenhuma superfície do produto — código, README, documentação, mensagem de erro — afirma confidencialidade contra o Operador.

## Consequências

### Positivas

- Busca no servidor continua funcionando, e com ela a API para pessoa e para agente.
- Nenhum ônus de gestão de chave de cifra recai sobre quem instala ou consulta.
- A promessa do produto é cumprível. Prometer o que não se cumpre é pior que não oferecer.
- O isolamento entre Inquilinos continua valendo integralmente contra **Chave de Acesso** — o que muda é apenas o que se garante contra o **Operador**.

### Negativas

- Instalação que serve terceiros exige confiança no Operador, e isso precisa ser dito a eles.
- O malote não serve, como está, de serviço hospedado multi-inquilino entre partes que não confiam umas nas outras.
- A auditoria é detectiva, não preventiva: mostra que uma chave foi emitida, não impede a emissão.

### Implementação

- Nenhuma operação de leitura de Conversa, Mensagem, Pessoa ou Anexo aceita Chave de Operador.
- Registro de emissão e revogação é imutável e legível pelo Titular.
- O isolamento entre Inquilinos é guarda de segurança: só está testado se o teste falhar com a guarda desligada, e **cada guarda precisa de sinal próprio de falha** — quando várias compartilham a mesma mensagem, desligar uma não derruba o teste dela.
- README declara explicitamente o modelo de ameaça coberto e o não coberto.

## Escopo

Vale para este repositório e para o produto que ele entrega. Não é recomendação de segurança para outros sistemas, e não vincula decisão futura: se um esquema de criptografia passar a fazer sentido, ele revoga esta ADR em vez de conviver com ela.

## Alternativas Consideradas

| Alternativa | O que garantiria | Por que não |
|---|---|---|
| **Cifra assimétrica na ingestão** — o host cifra e nunca decifra | forte: nem com acesso de administrador o Operador lê em repouso | mata a busca no servidor. O cliente teria de baixar tudo e buscar localmente, o que inutiliza a API para agente e esvazia a superfície de rede |
| **Cifrar apenas os Anexos**, mantendo texto e índice em claro | protege em repouso e em backup o material que domina o volume do acervo, sem perder a busca textual | recomendada na discussão e recusada: acrescenta gestão de chave ao v1, e o contorno honesto continua sendo que a ingestão vê o claro. A separação entre "protegido" e "não protegido" dentro do mesmo acervo é difícil de comunicar sem induzir a erro |
| **Cifra em repouso com chave da própria instalação** | protege contra roubo de disco ou de backup | não entrega nada contra o Operador, que é o ponto. Pode ser adotada depois como higiene, sem revogar esta ADR |
| **Não decidir e não declarar** | — | recusada. Não oferecer garantia é aceitável; deixar o silêncio sugerir uma garantia inexistente, não |

## Referências

- `docs/dominio/malote.md` — agregados Inquilino, Chave de Operador e Chave de Acesso; seção "Postura de confidencialidade"
- `GLOSSARIO.md` — **Inquilino**, **Operador**, **Chave de Acesso**, **Chave de Operador**
