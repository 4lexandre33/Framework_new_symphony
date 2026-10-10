# GAME DESIGN DOCUMENT
# TREM FORA DE CONTROLE
**Versão:** 1.0  
**Gênero:** Sobrevivência cooperativa, física, gerenciamento em tempo real e roguelite  
**Estética:** 100% voxel 3D  
**Câmera:** Isométrica dinâmica, com zoom e rotação  
**Plataforma inicial:** PC — Steam  
**Jogadores:** 1–8, com foco em 2–6  
**Duração-alvo de uma expedição:** 20–30 minutos  
**Engine:** Three.js + Rapier WASM + Rust/Tauri + módulos desacoplados  
**Distribuição:** Steam, com Workshop, conquistas e multiplayer P2P

---

# 1. VISÃO GERAL

## 1.1 Conceito central

*Trem Fora de Controle* é um jogo de sobrevivência cooperativa no qual os jogadores precisam manter um trem funcionando enquanto atravessam um mundo voxel gerado proceduralmente.

A locomotiva avança continuamente por trilhos que atravessam florestas, desertos, montanhas, geleiras, pântanos, vulcões e regiões perigosas.

O trem não é apenas um veículo. Ele representa simultaneamente:

- A base operacional dos jogadores.
- O principal meio de transporte.
- Uma estrutura física modular.
- Um sistema mecânico que necessita de manutenção.
- Um inventário móvel.
- Um conjunto de máquinas e equipamentos.
- O principal recurso que a equipe precisa proteger.

Os jogadores devem coletar recursos, fabricar componentes, reparar máquinas, combater invasores, administrar combustível e tomar decisões rápidas.

Cada expedição gera situações diferentes em consequência da combinação entre mundo procedural, física, clima, inteligência artificial e decisões dos jogadores.

## 1.2 Fantasia do jogador

O jogador deve sentir que pertence a uma equipe de ferroviários improvisados tentando manter uma locomotiva absurdamente problemática em funcionamento.

Uma pessoa pode estar apagando um incêndio enquanto outra corre para alimentar a caldeira. Simultaneamente, um terceiro jogador tenta impedir invasores de roubar recursos, enquanto o quarto percebe que um vagão acabou de se desconectar.

O objetivo é proporcionar a sensação de que a equipe está constantemente resolvendo crises interdependentes.

## 1.3 Diferencial principal

O diferencial do jogo é a combinação de cinco sistemas:

1. Trem modular com componentes sujeitos a falhas físicas e funcionais.
2. Mundo voxel procedural, interativo e parcialmente destrutível.
3. Jogadores com liberdade para cooperar, improvisar e cometer erros.
4. Eventos emergentes que interagem entre si.
5. Expedições rejogáveis com progressão, alterações no trem e decisões estratégicas.

O jogo não depende exclusivamente de desafios pré-programados. Uma parte importante das situações nasce da interação entre sistemas.

## 1.4 Pilares fundamentais

**Pilar A — Caos compreensível**

As situações podem ser absurdas, mas devem possuir causas identificáveis. O jogador deve compreender por que determinado acidente aconteceu.

**Pilar B — Cooperação espontânea**

O jogo deve favorecer a divisão natural de tarefas, sem exigir classes rígidas.

**Pilar C — Física divertida**

Objetos possuem massa, colisão e comportamento físico. Entretanto, a precisão física pode ser simplificada quando necessário para preservar diversão e desempenho.

**Pilar D — Mundo variável**

Biomas, trajetos, recursos, obstáculos e eventos mudam entre expedições.

**Pilar E — Histórias compartilháveis**

As partidas devem produzir situações engraçadas, surpreendentes e fáceis de compreender em transmissões e vídeos curtos.

**Pilar F — Rejogabilidade significativa**

O jogador retorna porque encontra novas combinações de dificuldades, estratégias e acontecimentos, e não apenas para repetir tarefas em busca de recompensas.

---

# 2. DIREÇÃO ARTÍSTICA — MUNDO 100% VOXEL

## 2.1 Identidade visual

Todos os elementos tridimensionais serão construídos em voxel.

Incluem-se:

- Personagens humanos e criaturas.
- Locomotivas e vagões.
- Árvores, plantas e vegetação.
- Construções e estações.
- Montanhas, solo e cavernas.
- Trilhos, pontes e túneis.
- Ferramentas, armas e máquinas.
- Rochas, minérios e materiais.
- Obstáculos e objetos interativos.
- Efeitos volumétricos estilizados.
- Fragmentos de destruição.

A interface poderá utilizar elementos 2D, mas sua iconografia deverá ser produzida a partir de modelos voxel ou de uma estética visual compatível.

Não serão utilizados personagens bidimensionais como substitutos dos modelos voxel no mundo principal.

## 2.2 Estilo visual

O jogo adota voxel estilizado, com formas legíveis, personagens expressivos e cores marcantes.

Características:

- Geometria cúbica.
- Iluminação suave.
- Sombras simplificadas.
- Contornos visuais claros.
- Materiais simples.
- Alta distinção entre elementos interativos.
- Animações exageradas.
- Explosões e fragmentos cúbicos.
- Baixa complexidade geométrica por objeto.

A prioridade é manter boa leitura visual mesmo com vários personagens, efeitos e objetos se movimentando.

## 2.3 Escala

A escala do mundo será padronizada por unidades lógicas.

Referência inicial:

- 1 bloco de terreno = 1 unidade de mundo.
- Personagem = aproximadamente 2 unidades de altura.
- Largura útil de vagão = 4–6 unidades.
- Comprimento de vagão = 8–12 unidades.
- Trilhos seguem uma malha lógica, mas curvas podem utilizar geometria interpolada.

Esses valores são referências iniciais de prototipação e deverão ser ajustados após testes.

## 2.4 Animação voxel

Personagens terão modelos segmentados em partes.

Exemplos:

- Cabeça.
- Tronco.
- Braços.
- Pernas.
- Mãos.
- Acessórios.

Essas partes poderão ser animadas por hierarquias de transformações, rigs simplificados ou combinações de animações procedurais e pré-definidas.

Estados fundamentais:

- Parado.
- Andando.
- Correndo.
- Pulando.
- Carregando objeto.
- Empurrando.
- Puxando.
- Reparando.
- Construindo.
- Atacando.
- Recebendo impacto.
- Caindo.
- Escorregando.
- Subindo escada.
- Segurando-se no trem.
- Desmaiado.
- Revivido.

As animações deverão representar claramente o estado físico e funcional do personagem.

---

# 3. OBJETIVO E ESTRUTURA DAS PARTIDAS

## 3.1 Objetivo principal

Conduzir o trem através de uma sequência de regiões perigosas até alcançar a estação final da expedição.

Durante a viagem, os jogadores precisam manter o trem operacional.

A vitória ocorre quando:

1. A locomotiva alcança o destino.
2. Seu núcleo de propulsão permanece funcional.
3. Pelo menos um jogador continua operacional ou pode ser resgatado conforme as regras da dificuldade.
4. Os objetivos obrigatórios da rota foram concluídos.

## 3.2 Objetivos secundários

Durante a partida, podem surgir tarefas adicionais:

