# Draft Night — App interativo de draft NFL Fantasy

## O que é

App de tela cheia para exibir num projetor durante o draft presencial de uma liga
de 12 pessoas. O draft acontece na plataforma da ESPN; este app **acompanha** e
transforma cada pick num espetáculo (foto, cor do time, narração por voz,
veredito de reach/steal, comentário de IA). Ao final, gera notas e análise.

Roda uma noite só, na rede local, no notebook do dono. Não é produto.

## Regras invioláveis

Estas regras valem mais que qualquer feature. Se uma feature conflita com uma
regra, a feature é cortada.

1. **O modo manual nunca pode ser removido ou desabilitado.**
   Sempre existe um campo onde o operador digita o nome do jogador e o show
   acontece igual. A automação é uma *fonte adicional* de picks, nunca a única.

2. **Nenhum asset depende de rede durante o evento.**
   Fotos, logos, cores e ADP são baixados na véspera e servidos do disco.
   Se algo não foi baixado antes, não aparece na tela.

3. **Degradação silenciosa.**
   Qualquer componente pode falhar sem derrubar o show. IA fora do ar → o pick
   aparece sem comentário. Foto faltando → silhueta genérica. Playwright morreu →
   o operador segue no manual. Nada de tela de erro no projetor.

4. **Ponto de entrada único.**
   Manual e captura automática usam exatamente o mesmo caminho:
   `POST /pick`. O show não sabe (nem precisa saber) de onde o pick veio.

5. **Rápido para receber, lento para revelar.**
   O pick chega em milissegundos, mas a revelação é coreografada em ~5s
   (foto → nome → veredito → comentário). O suspense é desenhado, não acidental.
   Esses segundos também escondem a latência da IA.

## Stack

- **Backend:** Flask, estado em memória (sem banco de dados)
- **Frontend:** um HTML fullscreen, vanilla JS, sem build step
- **Transporte:** Server-Sent Events (`EventSource`) — não websocket, não polling
- **Captura:** Playwright + Chromium com perfil persistente, processo separado
- **Voz:** ElevenLabs (voz "Arnold", 0.9x) — decisão consciente de trocar o
  custo zero original por qualidade de narração. `speechSynthesis` do
  navegador continua como fallback automático se a API falhar/demorar
  (nunca fica em silêncio). Na narração do pick especificamente, o board
  espera até 3s pelo áudio da ElevenLabs (a foto/anúncio já aparecem na tela
  nesse meio tempo) antes de cair pro TTS local — decisão consciente do
  Francisco de abrir mão de parte da latência zero da regra 5 em troca de
  ouvir a voz boa na maioria dos picks
- **IA:** modelo rápido (Groq) para comentário por rodada; modelo maior para análise final
- **Dados:** JSON em disco

Sem Docker, sem deploy, sem banco, sem framework de frontend.

## Estrutura

```
draft-night/
├── CLAUDE.md
├── recon/
│   ├── ws_logger.py        # etapa 1: grava frames brutos
│   └── logs/               # .jsonl do reconhecimento
├── data/
│   ├── players.json        # catálogo (id ESPN, nome, posição, time)
│   ├── adp.json            # ADP congelado na véspera
│   ├── teams.json          # 32 times: cores hex + sigla
│   └── img/
│       ├── players/        # headshots por id
│       ├── logos/
│       └── silhueta.png    # fallback
├── app/
│   ├── server.py           # Flask: POST /pick, GET /stream (SSE)
│   ├── templates/
│   │   ├── board.html      # a tela do projetor
│   │   └── control.html    # painel do operador (manual + override)
│   └── static/
│       ├── board.js
│       ├── board.css
│       └── sfx/
└── capture/
    └── watcher.py          # Playwright → POST /pick
```

## Estado das etapas

- [ ] 1. Fundação e reconhecimento
- [ ] 2. Base de jogadores offline
- [ ] 3. Board + modo manual  ← **linha de corte: daqui pra baixo é upgrade**
- [ ] 4. TTS, reach/steal, coreografia
- [ ] 5. Captura ao vivo com Playwright
- [ ] 6. SSE no lugar do polling
- [ ] 7. Comentarista de IA
- [ ] 8. Análise final e notas
- [ ] 9. Ensaio geral (mock draft com tudo ligado)

## Convenções

- Comentários e nomes de variáveis em português; nomes de bibliotecas em inglês
- Prefira código explícito e legível a código esperto — o dono é iniciante
- Toda chamada externa dentro de `try/except` com fallback definido
- Nada de dependência nova sem necessidade real

## Fora do escopo

- Executar o draft (quem drafta é a ESPN)
- Multi-usuário, contas, autenticação
- Uso após a noite do evento
- Grade automática de times durante o draft (só na análise final)