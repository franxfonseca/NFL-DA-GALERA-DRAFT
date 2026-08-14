#!/usr/bin/env python3
"""
ETAPA 5 - Captura ao vivo com Playwright.

Abre o mesmo Chromium logado da etapa 1 (reaproveita o perfil de
recon/chrome-profile, entao nao precisa logar de novo na noite do evento),
escuta o websocket da sala de draft (wss://fantasydraft.espn.com/...,
confirmado na etapa 1) e manda cada pick pro servidor via POST /pick -
o MESMO caminho que o modo manual usa. O board nao sabe (nem precisa saber)
que esse pick veio da captura automatica.

Formato dos frames (mapeado na etapa 1, recon/logs/):
    SELECTED <teamId> <playerId> <posId?> [<memberGuid>]  -> um pick aconteceu
    SELECTING <teamId> <tempoMs>                            -> quem esta na vez

So o SELECTED importa aqui. O playerId e o mesmo ID usado no catalogo
(data/players.json), entao o servidor resolve o resto sozinho.

Uso:
    1. Deixe o servidor rodando (python app/server.py)
    2. python capture/watcher.py
    3. Entre na sala de draft na janela que abrir e jogue normalmente

Se o servidor cair ou a rede falhar, o script continua escutando e so
avisa no terminal - nunca trava a captura por causa de um pick que falhou
ao enviar (a regra do projeto e degradacao silenciosa).
"""

import time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

BASE = Path(__file__).parent.parent
PROFILE = BASE / "recon" / "chrome-profile"  # mesmo perfil logado da etapa 1
SERVIDOR = "http://localhost:5000"

# depois de quanto tempo sem NENHUM frame do draft avisar que algo pode ter
# parado - achamos na etapa 1 que o Playwright as vezes para de receber
# eventos sem erro nenhum, entao isso e a rede de seguranca pro operador notar
LIMIAR_SILENCIO_S = 30

_ultimo_frame_ts = time.time()
_ids_ja_enviados = set()  # evita reenviar o mesmo player_id se o frame repetir


def enviar_pick(player_id: str) -> None:
    if player_id in _ids_ja_enviados:
        return
    _ids_ja_enviados.add(player_id)
    try:
        resposta = requests.post(f"{SERVIDOR}/pick", json={"player_id": player_id}, timeout=5)
        dados = resposta.json()
        if dados.get("ok"):
            pick = dados["pick"]
            print(f"  [pick] #{pick['pick']} {pick['nome']} ({pick['posicao']} - {pick['time_nfl']})")
        else:
            print(f"  [erro do servidor] player_id={player_id}: {dados.get('erro')}")
    except Exception as erro:
        print(f"  [falha ao enviar pick] player_id={player_id}: {erro}")


def tratar_frame(payload: str) -> None:
    global _ultimo_frame_ts
    _ultimo_frame_ts = time.time()

    if not isinstance(payload, str):
        return  # frame binario (so o INIT inicial) - nao interessa aqui

    partes = payload.split(" ")
    comando = partes[0]

    if comando == "SELECTED" and len(partes) >= 3:
        player_id = partes[2]
        enviar_pick(player_id)


def ligar_websocket(ws) -> None:
    if "fantasydraft.espn.com" not in ws.url:
        return  # os outros websockets (video/telemetria) nao interessam
    print(f"[ws conectado] {ws.url[:90]}")
    ws.on("framereceived", tratar_frame)


def ligar_pagina(pagina) -> None:
    pagina.on("websocket", ligar_websocket)


def main() -> None:
    with sync_playwright() as p:
        contexto = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=False,
            viewport={"width": 1600, "height": 950},
        )

        contexto.on("page", ligar_pagina)
        pagina = contexto.pages[0] if contexto.pages else contexto.new_page()
        ligar_pagina(pagina)
        vistas = {id(pagina)}
        pagina.goto("https://www.espn.com/fantasy/football/")

        print("=" * 70)
        print("1. Entre na sala de draft nesta janela")
        print("2. Drafte normalmente - cada pick vai sozinho pro board")
        print(f"3. Se ficar {LIMIAR_SILENCIO_S}s sem nenhum frame, aviso aqui")
        print("4. Ctrl+C quando terminar (o modo manual sempre pode assumir)")
        print("=" * 70)

        def rescanear() -> None:
            """Reforco: pega paginas que escaparam do evento 'page'."""
            for pg in contexto.pages:
                if id(pg) not in vistas:
                    vistas.add(id(pg))
                    ligar_pagina(pg)

        try:
            while True:
                time.sleep(5)
                rescanear()
                silencio = time.time() - _ultimo_frame_ts
                if silencio > LIMIAR_SILENCIO_S:
                    print(
                        f"  [AVISO] {int(silencio)}s sem nenhum frame do draft. "
                        f"Se o draft esta ativo, a captura pode ter parado - "
                        f"confira a janela ou passe pro modo manual em /control."
                    )
        except KeyboardInterrupt:
            print("\nEncerrando...")
        finally:
            try:
                contexto.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