- Resgatar passageiros.
- Recuperar cargas perdidas.
- Transportar mercadorias frágeis.
- Defender estações.
- Encontrar peças raras.
- Desativar bloqueios.
- Recuperar vagões abandonados.
- Explorar ramificações.
- Evitar descarrilamentos.
- Completar trechos sem danos.
- Alcançar pontos de controle com tempo restante.

Essas tarefas não devem ser obrigatórias em todas as partidas.

## 3.3 Condições de derrota

Uma expedição termina em derrota quando:

- A locomotiva sofre destruição crítica irreversível.
- O trem descarrila sem possibilidade de recuperação.
- Todos os jogadores ficam incapacitados sem recursos para resgate.
- O trem permanece imobilizado além do limite estabelecido para a dificuldade.
- Uma missão obrigatória termina em falha irreversível.

A perda de um vagão comum não provoca derrota imediata.

Essa diferença permite que uma equipe sobreviva mesmo depois de cometer erros graves.

## 3.4 Estrutura de uma expedição

Uma expedição padrão terá cinco fases:

**Fase 1 — Preparação**

A equipe recebe o trem inicial, conhece o destino e organiza ferramentas.

**Fase 2 — Partida**

A locomotiva começa a se movimentar. Surgem os primeiros recursos e pequenos problemas.

**Fase 3 — Escalada**

Aumentam a velocidade, os obstáculos, a complexidade do clima e a atividade dos inimigos.

**Fase 4 — Crise**

Ocorre uma situação de alta pressão, como um túnel em colapso, ataque coordenado ou tempestade extrema.

**Fase 5 — Chegada**

Os jogadores enfrentam o último segmento e tentam alcançar a estação final com os recursos restantes.

A duração e a dificuldade serão ajustadas ao número de jogadores e ao modo escolhido.

---

# 4. CICLO CENTRAL DE JOGABILIDADE

## 4.1 Core gameplay loop

O ciclo principal será:

**Observar → Identificar problemas → Priorizar → Coletar recursos → Executar tarefas → Sobreviver → Melhorar o trem → Enfrentar novos problemas.**

Esse ciclo se repete durante toda a viagem.

## 4.2 Ciclo de curto prazo

Duração aproximada: 5–30 segundos.

Exemplos:

- Identificar vazamento.
- Buscar ferramenta.
- Reparar tubulação.
- Reabastecer máquina.
- Recolher material.
- Expulsar um invasor.
- Reconectar um cabo.
- Desbloquear uma porta.

São ações com feedback visual e sonoro imediato.

## 4.3 Ciclo de médio prazo

Duração aproximada: 1–5 minutos.

Exemplos:

- Preparar a locomotiva para uma tempestade.
- Recuperar recursos suficientes para construir uma melhoria.
- Reparar um vagão danificado.
- Defender a carga de invasores.
- Escolher entre duas rotas.

## 4.4 Ciclo de longo prazo

Duração: uma expedição inteira.

Exemplos:

- Desenvolver uma configuração de trem eficiente.
- Alcançar o destino.
- Manter uma carga especial intacta.
- Sobreviver sem perder vagões.
- Completar objetivos opcionais.

## 4.5 Progressão entre partidas

Ao final da expedição, os jogadores recebem recompensas conforme seu desempenho.

O progresso persistente poderá desbloquear:

- Novas locomotivas iniciais.
- Tipos de vagões.
- Projetos de equipamentos.
- Elementos cosméticos.
- Desafios.
- Modificadores.
- Variações de personagens.

O poder inicial deve permanecer controlado para não eliminar o desafio das partidas.

---

# 5. SISTEMA DA LOCOMOTIVA

## 5.1 Componentes principais

A locomotiva será uma entidade composta por subsistemas.

| Componente | Função | Possível falha |
|---|---|---|
| Motor | Gera força de propulsão | Perda de potência |
| Caldeira | Produz energia mecânica | Superaquecimento |
| Tanque de água | Alimenta o sistema térmico | Falta de água |
| Fornalha | Consome combustível | Apagamento |
| Rodas | Sustentam movimento | Desgaste e travamento |
| Freios | Reduzem velocidade | Falha de frenagem |
| Acoplamento | Liga locomotiva aos vagões | Desconexão |
| Radiador/trocador | Dissipa calor | Aquecimento |
| Gerador auxiliar | Alimenta dispositivos | Falha elétrica |
| Cabine | Contém controles | Controles danificados |

## 5.2 Variáveis principais

A locomotiva possui:

- Integridade geral.
- Integridade de cada subsistema.
- Temperatura.
- Pressão.
- Quantidade de água.
- Combustível.
- Velocidade.
- Massa total.
- Potência.
- Eficiência.
- Aderência.
- Capacidade de frenagem.
- Tensão nos acoplamentos.

As variáveis são interdependentes.

Exemplo:

Pouca água reduz o resfriamento. Isso aumenta a temperatura, que eleva o desgaste e pode provocar falha mecânica.

## 5.3 Movimento contínuo

O trem se desloca automaticamente pelos trilhos enquanto houver condições de propulsão.

Os jogadores não precisam manter um botão pressionado para movimentá-lo.

A velocidade pode ser ajustada por controles.

Faixas funcionais:

- Muito lenta: manutenção e coleta.
- Lenta: movimento seguro.
- Normal: eficiência equilibrada.
- Rápida: maior rendimento de distância.
- Crítica: maior risco de desgaste e descarrilamento.

A equipe pode usar freios de emergência, mas isso provoca consequências, como superaquecimento dos freios ou perda de tempo e combustível.

## 5.4 Falhas encadeadas

Uma falha pode desencadear outros problemas.

Exemplo:

1. Um invasor danifica o tanque de água.
2. O tanque começa a vazar.
3. O resfriamento perde eficiência.
4. O motor superaquece.
5. A potência diminui.
6. O trem perde velocidade.
7. A equipe fica mais exposta a ataques.
8. Um jogador precisa interromper a defesa para efetuar o reparo.

Esse comportamento emergente é fundamental.

---

# 6. SISTEMA DE VAGÕES MODULARES

## 6.1 Estrutura

Cada vagão é uma entidade independente vinculada ao trem por acoplamentos.

Vagões podem possuir:

- Estrutura física.
- Inventário.
- Integridade.
- Massa.
- Portas.
- Dispositivos.
- Componentes interativos.
- Pontos de acoplamento.
- Sistemas específicos.

## 6.2 Tipos de vagão

**Vagão de carga:** armazena materiais e ferramentas.

**Vagão-oficina:** permite fabricar peças e realizar reparos avançados.

**Vagão-tanque:** transporta água ou outros fluidos.

**Vagão-gerador:** fornece energia para sistemas auxiliares.

**Vagão-defesa:** possui barricadas e dispositivos defensivos.

**Vagão-médico:** facilita recuperação de jogadores.

**Vagão-guindaste:** recolhe materiais próximos aos trilhos.

**Vagão-refeitório:** permite fabricar itens de recuperação temporária.

**Vagão-blindado:** resiste melhor a ataques e impactos.

**Vagão-radar:** detecta obstáculos e eventos futuros.

**Vagão de passageiros:** transporta NPCs e oferece missões específicas.

**Vagão-coringa:** recebe módulos customizados.

## 6.3 Conexões

Os vagões são ligados por engates físicos e lógicos.

Cada engate apresenta:

