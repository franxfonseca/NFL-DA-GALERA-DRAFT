#!/usr/bin/env python3
"""
ETAPA 2 - Base de jogadores offline.

Roda uma vez, na vespera do draft (precisa de internet). Baixa tudo que o
board vai precisar pra funcionar sem rede na noite do evento:

    data/teams.json          - 32 times: nome, cores, sigla
    data/players.json        - catalogo de jogadores: nome, posicao, time
    data/adp.json            - ADP (posicao media de draft) por jogador
    data/img/logos/*.png     - logo dos 32 times
    data/img/players/*.png   - foto dos jogadores com melhor ADP
    data/img/silhueta.png    - foto generica pra quem nao tem headshot

Fontes, todas publicas e sem autenticacao:
    - Times e logos: site.api.espn.com (API publica de times da ESPN)
    - Jogadores e ADP: lm-api-reads.fantasy.espn.com (API publica que a
      propria ESPN usa pra mostrar rank/ADP no draft; o "id" de cada jogador
      aqui e o MESMO id que aparece no frame SELECTED do websocket da sala -
      ja confirmado na etapa 1 comparando um pick real).
    - Headshots: a.espncdn.com/i/headshots/nfl/players/full/<id>.png

Uso:
    python data/baixar_ativos.py
"""

import json
import time
from pathlib import Path

import requests

BASE = Path(__file__).parent
IMG_PLAYERS = BASE / "img" / "players"
IMG_LOGOS = BASE / "img" / "logos"
IMG_PLAYERS.mkdir(parents=True, exist_ok=True)
IMG_LOGOS.mkdir(parents=True, exist_ok=True)

HEADERS = {"User-Agent": "Mozilla/5.0"}

# Quantos headshots baixar, priorizando quem tem melhor ADP (menor numero).
# O resto do catalogo continua no players.json, so sem foto - cai na
# silhueta generica se alguem draftar um jogador fora desse top N.
QTD_HEADSHOTS = 600

# ESPN usa numeros pra posicao (defaultPositionId). Mapeamento confirmado
# manualmente contra jogadores conhecidos (ex: Josh Allen = 1 = QB).
POSICOES = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "D/ST"}


def baixar_teams() -> dict:
    """Busca os 32 times, grava teams.json e baixa os logos. Retorna
    um dicionario {proTeamId: sigla} pra usar depois no catalogo de jogadores."""
    print("Buscando times...")
    r = requests.get(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=40",
        headers=HEADERS,
        timeout=20,
    )
    r.raise_for_status()
    times_raw = r.json()["sports"][0]["leagues"][0]["teams"]

    teams_json = {}
    id_para_sigla = {}

    for item in times_raw:
        t = item["team"]
        sigla = t["abbreviation"]
        proTeamId = int(t["id"])
        id_para_sigla[proTeamId] = sigla

        teams_json[sigla] = {
            "nome": t["displayName"],
            "cor": "#" + t["color"],
            "cor_alt": "#" + t["alternateColor"],
            "espn_id": proTeamId,
        }

        # primeiro logo da lista e o "full/default", que e o que queremos
        logo_url = t["logos"][0]["href"]
        destino = IMG_LOGOS / f"{sigla.lower()}.png"
        try:
            resp = requests.get(logo_url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            destino.write_bytes(resp.content)
        except Exception as erro:
            print(f"  [falhou] logo {sigla}: {erro}")

    (BASE / "teams.json").write_text(
        json.dumps(teams_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  {len(teams_json)} times salvos em teams.json + logos baixados")
    return id_para_sigla


def baixar_jogadores(id_para_sigla: dict) -> None:
    """Busca o catalogo de jogadores com ADP, grava players.json e adp.json,
    e baixa o headshot dos QTD_HEADSHOTS com melhor ADP."""
    print("Buscando catalogo de jogadores...")
    filtro = {
        "players": {
            "limit": 3000,
            "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "STANDARD"},
        }
    }
    headers = {**HEADERS, "X-Fantasy-Filter": json.dumps(filtro)}
    r = requests.get(
        "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026"
        "/segments/0/leaguedefaults/3?view=kona_player_info",
        headers=headers,
        timeout=30,
    )
    r.raise_for_status()
    jogadores_raw = r.json()["players"]

    players_json = {}
    adp_json = {}

    for item in jogadores_raw:
        p = item["player"]
        jogador_id = str(p["id"])
        posicao = POSICOES.get(p["defaultPositionId"], "?")
        time_sigla = id_para_sigla.get(p["proTeamId"], "FA")
        adp = p.get("ownership", {}).get("averageDraftPosition")

        players_json[jogador_id] = {
            "nome": p["fullName"],
            "posicao": posicao,
            "time": time_sigla,
        }
        if adp:
            adp_json[jogador_id] = adp

    (BASE / "players.json").write_text(
        json.dumps(players_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (BASE / "adp.json").write_text(
        json.dumps(adp_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"  {len(players_json)} jogadores salvos em players.json/adp.json")

    # Prioriza quem tem melhor ADP (menor numero = draftado mais cedo).
    # D/ST nao tem foto de pessoa - pula, o board usa o logo do time.
    ordenados = sorted(adp_json.items(), key=lambda kv: kv[1])
    alvo = [
        jid for jid, _ in ordenados
        if players_json[jid]["posicao"] != "D/ST"
    ][:QTD_HEADSHOTS]

    print(f"Baixando {len(alvo)} headshots...")
    falhas = 0
    for i, jogador_id in enumerate(alvo, start=1):
        destino = IMG_PLAYERS / f"{jogador_id}.png"
        url = f"https://a.espncdn.com/i/headshots/nfl/players/full/{jogador_id}.png"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            destino.write_bytes(resp.content)
        except Exception:
            falhas += 1
        if i % 50 == 0:
            print(f"  {i}/{len(alvo)}...")
        time.sleep(0.05)

    print(f"  headshots concluidos ({falhas} falharam - sem problema, cai na silhueta)")


def baixar_silhueta() -> None:
    """A propria ESPN usa essa imagem quando um jogador nao tem foto -
    e a fonte mais natural pro nosso fallback generico."""
    destino = BASE / "img" / "silhueta.png"
    try:
        resp = requests.get(
            "https://a.espncdn.com/i/headshots/nophoto.png", headers=HEADERS, timeout=15
        )
        resp.raise_for_status()
        destino.write_bytes(resp.content)
        print("Silhueta generica salva.")
    except Exception as erro:
        print(f"  [falhou] silhueta: {erro} - baixe manualmente se precisar")


def main() -> None:
    id_para_sigla = baixar_teams()
    baixar_jogadores(id_para_sigla)
    baixar_silhueta()
    print("Etapa 2 concluida.")


if __name__ == "__main__":
    main()
