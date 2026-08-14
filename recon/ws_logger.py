#!/usr/bin/env python3
"""
ETAPA 1 - Reconhecimento do draft da ESPN.

Este script NAO faz parsing e NAO tenta entender nada.
Ele so abre um Chromium e grava tudo que passa pelo websocket
num arquivo .jsonl, pra voce analisar com calma depois.

Uso:
    python ws_logger.py

Depois que abrir:
    1. Faca login na ESPN (so na primeira vez - o perfil fica salvo)
    2. Entre num mock draft
    3. Drafte normalmente, sem se preocupar com o log
    4. Ctrl+C no terminal quando terminar
"""

import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = Path(__file__).parent
LOGDIR = BASE / "logs"
PROFILE = BASE / "chrome-profile"
LOGDIR.mkdir(exist_ok=True)

LOGFILE = LOGDIR / f"recon_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
SHOTDIR = LOGDIR / "shots"
SHOTDIR.mkdir(exist_ok=True)

# URLs de rede que valem a pena registrar (so URL + status, sem corpo)
INTERESSE = ("draft", "league", "player", "fantasy", "games/ffl")

_log = LOGFILE.open("a", encoding="utf-8")


def registrar(tipo: str, dados: dict) -> None:
    """Grava uma linha no log e da flush na hora (pra nao perder nada num crash)."""
    linha = {"ts": time.time(), "hora": time.strftime("%H:%M:%S"), "tipo": tipo}
    linha.update(dados)
    _log.write(json.dumps(linha, ensure_ascii=False, default=str) + "\n")
    _log.flush()


def payload_str(payload) -> str:
    """Frames podem vir como texto ou bytes. Bytes viram hex pra nao quebrar o JSON."""
    if isinstance(payload, bytes):
        return "HEX:" + payload.hex()
    return payload


def ligar_websocket(ws) -> None:
    registrar("ws_abriu", {"url": ws.url})
    ws.on("framereceived", lambda p: registrar("ws_recebeu", {"url": ws.url, "payload": payload_str(p)}))
    ws.on("framesent", lambda p: registrar("ws_enviou", {"url": ws.url, "payload": payload_str(p)}))
    ws.on("close", lambda _: registrar("ws_fechou", {"url": ws.url}))
    print(f"  [ws] {ws.url[:100]}")


def ligar_resposta(resposta) -> None:
    """So registra a URL. Ler o corpo aqui pode travar o navegador."""
    url = resposta.url
    if any(chave in url for chave in INTERESSE):
        registrar("http", {"url": url, "status": resposta.status})


def ligar_pagina(pagina) -> None:
    pagina.on("websocket", ligar_websocket)
    pagina.on("response", ligar_resposta)


def main() -> None:
    with sync_playwright() as p:
        contexto = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=False,
            viewport={"width": 1600, "height": 950},
        )

        # A sala de draft costuma abrir em aba/janela nova - pega essas tambem
        contexto.on("page", ligar_pagina)

        pagina = contexto.pages[0] if contexto.pages else contexto.new_page()
        ligar_pagina(pagina)
        vistas = {id(pagina)}
        pagina.goto("https://www.espn.com/fantasy/football/")

        print("=" * 70)
        print(f"Gravando em: {LOGFILE}")
        print("1. Faca login na ESPN nesta janela")
        print("2. Entre num mock draft e drafte normalmente")
        print("3. Ctrl+C aqui quando terminar")
        print("=" * 70)

        def rescanear() -> None:
            """Reforco: pega paginas que escaparam do evento 'page' (ex.: popup sem opener)."""
            for pg in contexto.pages:
                if id(pg) not in vistas:
                    vistas.add(id(pg))
                    ligar_pagina(pg)

        try:
            while True:
                time.sleep(5)
                rescanear()
                registrar("heartbeat", {"paginas": [p.url for p in contexto.pages]})
                try:
                    contexto.pages[0].screenshot(path=str(SHOTDIR / "ultima.png"))
                except Exception as erro:
                    registrar("screenshot_falhou", {"erro": str(erro)})
        except KeyboardInterrupt:
            print("\nEncerrando...")
        finally:
            _log.close()
            print(f"Log salvo: {LOGFILE}")
            try:
                contexto.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