- Estado de conexão.
- Integridade.
- Resistência máxima.
- Tensão.
- Desgaste.
- Travamento.

Caso a tensão supere o limite de resistência, o engate pode romper.

## 6.4 Vagões desconectados

Se um vagão se desconectar:

1. Ele perde a tração da locomotiva.
2. Continua temporariamente por inércia.
3. Sofre desaceleração.
4. Pode colidir, descarrilar ou ficar abandonado.
5. A equipe recebe feedback visual e sonoro.

Dependendo da distância e do cenário, os jogadores podem tentar recuperá-lo.

O trem não deve interromper automaticamente a viagem inteira apenas pela perda de um vagão.

## 6.5 Customização

Antes da expedição, jogadores podem escolher:

- Ordem dos vagões.
- Módulos instalados.
- Capacidade de armazenamento.
- Defesas.
- Equipamentos de reparo.
- Prioridades de energia.

O número de vagões deve ser limitado pelo modo de jogo, desempenho e balanceamento.

---

# 7. FÍSICA E DESCARRILAMENTO

## 7.1 Princípios

A física deve proporcionar situações compreensíveis e interessantes sem simular cada detalhe de uma ferrovia real.

O Rapier WASM será responsável por colisões, corpos rígidos, forças, impulsos e verificações espaciais.

O movimento regular do trem será controlado pelo sistema ferroviário, utilizando um caminho parametrizado e regras de restrição.

Não é necessário simular permanentemente cada roda como um corpo físico livre.

## 7.2 Risco de descarrilamento

O risco aumenta conforme:

- Velocidade.
- Curvatura dos trilhos.
- Massa transportada.
- Distribuição de carga.
- Integridade das rodas.
- Estado dos trilhos.
- Condições climáticas.
- Presença de obstáculos.
- Impactos externos.

## 7.3 Estados de descarrilamento

**Normal:** trem opera dentro dos parâmetros seguros.

**Instável:** ocorre vibração e aparece um aviso.

**Crítico:** efeitos visuais e sonoros indicam risco iminente.

**Descarrilamento parcial:** um vagão sai dos trilhos, podendo ser recuperado.

**Descarrilamento grave:** locomotiva ou vários vagões perdem a trajetória.

## 7.4 Recuperação

O jogo pode oferecer:

- Macacos mecânicos.
- Guinchos.
- Guindastes.
- Ferramentas de realinhamento.
- Reparos emergenciais.
- Reboque por outro vagão.

A recuperação consome recursos e precisa ocorrer antes de determinados limites.

## 7.5 Física de carga

Objetos soltos podem escorregar ou cair.

Distribuição inadequada de carga afeta:

- Estabilidade.
- Frenagem.
- Aceleração.
- Resistência de componentes.

Isso transforma a organização dos vagões em uma decisão estratégica.

---

# 8. MOVIMENTAÇÃO DOS PERSONAGENS

## 8.1 Controle

Perspectiva isométrica com comandos simples:

| Ação | Teclado padrão |
|---|---|
| Movimentar | WASD |
| Interagir | E |
| Correr | Shift |
| Pular | Espaço |
| Usar ferramenta | Botão esquerdo do mouse |
| Largar objeto | G |
| Inventário | Tab |
| Comunicação rápida | Q |
| Zoom | Roda do mouse |
| Rotacionar câmera | Comando configurável |

Todos os comandos deverão aceitar remapeamento e equivalentes para gamepad.

## 8.2 Movimento no trem

Os personagens podem:

- Caminhar dentro dos vagões.
- Subir ao teto.
- Atravessar passarelas.
- Saltar pequenos espaços.
- Escalar escadas.
- Empurrar objetos.
- Carregar recursos.
- Saltar entre vagões próximos.

## 8.3 Risco de queda

Durante curvas, frenagens ou impactos, personagens podem sofrer deslocamentos físicos.

Ao cair do trem:

- O jogador não morre automaticamente.
- Pode tentar alcançá-lo.
- Pode utilizar um cabo de resgate.
- Pode ser recuperado pelos colegas.
- Pode ser reposicionado mediante uma penalidade, conforme o modo.

O design não deve transformar quedas frequentes em longos períodos sem participação.

## 8.4 Interação cooperativa

Algumas tarefas podem ser aceleradas por vários jogadores.

Exemplos:

- Transportar grandes componentes.
- Empurrar vagões.
- Operar guindastes.
- Combater incêndios.
- Sustentar estruturas.
- Reconectar acoplamentos.

A cooperação deve gerar vantagem, mas não tornar cada tarefa impossível para jogadores solo.

---

# 9. RECURSOS E INVENTÁRIO

## 9.1 Recursos básicos

| Recurso | Origem | Utilização |
|---|---|---|
| Madeira | Florestas e construções | Construções simples e combustível emergencial |
| Sucata | Objetos destruídos e depósitos | Reparos e fabricação |
| Carvão | Jazidas e estações | Combustível |
| Água | Lagos, chuva e reservatórios | Caldeira e combate a incêndio |
| Componentes especiais | Missões, ruínas e desafios | Melhorias avançadas |

## 9.2 Inventário individual

Cada personagem possui capacidade limitada de transporte.

Itens maiores podem exigir duas mãos ou movimento reduzido.

O inventário possui slots e limites de peso.

## 9.3 Inventário do trem

Os vagões armazenam recursos por compartimentos.

A distribuição importa, porque um vagão sobrecarregado altera a estabilidade do conjunto.

## 9.4 Coleta

Os recursos podem ser obtidos por:

- Coleta manual.
- Ferramentas.
- Destruição de objetos voxel.
- Mineração.
- Guindastes.
- Dispositivos magnéticos.
- Recompensas de objetivos.
- Estações de abastecimento.

## 9.5 Risco versus recompensa

Recursos valiosos podem aparecer longe dos trilhos ou próximos de ameaças.

A equipe decide entre reduzir a velocidade, enviar alguém para recolher materiais ou continuar a viagem.

Nenhum material essencial deve depender exclusivamente de um evento raro aleatório.

---

# 10. REPAROS E FABRICAÇÃO

## 10.1 Sistema de reparo

Reparos utilizam:

- Ferramenta apropriada.
- Recursos necessários.
- Tempo de execução.
- Acesso físico ao componente.

## 10.2 Tipos de reparo

**Emergencial:** rápido, temporário e menos eficiente.

**Convencional:** restaura parte da integridade.

**Completo:** realizado em oficinas e estações.

**Preventivo:** reduz a probabilidade de falhas futuras.

## 10.3 Minigames de reparo

Determinados reparos possuem interações rápidas:

- Ajustar válvulas.
- Apertar parafusos.
- Conectar cabos.
- Soldar estruturas.
- Alinhar engrenagens.
- Desobstruir tubulações.

O sucesso deve depender principalmente de habilidade e compreensão, não de cliques repetitivos.

## 10.4 Fabricação

O vagão-oficina permite construir:

- Peças mecânicas.
- Engates.
- Ferramentas.
- Reservatórios.
- Barricadas.
- Defesas.
- Componentes de resgate.
- Melhorias para vagões.

Receitas precisam ser simples de consultar e executar.

---

# 11. MUNDO PROCEDURAL

## 11.1 Estrutura espacial

O mundo é gerado continuamente à frente do trem.

A rota combina:

