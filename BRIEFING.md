# BRIEFING — Draft Night (handoff para o Claude Code)

> Leia este arquivo junto com `CLAUDE.md`. Este aqui explica **por que** as
> decisões foram tomadas; o `CLAUDE.md` define **as regras** do projeto.
> Onde houver conflito, o `CLAUDE.md` vence.

---

## 1. O objetivo

Draft presencial de uma liga de NFL Fantasy com **12 pessoas**, umas 5 delas na
mesma sala. O draft roda na plataforma da **ESPN** (cada um no seu dispositivo).

Quero um app rodando num **notebook ligado numa TV/projetor** que transforme
cada pick num espetáculo:

- Board de 12 colunas preenchendo ao vivo, com foto do jogador e cor do time
- Narração por voz do pick
- Medidor de **Reach/Steal** comparando o pick com o ADP (🔥 ROUBO / 💀 REACH)
- Comentário de IA sobre cada pick
- No final: análise geral do draft com nota por time

Trilha sonora é a música oficial do draft da NFL tocando em loop — não há
walk-up song por manager. Prioridade: **custo zero ou próximo de zero**.

---

## 2. Ambiente

**Windows.** Os dois arquivos iniciais estão em `C:\Users\<usuário>\Downloads`:
`ws_logger.py` e `CLAUDE.md`.

Primeira tarefa do Claude Code: criar a estrutura de pastas do projeto e mover
esses arquivos para os lugares certos (`recon/ws_logger.py` e `CLAUDE.md` na raiz).

Setup:

```
python -m venv .venv
.venv\Scripts\activate
pip install flask playwright requests
playwright install chromium
```

Ajuste necessário no `ws_logger.py`: ele foi escrito assumindo Linux e tem um
comentário sobre `executable_path="/usr/bin/chromium"` — **apagar isso**, no
Windows o Chromium embutido do Playwright é o caminho certo. O resto do script
já usa `pathlib` e funciona sem alteração.

**Sobre o autor:** trabalho por vibe coding e sou iniciante em programação.
Prefira código explícito e legível a código esperto. Explique o que cada parte
faz. Não introduza abstração que eu não vá conseguir depurar sozinho às 23h
com 11 pessoas na sala.

---

## 3. Decisões já tomadas (não reabrir)

| Decisão | Motivo |
|---|---|
| Fica na ESPN | Migrar pro Sleeper não é opção, a liga já está montada |
| Playwright lendo o **websocket** da sala de draft | É o canal onde o pick chega primeiro; entrega JSON estruturado com IDs em vez de texto raspado do DOM |
| **Não** raspar o DOM como plano principal | Quebra se a ESPN mexer no CSS, e obriga casar nome por texto (`Ja'Marr Chase`, `49ers D/ST`, sufixos) |
| **Não** usar polling da API REST da ESPN | Superfície derivada, pode atrasar; e exigiria extrair cookies `espn_s2` e `SWID` |
| Perfil persistente no Chromium | Login manual uma vez só, sem token pra expirar |
| Draftar **dentro** do Chromium do Playwright | Duas sessões da sala de draft na mesma conta ESPN pode dar comportamento estranho — uma sessão só resolve |
| Assets baixados na véspera | Nenhuma foto quebrada na TV por causa de rede |
| ADP congelado num JSON local | Não muda em 24h e é uma dependência a menos ao vivo |
| Catálogo de jogadores via API pública do **Sleeper** | Aberta, sem auth, e cruza os IDs da ESPN — uso a ESPN pra draftar e o Sleeper só pra montar a base |
| SSE em vez de polling | Derruba o delay de ~1s para <100ms; mais simples que websocket no Flask |
| Flask + HTML vanilla | Sem build step, sem banco, sem deploy |

---

## 4. Regras invioláveis

Estão no `CLAUDE.md`, mas repito as duas que mais importam:

1. **O modo manual nunca sai.** Se o pick não aparecer sozinho em ~5s, eu digito
   o nome num campo e o show roda igual. Manual e automação usam o **mesmo**
   `POST /pick` — o show não sabe de onde veio o pick.

2. **Degradação silenciosa.** IA fora do ar → pick sem comentário. Foto faltando
   → silhueta genérica. Playwright morreu → sigo no manual. Nunca uma tela de
   erro no projetor.

