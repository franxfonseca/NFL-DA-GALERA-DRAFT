# Setup — levar o Draft Night pra outra máquina

Instruções primárias pra quem (Claude Code incluso) for colocar o projeto
pra rodar num computador novo — no caso, o notebook que vai ligar no
projetor na noite do draft. O código veio do GitHub, mas isso sozinho
**não é suficiente**: várias coisas ficam de fora do repositório de
propósito (`.gitignore`) e precisam ser copiadas manualmente do HD.

## 1. Copiar do HD (não estão no GitHub)

Sem esses arquivos o app roda, mas degradado (regra 3 do CLAUDE.md) —
narração cai pro TTS local, fotos caem pra silhueta, captura automática
não funciona:

- **`.env`** — chaves da Groq e da ElevenLabs. Sem isso, sem IA e sem
  narração bonita.
- **`recon/chrome-profile/`** — perfil do Chromium já logado na ESPN.
  Refazer esse login do zero corre o risco de cair de novo no bug da
  "captura silenciosa" (colar URL na barra de endereço quebra o
  Playwright — ver `capture/watcher.py`).
- **`data/img/players/`** e **`data/img/logos/`** — fotos e escudos
  baixados na véspera. Regra 2: nada pode depender de rede durante o
  evento.

Opcional, só economiza créditos de API (não é crítico, o app funciona
sem, so gera de novo):
- **`app/audio_cache/`** — áudios da ElevenLabs já gerados.

## 2. Ambiente Python

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\playwright install chromium
```

O `playwright install` é por máquina — os binários do navegador não vêm
no pip, precisam ser baixados de novo no notebook.

## 3. Zerar o estado antes do evento

Se `app/estado_draft.json` veio junto na cópia do HD, ele tem os picks de
teste feitos durante o desenvolvimento. Apaga o arquivo (ou sobe o
servidor e chama `POST /reset`) antes de começar o ensaio de verdade.

## 4. Subir o servidor

```
.venv\Scripts\python app\server.py
```

Abre `http://localhost:5000/comando` pra ver o índice de todas as
páginas (board, controle, comentários, resultado).

## 5. Antes do draft de verdade

- Etapa 9 do roadmap (`CLAUDE.md`) é o ensaio geral: rodar um mock draft
  inteiro com tudo ligado, incluindo matar o Playwright no meio de
  propósito pra confirmar que o modo manual assume sem drama.
- Confirma que o modo manual (`/control`) sempre funciona, mesmo sem a
  captura automática — é a regra 1, inegociável.