- Segmentos ferroviários.
- Terrenos voxel.
- Biomas.
- Estruturas.
- Obstáculos.
- Recursos.
- Eventos.
- Áreas de interesse.

## 11.2 Geração por semente

Cada expedição recebe uma seed.

A mesma seed, com a mesma versão das regras e configurações, deverá reproduzir a estrutura básica do mapa.

Eventos dependentes de ações dos jogadores e decisões de IA podem apresentar resultados diferentes.

## 11.3 Rede ferroviária

Os trilhos são representados por um grafo procedural.

Elementos possíveis:

- Retas.
- Curvas.
- Pontes.
- Túneis.
- Subidas.
- Descidas.
- Cruzamentos.
- Bifurcações.
- Pátios.
- Estações.

O gerador deve verificar conectividade e existência de trajetos viáveis.

Nenhuma rota obrigatória pode depender de uma passagem fisicamente impossível.

## 11.4 Escolha de rota

Algumas bifurcações apresentam alternativas.

Exemplo:

**Rota A:** curta, com risco elevado de avalanche.

**Rota B:** longa, com abundância de carvão.

**Rota C:** perigosa, com recompensa especial.

A escolha pode ser feita pelo condutor ou por votação da equipe, dependendo das configurações do lobby.

## 11.5 Pontos de interesse

Possibilidades:

- Minas abandonadas.
- Pontes danificadas.
- Depósitos.
- Estações destruídas.
- Aldeias.
- Postos de abastecimento.
- Ruínas.
- Túneis bloqueados.
- Acampamentos hostis.
- Ferrovias antigas.

---

# 12. BIOMAS

## 12.1 Floresta Temperada

Dificuldade inicial baixa.

Elementos:

- Árvores.
- Rios.
- Madeiras.
- Animais.
- Trechos com vegetação densa.

Eventos:

- Árvores caindo.
- Animais nos trilhos.
- Pequenos incêndios.

## 12.2 Deserto

Desafios térmicos e baixa disponibilidade de água.

Elementos:

- Dunas voxel.
- Rochas.
- Tempestades de areia.
- Estações abandonadas.

Eventos:

- Trilhos cobertos.
- Superaquecimento.
- Visibilidade reduzida.

## 12.3 Montanhas

Foco em inclinação e estabilidade.

Elementos:

- Penhascos.
- Túneis.
- Pontes.
- Encostas rochosas.

Eventos:

- Queda de pedras.
- Deslizamentos.
- Curvas perigosas.

## 12.4 Geleira

Foco em aderência e temperaturas baixas.

Elementos:

- Neve.
- Gelo.
- Lagos congelados.
- Túneis gelados.

Eventos:

- Congelamento de válvulas.
- Trilhos escorregadios.
- Tempestades de neve.

## 12.5 Pântano

Foco em terreno instável e criaturas.

Elementos:

- Água rasa.
- Vegetação densa.
- Solo lodoso.
- Pontes antigas.

Eventos:

- Pontes cedendo.
- Bloqueios vegetais.
- Ataques de criaturas.

## 12.6 Região Vulcânica

Foco em calor extremo.

Elementos:

- Lava voxel.
- Rochas instáveis.
- Fumaça.
- Terreno fragmentado.

Eventos:

- Explosões.
- Incêndios.
- Pontes destruídas.
- Superaquecimento.

## 12.7 Biomas especiais

Conteúdo avançado:

- Ferrovia fantasma.
- Deserto elétrico.
- Região de cristais.
- Vale tóxico.
- Floresta bioluminescente.
- Região de ruínas industriais.

Cada bioma deverá introduzir pelo menos um mecanismo que altere decisões, não apenas a aparência.

---

# 13. DESTRUIÇÃO VOXEL

## 13.1 Objetivo

Permitir que jogadores e eventos modifiquem o ambiente de maneira visualmente satisfatória.

## 13.2 Elementos destrutíveis

- Árvores.
- Pedras.
- Barreiras.
- Pontes específicas.
- Objetos.
- Construções.
- Partes de vagões.
- Cobertura de túneis.
- Segmentos de terreno autorizados.

## 13.3 Funcionamento técnico

A destruição será organizada por chunks.

Não será necessário representar cada voxel do mundo como um corpo rígido independente.

Estratégia:

1. Identificar a região modificada.
2. Alterar os dados de voxel.
3. Atualizar a malha da região.
4. Atualizar colisões necessárias.
5. Gerar fragmentos visuais temporários.
6. Sincronizar alterações relevantes pela rede.

## 13.4 Limitações

A destruição precisa respeitar:

- Orçamento de processamento.
- Limite de corpos físicos.
- Orçamento de partículas.
- Consistência de rede.
- Integridade de trechos necessários para o jogo.

Segmentos críticos podem ter regras próprias de destruição e reconstrução.

---

# 14. CLIMA E DESASTRES

## 14.1 Sistema climático

O mundo apresenta:

- Chuva.
- Neve.
- Vento.
- Neblina.
- Tempestades.
- Calor extremo.
- Frio intenso.
- Tempestades elétricas.

## 14.2 Interações sistêmicas

Chuva pode reduzir aderência.

Neve pode aumentar a resistência ao movimento.

Vento pode deslocar objetos leves.

Calor pode aumentar a carga térmica da locomotiva.

Raios podem danificar dispositivos expostos.

## 14.3 Desastres

Eventos especiais incluem:

- Avalanche.
- Deslizamento.
- Enchente.
- Erupção.
- Queda de ponte.
- Incêndio.
- Bloqueio de túnel.
- Tempestade extrema.

## 14.4 Antecipação

Eventos graves devem possuir aviso.

Exemplos:

- Tremores.
- Sons distantes.
- Alterações visuais.
- Mensagens de rádio.
- Alertas dos instrumentos do trem.

A equipe deve ter uma oportunidade razoável de reação.

---

# 15. NPCs E INTELIGÊNCIA ARTIFICIAL

## 15.1 Categorias

**Invasores:** tentam roubar recursos ou danificar equipamentos.

**Saqueadores:** perseguem o trem usando veículos.

**Criaturas:** atacam conforme o bioma.

**Passageiros:** precisam de proteção ou resgate.

**Comerciantes:** oferecem recursos e melhorias.

**Trabalhadores ferroviários:** fornecem missões e reparos.

**Robôs de manutenção:** automatizam tarefas limitadas.

## 15.2 Estados de IA

Estados comuns:

- Patrulhar.
- Observar.
- Investigar.
- Aproximar.
- Perseguir.
- Atacar.
- Sabotar.
- Fugir.
- Procurar cobertura.
- Recuar.
- Retomar atividade.

## 15.3 Navegação

NPCs utilizam navegação contextual.

No terreno, seguem regiões navegáveis.

Dentro do trem, utilizam pontos de passagem, portas e conexões entre vagões.

A navegação precisa considerar que o trem se movimenta e os vagões podem se desconectar.

## 15.4 Dificuldade adaptativa

A intensidade dos ataques pode levar em consideração:

- Número de jogadores.
- Tempo de expedição.
- Integridade do trem.
- Recursos disponíveis.
- Desempenho recente da equipe.

O diretor de eventos deverá reduzir a pressão caso existam várias crises graves simultâneas.

---

# 16. EVENTOS EMERGENTES

## 16.1 Diretor de eventos

