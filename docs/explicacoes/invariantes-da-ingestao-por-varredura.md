---
id: 202610061581
projeto: malote
tipo: explicacao
escopo: repo:malote
plataforma: "*"
status: ativo
dominios: [tecnologia]
descricao: Regras da varredura de material, da Pasta de Entrada e da marca de ausência, com motivo e medição — carga sob demanda.
tags: [explicacao, invariantes, Node]
---

# Invariantes da ingestão por varredura

Regras e decisões do repo **com o motivo e a medição que as sustentam**, movidas do `CONTEXTO.md` para que a carga default da sessão fique pequena. Leia antes de mexer no assunto; o `CONTEXTO.md` aponta para cá e nomeia as regras mais perigosas.

- **A varredura invoca a importação em modo de reprocessamento, e isso não é atalho.** A posição do arquivo é o único mecanismo de "é novo": o que está na Pasta de Entrada é o que falta. Sem `reprocessar`, arquivo devolvido à pasta tem a mesma Impressão já em `materiais` e o importador devolve `jaRegistrado` sem percorrer — e todo critério que conte efeito passa contando zero sobre nada. Medido no vCard real: trocar um dígito de telefone preserva o tamanho em bytes, então a Impressão não muda.
- **Mover para `processados/` acontece depois do registro de conclusão, nunca antes — e nunca sobrescreve.** Invertido, material recusado some da Pasta de Entrada parecendo processado, e a importação lê um caminho que já não existe. Export periódico chega sempre com o mesmo nome; mover por cima é apagar com outro nome, e o produto não apaga nada. A colisão desambigua por **contador**, não por carimbo de tempo: duas passadas no mesmo segundo colidiriam de novo, e o defeito só apareceria sob a varredura agendada.
- **Reconhecer material é da varredura, não do adaptador.** `lerMaterial` do Instagram devolve vazio sem lançar, e a impressão de árvore vazia é constante. Deixar passar custa duas coisas: o que não é material vai para `processados/` e passa a se ler como processado, e `registrarMaterialConcluido` grava um Material de contagens zero que `material listar` mostra e que o watchdog de atraso lê como "chegou material". Pela varredura esse registro falso **não** envenena a leitura seguinte — ela invoca com `reprocessar: true`; pelo `importar` sem `--reprocessar`, envenena.
- **Dotfile não é candidato da varredura.** A Pasta de Entrada é alimentada por transporte que varia por quem instala, e `.DS_Store` e afins aparecem ali sozinhos. Sem o filtro, cada um vira recusa perpétua, impressa a cada varredura agendada — o que treina quem lê a ignorar a saída.
- **A Marca de Ausência é da varredura, não do importador, e roda UMA VEZ AO FINAL da passada.** A Natureza vive na Pasta de Entrada: `malote importar` manual nunca marca. O que estava presente é **derivado do instante** — um instante por passada, compartilhado por todos os materiais daquela Configuração. Marcar depois do primeiro de dois materiais marcaria como ausente tudo o que só o segundo traz.
