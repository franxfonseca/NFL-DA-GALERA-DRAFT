#!/usr/bin/env python3
"""
ETAPA 3 - Board + modo manual.

Servidor Flask com estado do draft em memoria (sem banco de dados).

Ponto de entrada unico: POST /pick. O modo manual (painel do operador em
/control) e a captura automatica da etapa 5 vao usar exatamente essa mesma
rota - o board nao sabe (nem precisa saber) de onde o pick veio.

Rotas:
    GET  /            - board pra jogar no projetor
    GET  /control      - painel do operador (modo manual)
    GET  /estado        - estado atual do draft, em JSON (o board da polling nisso)
    POST /pick          - registra um pick. Body JSON: {"nome": "..."} ou {"player_id": "..."}
    POST /desfazer       - remove o ultimo pick (engano do operador)
    POST /reset          - zera o draft inteiro
    GET  /img/players/<id>.png  - foto do jogador, cai na silhueta se nao existir
    GET  /img/logos/<sigla>.png - logo do time

Uso:
    python app/server.py
"""

import json
import re
import time
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory

BASE = Path(__file__).parent.parent
DATA = BASE / "data"
NUM_TIMES = 12

app = Flask(__name__)


def carregar_json(nome_arquivo: str) -> dict:
    caminho = DATA / nome_arquivo
    if not caminho.exists():
        return {}
    return json.loads(caminho.read_text(encoding="utf-8"))


JOGADORES = carregar_json("players.json")
TIMES_NFL = carregar_json("teams.json")


def normalizar(texto: str) -> str:
    """So letras e numeros, minusculo. Assim "Ja'Marr Chase" e "Ja Marr Chase"
    (sem apostrofo, como alguem digitaria ao vivo) caem no mesmo lugar."""
    return re.sub(r"[^a-z0-9]", "", texto.lower())


# indice nome normalizado -> lista de ids (pode ter mais de um jogador com nome parecido)
INDICE_NOMES: dict[str, list[str]] = {}
for _id, _info in JOGADORES.items():
    _chave = normalizar(_info["nome"])
    INDICE_NOMES.setdefault(_chave, []).append(_id)


# Estado do draft inteiro mora aqui, em memoria. Reinicia o processo, reinicia o draft.
estado = {"picks": []}


def calcular_rodada_e_slot(numero_pick: int) -> tuple[int, int]:
    """Draft serpentina: rodada impar vai 1->12, rodada par volta 12->1."""
    rodada = (numero_pick - 1) // NUM_TIMES + 1
    posicao_na_rodada = (numero_pick - 1) % NUM_TIMES + 1
    if rodada % 2 == 1:
        slot = posicao_na_rodada
    else:
        slot = NUM_TIMES - posicao_na_rodada + 1
    return rodada, slot


def buscar_jogador_por_id(player_id: str) -> dict | None:
    info = JOGADORES.get(str(player_id))
    if not info:
        return None
    return {"id": str(player_id), **info}


def buscar_jogador_por_nome(nome_digitado: str) -> tuple[dict | None, str | None]:
    chave = normalizar(nome_digitado)
    ids = INDICE_NOMES.get(chave)

    if not ids:
        # nome incompleto - tenta como substring (ex: "chase" acha "Ja'Marr Chase")
        ids = [
            jid
            for chave_catalogo, lista_ids in INDICE_NOMES.items()
            if chave in chave_catalogo
            for jid in lista_ids
        ]

    if not ids:
        return None, f'nenhum jogador encontrado pra "{nome_digitado}"'

    if len(ids) > 1:
        nomes = sorted({JOGADORES[i]["nome"] for i in ids})
        return None, f"nome ambiguo, digite mais completo: {', '.join(nomes[:6])}"

    return buscar_jogador_por_id(ids[0]), None


@app.route("/")
def board():
    return render_template("board.html", num_times=NUM_TIMES)


@app.route("/control")
def control():
    return render_template("control.html")


@app.route("/estado")
def get_estado():
    return jsonify(estado)


@app.route("/pick", methods=["POST"])
def registrar_pick():
    dados = request.get_json(silent=True) or request.form
    player_id = dados.get("player_id")
    nome = dados.get("nome")

    erro = None
    jogador = None

    if player_id:
        jogador = buscar_jogador_por_id(player_id)
        if not jogador:
            erro = f"id de jogador desconhecido: {player_id}"
    elif nome:
        jogador, erro = buscar_jogador_por_nome(nome)
    else:
        erro = "informe 'nome' ou 'player_id'"

    if erro:
        return jsonify({"ok": False, "erro": erro}), 400

    numero_pick = len(estado["picks"]) + 1
    rodada, slot = calcular_rodada_e_slot(numero_pick)
    time_info = TIMES_NFL.get(jogador["time"], {})

    pick = {
        "pick": numero_pick,
        "rodada": rodada,
        "slot": slot,
        "player_id": jogador["id"],
        "nome": jogador["nome"],
        "posicao": jogador["posicao"],
        "time_nfl": jogador["time"],
        "cor_time": time_info.get("cor", "#333333"),
        "ts": time.time(),
    }
    estado["picks"].append(pick)
    return jsonify({"ok": True, "pick": pick})


@app.route("/desfazer", methods=["POST"])
def desfazer():
    if not estado["picks"]:
        return jsonify({"ok": False, "erro": "nenhum pick pra desfazer"}), 400
    removido = estado["picks"].pop()
    return jsonify({"ok": True, "removido": removido})


@app.route("/reset", methods=["POST"])
def resetar():
    estado["picks"] = []
    return jsonify({"ok": True})


@app.route("/img/players/<player_id>.png")
def img_jogador(player_id):
    caminho = DATA / "img" / "players" / f"{player_id}.png"
    if caminho.exists():
        return send_from_directory(caminho.parent, caminho.name)
    return send_from_directory(DATA / "img", "silhueta.png")


@app.route("/img/logos/<sigla>.png")
def img_logo(sigla):
    caminho = DATA / "img" / "logos" / f"{sigla.lower()}.png"
    if caminho.exists():
        return send_from_directory(caminho.parent, caminho.name)
    abort(404)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