Um sistema controla a seleção e a distribuição dos eventos.

Cada evento possui:

- Condições de ativação.
- Biomas compatíveis.
- Nível de ameaça.
- Custo de dificuldade.
- Duração estimada.
- Possibilidades de resolução.
- Recompensa opcional.
- Tempo de recuperação.

## 16.2 Exemplos

**Evento 1 — Incêndio na oficina**

A equipe precisa encontrar a origem e apagar o fogo.

**Evento 2 — Engate danificado**

Um vagão começa a oscilar e pode se desconectar.

**Evento 3 — Invasão de saqueadores**

NPCs tentam carregar caixas para fora do trem.

**Evento 4 — Trilhos bloqueados**

Os jogadores precisam remover obstáculos ou utilizar uma rota alternativa.

**Evento 5 — Carga descontrolada**

Objetos se deslocam durante uma frenagem.

**Evento 6 — Falha na caldeira**

A pressão aumenta e precisa ser estabilizada.

**Evento 7 — Passageiro desaparecido**

Um NPC precisa ser encontrado antes da próxima estação.

**Evento 8 — Chuva de meteoritos voxel**

Pequenos impactos alteram temporariamente o cenário.

**Evento 9 — Trem fantasma**

Uma composição misteriosa percorre trilhos paralelos, produzindo efeitos e possíveis recompensas.

**Evento 10 — Vagão desacoplado**

Uma conexão falha, colocando parte da carga em risco.

## 16.3 Eventos combinados

Eventos podem produzir consequências uns sobre os outros.

Exemplo:

Tempestade → baixa aderência → frenagem de emergência → deslocamento de carga → dano no engate → perda de vagão.

O diretor deve limitar situações impossíveis de resolver.

## 16.4 Controle de intensidade

A partida alterna períodos de baixa e alta pressão.

O objetivo é evitar:

- Monotonia.
- Crises ininterruptas.
- Eventos injustos.
- Longos períodos sem participação.
- Falhas irreversíveis provocadas por azar sem aviso.

---

# 17. COMBATE E DEFESA

## 17.1 Abordagem

O combate é simples e secundário à sobrevivência ferroviária.

A função dos inimigos é criar decisões adicionais para a equipe.

## 17.2 Equipamentos

Exemplos:

- Chave inglesa.
- Martelo.
- Lançador de espuma.
- Canhão de sucata.
- Torre defensiva.
- Armadilha de mola.
- Lançador de redes.

## 17.3 Interação física

Os ataques podem:

- Empurrar.
- Atordoar.
- Deslocar.
- Derrubar.
- Interromper ações.
- Danificar objetos.

## 17.4 Defesa do trem

Os jogadores podem instalar:

- Barreiras.
- Portas reforçadas.
- Alarmes.
- Torres.
- Redes.
- Plataformas de observação.

O excesso de defesas aumenta massa e consumo de recursos, incentivando escolhas estratégicas.

---

# 18. MULTIPLAYER COOPERATIVO

## 18.1 Estrutura

O jogo utiliza integração Steam para:

- Criar lobbies.
- Convidar amigos.
- Procurar partidas.
- Compartilhar parâmetros de sessão.
- Estabelecer conexões de rede compatíveis.

## 18.2 Autoridade

A simulação será coordenada por um host autoritativo.

O host controla:

- Movimento ferroviário.
- Estados físicos críticos.
- Danos.
- Inventário compartilhado.
- IA.
- Eventos.
- Alterações no mundo.
- Resultados das interações.

Clientes enviam comandos, recebem estados e utilizam interpolação e predição onde apropriado.

## 18.3 Escalonamento cooperativo

O jogo não deve exigir uma quantidade exata de jogadores para funcionar.

A dificuldade considera o tamanho da equipe.

Exemplos:

- Menos tarefas simultâneas com dois jogadores.
- Mais recursos e ameaças com grupos maiores.
- Possibilidade de robôs auxiliares no modo solo.
- Ajuste dos tempos de interação coletiva.

## 18.4 Comunicação

Recursos:

- Mensagens rápidas.
- Marcações contextuais.
- Indicadores de pedidos de ajuda.
- Alertas visuais.
- Sinalização de componentes danificados.

Exemplos de comunicação:

- "Preciso de carvão!"
- "Vagão desconectando!"
- "Inimigos na retaguarda!"
- "Freia o trem!"
- "Falta água!"

## 18.5 Reconexão

Quando um jogador perde conexão:

1. O host mantém temporariamente seu estado.
2. Seu personagem pode assumir um estado seguro.
3. O jogador pode reconectar.
4. Recebe um snapshot consistente.
5. Retoma a partida.

A recuperação deve evitar duplicação de recursos ou ações.

## 18.6 Comportamentos abusivos

O jogo oferece:

- Expulsão por votação ou anfitrião, conforme o lobby.
- Permissões para alterações críticas no trem.
- Opção de desativar colisões prejudiciais entre aliados.
- Limites de ações repetitivas.
- Validação de transações de inventário.

O objetivo é preservar o caos divertido sem favorecer sabotagem persistente.

---

# 19. CÂMERA E APRESENTAÇÃO

## 19.1 Câmera padrão

Visão isométrica posicionada acima do trem.

A câmera acompanha o deslocamento longitudinal e apresenta os arredores necessários para antecipar obstáculos.

## 19.2 Controles de câmera

- Zoom.
- Rotação.
- Centralização.
- Acompanhamento do personagem.
- Acompanhamento do trem.
- Inspeção de vagões.

## 19.3 Câmera dinâmica

Eventos podem provocar:

- Pequena vibração.
- Zoom contextual.
- Enquadramento temporário.
- Destaque visual de perigo.

Esses efeitos deverão respeitar configurações de acessibilidade.

## 19.4 Espectadores

O jogo poderá oferecer câmera de espectador para jogadores eliminados ou espectadores autorizados.

No futuro, poderão existir modos específicos para gravação e transmissões.

---

# 20. INTERFACE E HUD

## 20.1 HUD principal

Informações:

- Velocidade do trem.
- Integridade da locomotiva.
- Combustível.
- Água.
- Temperatura.
- Pressão.
- Próxima estação.
- Distância restante.
- Objetivos atuais.
- Alertas de emergência.

## 20.2 Informações contextuais

Ao apontar para componentes:

- Nome.
- Integridade.
- Estado.
- Recursos necessários.
- Possível interação.

## 20.3 Minimapa

O minimapa apresenta:

- Trajeto.
- Bifurcações.
- Estações.
- Jogadores.
- Inimigos detectados.
- Recursos conhecidos.
- Objetivos.

Será construído com tiles e ícones derivados da representação voxel.

## 20.4 Prioridade visual

Alertas são organizados em níveis:

- Informação.
- Atenção.
- Urgente.
- Crítico.

A interface não deve apresentar todos os problemas com a mesma prioridade.

## 20.5 Acessibilidade

O jogo deverá incluir:

- Redimensionamento de HUD.
- Remapeamento de controles.
- Suporte a gamepad.
- Alternativas a sinais puramente cromáticos.
- Ajustes de intensidade de efeitos.
- Redução de movimento de câmera.
- Legendas e indicadores de áudio importantes.
- Configurações de dificuldade.

---

# 21. MODOS DE JOGO

## 21.1 Expedição Padrão