---

## 5. Orçamento de latência

Do pick capturado até a tela: **<100ms com SSE**. Praticamente tudo isso é
transporte; parse e render são ruído.

O que **não** dá pra garantir de véspera: quanto a ESPN demora entre registrar o
pick e emitir no websocket. Isso só se mede em mock draft.

**Mas latência mínima não é a meta.** A revelação é coreografada de propósito:

```
pick chega
  ↓  0s   "COM A DÉCIMA QUARTA ESCOLHA..." + foto entra
  ↓  ~2s  nome do jogador + cor do time explodindo na tela
  ↓  ~1s  🔥 ROUBO / 💀 REACH + efeito sonoro
  ↓  ~2s  comentário da IA
```

Esses 5 segundos de teatro são também a janela onde a IA gera o comentário em
background. A narração local (`speechSynthesis`) dispara **imediatamente**,
porque é instantânea e não depende de rede — o silêncio esperando API é o que
denuncia gambiarra.

Regra: **rápido para receber, lento para revelar.**

---

## 6. As 9 etapas

1. **Fundação e reconhecimento** — estrutura, ambiente, e um mock draft só para
   gravar frames brutos do websocket
2. **Base de jogadores offline** — catálogo, ~600 headshots, 32 logos, cores, ADP
3. **Board + modo manual** — 🚩 **linha de corte: se o tempo acabar aqui, já tenho
   um app usável na noite**
4. **TTS, reach/steal, coreografia**
5. **Captura ao vivo com Playwright** — parser escrito em cima dos logs da etapa 1
6. **SSE no lugar do polling**
7. **Comentarista de IA** — modelo rápido, prompt curto, uma chamada por pick
8. **Análise final e notas** — uma chamada só, modelo bom, sem pressa
9. **Ensaio geral** — mock draft com tudo ligado, celular ao lado da TV pra
   comparar atraso percebido, e matar o Playwright de propósito no meio pra
   confirmar que o manual segura

As duas únicas incertezas reais do projeto estão nas etapas 1 e 5. O resto é
código previsível.

---

## 7. Onde estou agora: **etapa 1**

**Parte A — terreno.** Criar estrutura, venv, instalar dependências, posicionar
os dois arquivos. *(é aqui que o Claude Code entra primeiro)*

**Parte B — captura.** Rodar `ws_logger.py`, logar na ESPN na janela que abrir,
entrar num mock draft e draftar normalmente sem debugar nada. Anotar no papel o
que draftei e em que ordem — vira gabarito. Se der, criar uma liga de teste
grátis e rodar o mock dentro dela, que é mais fiel do que o lobby comum.

**Parte C — análise.** Abrir o `.jsonl` e responder:

- Qual URL de websocket carrega os picks? (vão aparecer vários: chat, presença,
  telemetria — só um interessa)
- Achando um jogador que eu draftei, qual é o formato do frame?
- O payload é JSON legível ou vem binário/comprimido? *(se vier binário, o plano
  muda pra interceptar XHR — melhor descobrir agora)*
- Onde está: número do pick, ID do jogador, ID do time/manager?
- O ID de jogador é o ID da ESPN? (confirmar contra o catálogo do Sleeper na etapa 2)
- Existe frame de "on the clock"? Se existir, ganho de graça o gatilho pra
  mostrar quem é o próximo

**Critério de conclusão da etapa 1:** conseguir apontar num arquivo de log e
dizer *"este é o frame do pick, o número da escolha está aqui, o ID do jogador
está aqui."* Com isso, a etapa 5 vira trabalho mecânico. Sem isso, vira aposta.

---

## 8. Pendências

- **Data do draft ainda não definida no planejamento.** Se faltar mais de duas
  semanas, seguir a ordem acima. Se faltar menos de uma, inverter: etapa 3
  primeiro (board bonito no manual), reconhecimento depois — board pela metade
  é pior que automação ausente.
- Escolha do provedor de IA para o comentário por pick (camada gratuita de
  Gemini/Groq, ou API da Claude com modelo pequeno — volume é de ~192 picks
  espalhados em 2-3h, não chega perto de nenhum teto).
- Confirmar se o notebook da noite é o mesmo onde estou desenvolvendo.