Modo principal.

A equipe deve alcançar a estação final, enfrentando regiões e eventos variáveis.

Duração-alvo: 20–30 minutos.

## 21.2 Expedição Infinita

O mundo continua sendo gerado enquanto o trem permanece funcional.

A dificuldade aumenta por ciclos controlados.

Objetivo: percorrer a maior distância possível.

## 21.3 Desafio Diário

Todos os participantes recebem a mesma seed e as mesmas condições iniciais.

O resultado pode ser comparado por rankings.

A seed diária deve ser definida de maneira consistente e os resultados precisam ser validados conforme o modelo de segurança adotado.

## 21.4 Modo Relaxado

- Menos inimigos.
- Menos eventos graves.
- Menor desgaste.
- Mais recursos.
- Possibilidade de pausas mais frequentes.

## 21.5 Modo Caos

- Mais eventos.
- Maior interação física.
- Fenômenos extremos.
- Combinações imprevisíveis.
- Penalidades configuráveis.

## 21.6 Modo Workshop

Jogadores selecionam cenários e regras criados pela comunidade.

---

# 22. SISTEMA DE PROGRESSÃO

## 22.1 Durante a expedição

Os jogadores melhoram:

- Capacidade do trem.
- Integridade e resistência.
- Eficiência mecânica.
- Sistemas de armazenamento.
- Ferramentas.
- Segurança.
- Capacidade de defesa.

As melhorias têm custos e possíveis desvantagens.

Exemplo:

Uma locomotiva mais potente consome mais combustível.

## 22.2 Progressão permanente

Fora das partidas, desbloqueiam-se:

- Novos tipos de locomotivas.
- Projetos alternativos.
- Opções cosméticas.
- Modificadores de partida.
- Desafios e condições especiais.

## 22.3 Conquistas Steam

Exemplos:

**Último Vagão:** concluir uma expedição após perder um vagão.

**Mecânico Desesperado:** reparar três componentes durante uma crise.

**Sem Freios:** concluir uma expedição sem utilizar frenagem de emergência.

**Tudo Sob Controle:** sobreviver a cinco eventos graves.

**Mestre Ferroviário:** completar uma expedição com todos os vagões intactos.

**Ainda Dá Tempo:** recuperar um vagão separado.

---

# 23. DIREÇÃO DE ÁUDIO

## 23.1 Sons principais

- Rodas sobre os trilhos.
- Apito da locomotiva.
- Vapor.
- Motor.
- Ferramentas.
- Colisões.
- Madeira quebrando.
- Metal deformando.
- Engates.
- Alarmes.
- Explosões.
- Chuva.
- Vento.
- Inimigos.

## 23.2 Áudio espacial

A posição do som ajuda o jogador a localizar problemas.

Exemplos:

- Um vazamento no vagão traseiro produz som vindo da retaguarda.
- Um invasor no teto produz passos na posição correspondente.
- Uma peça solta produz ruídos metálicos localizados.

## 23.3 Música dinâmica

A trilha sonora muda conforme a intensidade.

Estados:

- Viagem tranquila.
- Perigo crescente.
- Emergência.
- Combate.
- Recuperação.
- Chegada.
- Derrota.

---

# 24. DIREÇÃO DE EFEITOS VISUAIS

Os efeitos devem preservar a estética voxel.

Exemplos:

- Partículas cúbicas.
- Fumaça volumétrica simplificada.
- Faíscas em voxel.
- Fragmentos de madeira.
- Fragmentos de metal.
- Chuva estilizada.
- Neve cúbica.
- Fogo voxel.
- Poeira.
- Trilhas de movimento.
- Explosões geométricas.

Os efeitos deverão utilizar pooling, limites dinâmicos e LOD quando aplicável.

---

# 25. STEAM WORKSHOP E MODDING

## 25.1 Objetivo

Permitir que a comunidade expanda o jogo sem modificar o núcleo da engine.

## 25.2 Conteúdo permitido

- Novos mapas.
- Seeds especiais.
- Biomas.
- Locomotivas.
- Vagões.
- Modelos voxel.
- Eventos.
- Regras customizadas.
- Missões.
- Desafios.
- Configurações de dificuldade.
- Elementos cosméticos.

## 25.3 Estrutura de um mod

Um pacote pode conter:

- Manifesto.
- Identificador.
- Versão.
- Dependências.
- Assets.
- Dados de configuração.
- Regras declarativas.
- Metadados de compatibilidade.

## 25.4 Isolamento

Mods não devem acessar diretamente:

- Credenciais.
- APIs de compras.
- Sistema de arquivos arbitrário.
- Operações privilegiadas do Tauri.
- Funções internas de segurança.
- Estado de outros módulos sem autorização.

Conteúdo não confiável precisa passar por validação, restrições de permissões e isolamento apropriado.

## 25.5 Compatibilidade multiplayer

Jogadores devem possuir versões compatíveis dos mods exigidos pela sessão.

O lobby exibirá dependências e eventuais incompatibilidades antes do início.

---

# 26. MONETIZAÇÃO

## 26.1 Modelo principal

Venda do jogo completo na Steam.

## 26.2 Conteúdo opcional

Possíveis itens cosméticos:

- Skins de personagens.
- Pinturas de locomotivas.
- Decorações para vagões.
- Estilos de apito.
- Elementos visuais de celebração.
- Acessórios cosméticos.

Esses elementos não devem oferecer vantagens mecânicas nas partidas.

## 26.3 Steam Inventory

O Steam Inventory pode ser utilizado para gerenciar itens cosméticos compatíveis.

Compras reais devem seguir os mecanismos de autorização e validação exigidos pela Steam.

A confirmação de uma transação não pode depender exclusivamente do cliente ou do host P2P.

---

# 27. INTEGRAÇÃO COMPLETA COM A ENGINE

Todos os 20 módulos e três runtimes serão utilizados.

| ID | Sistema | Responsabilidade no jogo |
|---|---|---|
| `game.steam` | Steamworks e P2P | Lobby, amigos, conquistas e transporte Steam |
| `game.input` | Input Manager | Movimento, ações, ferramentas, controles e gamepad |
| `game.assets` | Asset Pipeline | Modelos voxel, texturas, animações, áudio, cache e gerenciamento de VRAM |
| `game.physics` | Rapier WASM | Colisões, forças, objetos soltos, impactos e descarrilamentos |
| `game.storage` | Persistência | Save/load, progresso, recordes, configurações e checkpoints |
| `game.world` | ECS e cenas | Entidades, componentes, vagões, personagens e mundo |
| `game.ui` | Interface | HUD, menus, inventário, objetivos e alertas |
| `game.anim` | Animação | Máquinas de estado de personagens e objetos mecânicos |
| `game.sprites` | Sistema 2D | Minimapa por tiles, ícones voxel rasterizados e elementos auxiliares 2D |
| `game.audio` | Mixer espacial | Áudio posicional, ambiente e música dinâmica |
| `game.camera` | Câmera | Follow, zoom, rotação, enquadramentos e espectador |
| `game.ai` | IA e navegação | Invasores, animais, passageiros, bots e pathfinding |
| `game.vfx` | Efeitos | Partículas cúbicas, fogo, explosões, decals e pós-processamento |
| `game.terrain` | Procedural e voxels | Biomas, terrenos, relevo e destruição de regiões |
| `game.scripting` | Scripting | Missões, diálogos, regras, eventos e cutscenes |
| `game.streaming` | Streaming e LOD | Chunks, carregamento espacial, descarte e níveis de detalhe |
| `game.overlay` | Desktop Overlay | Painel opcional com status da sessão e ferramentas de espectador |
| `game.security` | Segurança | Profiling, verificação de ações, validações, logs e crash dumps |
| `game.modding` | Workshop | Conteúdo comunitário e substituição controlada de assets |
| `game.monetization` | Steam Inventory | Cosméticos e transações opcionais |
| `game.loop` | Tick fixo | Atualização da simulação |
| `game.render` | Three.js | Renderização 3D voxel |
| `game.net` | Estado multiplayer | Replicação, snapshots e sincronização |

**Princípio arquitetural:** cada módulo oferece capacidades por contratos. Os sistemas de jogabilidade consomem essas capacidades sem depender diretamente da implementação interna de outros módulos.

---

# 28. ARQUITETURA MODULAR DO JOGO

O jogo deverá ser organizado como um conjunto de domínios independentes.

## 28.1 Domínios principais

**Train Domain**
- Locomotive
- Wagon
- Coupling
- Engine
- Boiler
- Fuel
- Brakes
- Derailment

**World Domain**
- Chunk Generation
- Biome Generation
- Rail Graph
- Resource Placement
- World Streaming
- Destruction

**Player Domain**
- Character
- Inventory
- Interaction
- Tools
- Movement
- Recovery

**Survival Domain**
- Damage
- Repair
- Crafting
- Resource Consumption
- Emergency Management

**Encounter Domain**
- NPC Spawning
- NPC Behavior
- Event Director
- Threat Budget
- Objectives

**Session Domain**
- Lobby
- Multiplayer
- Match State
- Scoring
- Progression
- Persistence

## 28.2 Contratos

Cada domínio deve possuir entradas e saídas bem definidas.

Exemplo: um sistema de danos não precisa conhecer a implementação visual de um vagão.

Ele recebe uma referência válida de entidade, tipo de dano e intensidade.

Como resultado, emite um evento de dano aplicado.

Outros sistemas interessados podem reagir:

- O HUD atualiza a integridade.
- O áudio executa um efeito.
- O VFX produz partículas.
- O sistema de reparo disponibiliza uma tarefa.
- A rede replica a alteração.

## 28.3 Separação de simulação e apresentação

O estado do jogo deve existir independentemente da representação visual.

A renderização voxel observa a simulação, mas não determina os resultados.

Essa separação facilita:

- Testes automatizados.
- Multiplayer.
- Substituição de renderizadores.
- Ajustes de desempenho.
- Salvamento.
- Replays.
- Diagnósticos.

## 28.4 Determinismo e sincronização

A simulação utilizará tick fixo.

A geração procedural deverá utilizar seeds e fluxos de aleatoriedade controlados.

Entretanto, a física não deverá depender da reprodução bit a bit idêntica em computadores diferentes.

O estado autoritativo será definido pelo host e distribuído aos clientes.

---

# 29. OTIMIZAÇÃO

O projeto deve ser planejado para computadores de baixo e médio desempenho.

## 29.1 Terreno

- Chunks voxel.
- Geração assíncrona.
- Meshing eficiente.
- Eliminação de faces internas.
- Culling.
- LOD/HLOD.
- Descarregamento de regiões distantes.

## 29.2 Física

- Corpos físicos ativos apenas onde necessário.
- Objetos estáticos agregados.
- Colliders por região.
- Limite de fragmentos físicos.
- Desativação de corpos em repouso.
- Trilhos controlados por simulação de trajetória durante o movimento normal.

## 29.3 Renderização

- Materiais compartilhados.
- Instancing quando aplicável.
- Texturas agrupadas.
- Reutilização de buffers.
- Pool de partículas.
- Sombras configuráveis.
- Limite de luzes dinâmicas.

## 29.4 Rede

- Replicação por relevância.
- Snapshots compactados.
- Eventos confiáveis para ações críticas.
- Interpolação de entidades.
- Atualizações reduzidas para objetos distantes.

## 29.5 Metas iniciais

- 60 FPS desejados em equipamentos de referência compatíveis.
- Modo reduzido visando 30 FPS em computadores modestos.
- Simulação lógica independente da taxa de renderização.
- Sem pausas perceptíveis durante geração de chunks.
- Limite configurável de efeitos físicos e visuais.

As metas deverão ser validadas em hardware real antes de se tornarem requisitos definitivos.

---

# 30. REJOGABILIDADE

O fator replay será sustentado por seis dimensões.

## 30.1 Variação espacial

Cada partida possui trajetos e biomas diferentes.

## 30.2 Variação mecânica

Configurações diferentes de trem alteram estratégias.

## 30.3 Variação de eventos

A combinação de eventos produz novos problemas.

## 30.4 Variação social

Equipes diferentes tomam decisões diferentes.

## 30.5 Desafios e modificadores

Exemplos:

- Sem vagão-oficina.
- Combustível limitado.
- Tempestades constantes.
- Trem especialmente pesado.
- Alta velocidade.
- Invasões frequentes.
- Reparos mais lentos.

## 30.6 Workshop

A comunidade pode criar cenários, regras e desafios adicionais.

O sistema não deve depender exclusivamente de recompensas numéricas para manter interesse.

---

# 31. DESIGN PARA STREAMERS

## 31.1 Momentos espontâneos

Situações com potencial de entretenimento:

- Vagão esquecido.
- Jogador sendo arrastado por uma carga.
- Frenagem desastrosa.
- Equipe trabalhando no problema errado.
- Incêndio durante invasão.
- Recuperação heroica no último instante.
- Construção improvisada.
- Derrota causada por erro coletivo compreensível.

## 31.2 Leitura para espectadores

O espectador precisa compreender rapidamente:

- O objetivo.
- O perigo.
- O estado do trem.
- Quem está executando cada tarefa.
- A consequência dos erros.

## 31.3 Rodadas com encerramento claro

Uma partida precisa possuir:

- Início reconhecível.
- Escalada de problemas.
- Momentos críticos.
- Desfecho.
- Resultado compartilhável.

## 31.4 Ferramentas de transmissão

Funcionalidades desejáveis:

- HUD compacto.
- Modo espectador.
- Câmera livre.
- Replays curtos.
- Estatísticas engraçadas.
- Registro de acontecimentos.
- Overlay de status do trem.
- Painel de objetivos.

---

# 32. PONTUAÇÃO E RESULTADOS

Ao final de cada partida, os jogadores recebem um resumo.

Critérios:

- Distância percorrida.
- Tempo.
- Integridade final.
- Quantidade de vagões preservados.
- Objetivos concluídos.
- Recursos economizados.
- Inimigos repelidos.
- Jogadores resgatados.
- Reparos realizados.

## 32.1 Prêmios humorísticos

Exemplos:

**Herói dos Trilhos:** mais resgates.

**Mecânico Incansável:** mais reparos.

**Mãos de Manteiga:** mais objetos derrubados.

**Pior Dia de Trabalho:** mais acidentes sofridos.

**Carregador Oficial:** maior volume de carga transportada.

Esses títulos são estatísticas humorísticas e não devem penalizar injustamente jogadores que receberam tarefas diferentes.

---

# 33. EXPERIÊNCIA DOS PRIMEIROS 10 MINUTOS

## Minuto 0–2

O jogador entra no lobby e participa da configuração inicial.

Conhece os controles básicos e os vagões.

## Minuto 2–4

A locomotiva começa a viagem.

Jogadores coletam carvão, abastecem a caldeira e aprendem a transportar objetos.

## Minuto 4–6

Surge um pequeno problema mecânico.

A equipe aprende a reparar um componente.

## Minuto 6–8

O primeiro evento externo acontece.

Pode ser uma árvore bloqueando os trilhos ou um pequeno grupo de invasores.

## Minuto 8–10

O trem alcança a primeira bifurcação ou estação.

Os jogadores escolhem uma melhoria ou a próxima rota.

O tutorial deve ocorrer por meio de situações práticas, sem interromper constantemente a partida com textos extensos.

---

# 34. EXEMPLO DE PARTIDA EMERGENTE

Quatro jogadores entram em uma expedição.

A composição inicial possui:

- Locomotiva.
- Vagão de carga.
- Vagão-oficina.
- Vagão-tanque.

### Situação 1

Uma tempestade de neve reduz a aderência.

O condutor diminui a velocidade.

### Situação 2

Um jogador sai para recuperar carvão próximo aos trilhos.

Enquanto isso, outro percebe que a água está acabando.

### Situação 3

Uma criatura invade o vagão de carga.

Um terceiro jogador corre para combatê-la.

### Situação 4

Durante o combate, a criatura atinge caixas de metal.

As caixas escorregam e bloqueiam a passagem.

### Situação 5

O trem entra em uma curva acentuada.

A carga mal distribuída aumenta a tensão do engate.

### Situação 6

O acoplamento do último vagão rompe.

Ninguém percebe imediatamente.

### Situação 7

Ao procurar água, a equipe descobre que o vagão-tanque desapareceu.

O último jogador avista o vagão ficando para trás.

### Situação 8

A equipe utiliza frenagem emergencial.

Dois jogadores tentam recuperar o vagão enquanto os outros mantêm a locomotiva funcional.

### Resultado

Os jogadores recuperam o vagão, mas consomem quase toda a sucata disponível.

Minutos depois surge uma nova dificuldade.

O acontecimento não foi construído como uma sequência rígida de roteiro.

Ele nasceu de sistemas que interagem.

---

# 35. MVP — PRIMEIRO PROTÓTIPO JOGÁVEL

O desenvolvimento deverá começar com uma versão vertical reduzida.

## 35.1 Escopo

- Um bioma voxel.
- Uma locomotiva.
- Dois tipos de vagão.
- Um personagem voxel.
- Movimento básico.
- Física de objetos.
- Sistema simples de combustível.
- Integridade e reparo.
- Trilhos gerados proceduralmente.
- Pequenos obstáculos.
- Uma categoria de inimigo.
- Lobby multiplayer.
- HUD essencial.
- Condição de vitória e derrota.

## 35.2 Objetivo

Validar se a manutenção coletiva de um trem em movimento é divertida.

A primeira versão não precisa possuir todos os biomas, equipamentos e eventos previstos no GDD.

As interfaces dos 23 módulos deverão ser respeitadas desde o início; os recursos comerciais e de comunidade poderão receber implementações completas em etapas posteriores.

## 35.3 Critérios de aprovação

O protótipo deverá demonstrar:

- Movimento estável do trem.
- Personagens caminhando sobre vagões móveis.
- Coleta de recursos.
- Reparos.
- Uma falha mecânica.
- Uma possível desconexão de vagão.
- Um evento externo.
- Sincronização multiplayer funcional.
- Encerramento correto da partida.

---

# 36. FASES DE DESENVOLVIMENTO

## Fase 1 — Fundação

- Registro do jogo no kernel.
- Contratos de domínio.
- Simulação básica.
- Mundo voxel.
- Câmera.
- Input.
- Personagem.
- Locomotiva.

## Fase 2 — Sistemas ferroviários

- Trilhos.
- Movimento.
- Vagões.
- Acoplamentos.
- Falhas.
- Danos.
- Reparo.
- Descarrilamento.

## Fase 3 — Mundo e recursos

- Geração procedural.
- Chunks.
- Streaming.
- Biomas iniciais.
- Recursos.
- Coleta.
- Inventário.
- Fabricação.

## Fase 4 — Gameplay

- Inimigos.
- IA.
- Eventos.
- Clima.
- Missões.
- Objetivos.
- Vitória e derrota.

## Fase 5 — Multiplayer

- Lobby.
- Autoridade do host.
- Replicação.
- Sincronização de física.
- Reconexão.
- Gerenciamento de sessão.

## Fase 6 — Apresentação

- Arte voxel.
- Animações.
- Áudio.
- VFX.
- HUD.
- Câmeras especiais.
- Acessibilidade.

## Fase 7 — Recursos Steam

- Conquistas.
- Workshop.
- Steam Inventory.
- Cosméticos.
- Overlay.
- Recursos sociais.

## Fase 8 — Otimização e lançamento

- Profiling.
- Segurança.
- Testes.
- Ajustes de dificuldade.
- Correção de erros.
- Validação de desempenho.
- Preparação de distribuição.

---

# 37. CRITÉRIOS DE QUALIDADE

O jogo será considerado suficientemente maduro quando atender aos seguintes princípios:

1. Uma expedição pode ser iniciada e concluída sem intervenções de desenvolvimento.
2. Jogadores compreendem suas principais tarefas sem instruções excessivas.
3. As falhas possuem causas observáveis.
4. O sistema não produz continuamente situações impossíveis de resolver.
5. A cooperação oferece vantagens claras.
6. A física contribui para a diversão sem comprometer o controle.
7. A geração procedural entrega rotas válidas.
8. O mundo voxel funciona dentro do orçamento de desempenho.
9. O multiplayer mantém consistência nas ações importantes.
10. As partidas apresentam variação significativa.
11. O Workshop não compromete a integridade da aplicação.
12. O jogo oferece momentos interessantes mesmo quando a equipe perde.

---

# 38. RESUMO FINAL

*Trem Fora de Controle* é um jogo de sobrevivência ferroviária cooperativa baseado em física, geração procedural, manutenção e caos emergente.

Seus principais atrativos são:

- Um trem modular permanentemente em movimento.
- Mundo 100% voxel.
- Terrenos e biomas procedurais.
- Objetos físicos e destruição contextual.
- Sistemas mecânicos interdependentes.
- Reparos e fabricação.
- Falhas e descarrilamentos.
- Invasores controlados por IA.
- Clima dinâmico.
- Cooperatividade multiplayer.
- Eventos imprevisíveis, porém compreensíveis.
- Expedições curtas e rejogáveis.
- Progressão e melhorias.
- Steam Workshop.
- Ferramentas para transmissão e replays.

**Princípio central de design:**

O jogo deve fazer a equipe sentir que tudo está prestes a dar errado, mas que, com improvisação, habilidade e cooperação, ainda é possível chegar à próxima estação.

O sucesso do jogo depende menos da quantidade de conteúdo e mais da qualidade das interações entre seus sistemas.

**Fim do GDD — Versão 1.0.**