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
    GET  /stream        - SSE: manda o estado toda vez que muda (etapa 6)
    GET  /estado        - estado atual do draft, em JSON (fallback/debug manual)
    POST /pick          - registra um pick. Body JSON: {"nome": "..."} ou {"player_id": "..."}
    POST /desfazer       - remove o ultimo pick (engano do operador)
    POST /reset          - zera o draft inteiro
    GET  /img/players/<id>.png  - foto do jogador, cai na silhueta se nao existir
    GET  /img/logos/<sigla>.png - logo do time

Uso:
    python app/server.py
"""

import json
import queue
import re
import threading
import time
from pathlib import Path

import requests
from flask import Flask, Response, abort, jsonify, render_template, request, send_from_directory

BASE = Path(__file__).parent.parent
DATA = BASE / "data"
NUM_TIMES = 12

# quantos picks de diferenca do ADP pra virar veredito (meia rodada)
LIMIAR_VEREDITO = 6


def carregar_env() -> dict:
    """Le o .env na raiz (CHAVE=valor por linha) sem precisar de biblioteca nova."""
    caminho = BASE / ".env"
    variaveis = {}
    if caminho.exists():
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            variaveis[chave.strip()] = valor.strip()
    return variaveis


GROQ_API_KEY = carregar_env().get("GROQ_API_KEY", "")
GROQ_MODELO = "llama-3.1-8b-instant"

app = Flask(__name__)


def carregar_json(nome_arquivo: str) -> dict:
    caminho = DATA / nome_arquivo
    if not caminho.exists():
        return {}
    return json.loads(caminho.read_text(encoding="utf-8"))


JOGADORES = carregar_json("players.json")
TIMES_NFL = carregar_json("teams.json")
ADP = carregar_json("adp.json")


def normalizar(texto: str) -> str:
    """So letras e numeros, minusculo. Assim "Ja'Marr Chase" e "Ja Marr Chase"
    (sem apostrofo, como alguem digitaria ao vivo) caem no mesmo lugar."""
    return re.sub(r"[^a-z0-9]", "", texto.lower())


# indice nome normalizado -> lista de ids (pode ter mais de um jogador com nome parecido)
INDICE_NOMES: dict[str, list[str]] = {}
for _id, _info in JOGADORES.items():
    _chave = normalizar(_info["nome"])
    INDICE_NOMES.setdefault(_chave, []).append(_id)


# Estado do draft inteiro mora em memoria, mas e salvo em disco a cada mudanca.
# Sem isso, um restart do processo (ate um reload do modo debug) apaga o draft
# inteiro - ja aconteceu durante o desenvolvimento e seria bem pior ao vivo.
ARQUIVO_ESTADO = BASE / "app" / "estado_draft.json"

if ARQUIVO_ESTADO.exists():
    estado = json.loads(ARQUIVO_ESTADO.read_text(encoding="utf-8"))
else:
    estado = {"picks": [], "times": {}}
estado.setdefault("times", {})  # {"1": {"nome_time": "...", "dono": "..."}, ...}


def salvar_estado() -> None:
    ARQUIVO_ESTADO.write_text(json.dumps(estado, ensure_ascii=False, indent=2), encoding="utf-8")
    notificar_ouvintes()


# uma fila por cliente conectado em /stream (SSE). Toda mudanca de estado
# manda o estado inteiro pra cada fila - e pouca coisa (no maximo 192 picks),
# nao vale a pena complicar mandando so a diferenca.
_ouvintes: list[queue.Queue] = []


def notificar_ouvintes() -> None:
    dados = json.dumps(estado, ensure_ascii=False)
    for fila in _ouvintes:
        fila.put(dados)


def calcular_rodada_e_slot(numero_pick: int) -> tuple[int, int]:
    """Draft serpentina: rodada impar vai 1->12, rodada par volta 12->1."""
    rodada = (numero_pick - 1) // NUM_TIMES + 1
    posicao_na_rodada = (numero_pick - 1) % NUM_TIMES + 1
    if rodada % 2 == 1:
        slot = posicao_na_rodada
    else:
        slot = NUM_TIMES - posicao_na_rodada + 1
    return rodada, slot


def eh_fim_de_rodada(numero_pick: int) -> bool:
    return numero_pick % NUM_TIMES == 0


def gerar_comentario_rodada(rodada: int) -> str | None:
    """Chama o Groq (gratis, rapido) pra uma analise curta da RODADA inteira,
    no estilo do Tom Brady: saudosista e nostalgico do proprio tempo de jogador,
    sempre comparando tudo com sua carreira e seus 7 aneis de campeao. Roda em
    background - se falhar ou demorar, o show nao espera (degradacao
    silenciosa). Sem chave configurada, nem tenta."""
    if not GROQ_API_KEY:
        return None

    picks_da_rodada = [p for p in estado["picks"] if p["rodada"] == rodada]
    if not picks_da_rodada:
        return None

    def linha(p):
        veredito_txt = {"roubo": "ROUBO", "reach": "REACH"}.get(p["veredito"], "dentro do esperado")
        return f"- Pick {p['pick']}: {p['nome']} ({p['posicao']} - {p['time_nfl']}) - {veredito_txt}"

    lista_picks = "\n".join(linha(p) for p in picks_da_rodada)

    reaches = [p for p in picks_da_rodada if p["veredito"] == "reach"]
    roubos = [p for p in picks_da_rodada if p["veredito"] == "roubo"]

    def nomeia(ps):
        return ", ".join(f"{p['nome']} (pick {p['pick']}, ADP {p['adp']:.1f})" for p in ps)

    if reaches or roubos:
        destaques = "DESTAQUES QUE VOCE PRECISA CITAR NO COMENTARIO:\n"
        if reaches:
            destaques += f"- REACH (escolhido bem antes do ADP): {nomeia(reaches)}\n"
        if roubos:
            destaques += f"- ROUBO (jogador caiu, saiu bem depois do ADP): {nomeia(roubos)}\n"
    else:
        destaques = "Nenhum reach ou roubo grande nessa rodada - mencione que os picks vieram dentro do esperado."

    prompt = (
        "Voce e o Tom Brady comentando um draft de fantasy football. Voce e "
        "saudosista e nostalgico do seu proprio tempo como jogador, sempre "
        "puxando pra sua carreira e seus 7 aneis de campeao do Super Bowl. "
        "Compara os jogadores de hoje com voce mesmo na epoca de ouro, com um "
        "certo orgulho e um pouco de deboche.\n\n"
        f"Analise a RODADA {rodada} de um draft de fantasy football como um "
        "especialista faria de verdade.\n\n"
        f"Picks da rodada:\n{lista_picks}\n\n"
        f"{destaques}\n\n"
        "OBRIGATORIO: cite pelo nome pelo menos um jogador dos destaques acima "
        "e explique por que foi reach ou roubo. Nao fique so no "
        "genérico/nostalgico - traga os nomes. NAO fale os numeros do ADP em "
        "voz alta no comentario, so use isso como contexto pra voce julgar.\n\n"
        "Escreva um paragrafo curto (no maximo 4 linhas), em portugues do "
        "Brasil, na primeira pessoa como o Tom Brady, saudosista e nostalgico "
        "dos seus titulos, mas citando os jogadores especificos. So o "
        "paragrafo, sem introducao, sem aspas."
    )

    try:
        resposta = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            json={
                "model": GROQ_MODELO,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 220,
                "temperature": 0.9,
            },
            timeout=8,
        )
        resposta.raise_for_status()
        # forca UTF-8 explicito - o requests as vezes decodifica errado (Latin-1)
        # quando o header Content-Type do Groq nao declara o charset
        corpo = json.loads(resposta.content.decode("utf-8"))
        return corpo["choices"][0]["message"]["content"].strip()
    except Exception as erro:
        print(f"[comentario de rodada falhou] rodada {rodada}: {erro}")
        return None


def comentar_rodada_em_segundo_plano(numero_pick: int, rodada: int) -> None:
    """Roda numa thread separada pra nao atrasar a resposta do POST /pick -
    a regra do projeto e 'rapido pra receber, lento pra revelar'."""

    def tarefa():
        comentario = gerar_comentario_rodada(rodada)
        if comentario is None:
            return
        # confere de novo - o pick pode ter sido desfeito enquanto a IA pensava
        pick_atual = next((p for p in estado["picks"] if p["pick"] == numero_pick), None)
        if pick_atual is not None:
            pick_atual["comentario_rodada"] = comentario
            salvar_estado()

    threading.Thread(target=tarefa, daemon=True).start()


def calcular_veredito(numero_pick: int, player_id: str) -> tuple[float | None, str | None]:
    """Compara o pick com o ADP: escolhido bem antes do esperado = reach,
    bem depois (jogador "caiu") = roubo. Sem ADP conhecido, sem veredito."""
    adp = ADP.get(player_id)
    if adp is None:
        return None, None

    diferenca = numero_pick - adp
    if diferenca <= -LIMIAR_VEREDITO:
        return adp, "reach"
    if diferenca >= LIMIAR_VEREDITO:
        return adp, "roubo"
    return adp, None


def buscar_jogador_por_id(player_id: str) -> dict | None:
    info = JOGADORES.get(str(player_id))
    if not info:
        return None
    return {"id": str(player_id), **info}


def jogadores_draftados() -> set[str]:
    """IDs de quem ja foi escolhido nesse draft - pra tirar da lista, ninguem
    pode ser draftado duas vezes."""
    return {p["player_id"] for p in estado["picks"]}


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

    draftados = jogadores_draftados()
    disponiveis = [jid for jid in ids if jid not in draftados]

    if not disponiveis:
        nomes = sorted({JOGADORES[i]["nome"] for i in ids})
        return None, f"ja foi draftado: {', '.join(nomes[:3])}"

    if len(disponiveis) > 1:
        nomes = sorted({JOGADORES[i]["nome"] for i in disponiveis})
        return None, f"nome ambiguo, digite mais completo: {', '.join(nomes[:6])}"

    return buscar_jogador_por_id(disponiveis[0]), None


def buscar_candidatos(texto_digitado: str, limite: int = 8) -> list[dict]:
    """Pra alimentar o autocomplete do painel: todos os jogadores cujo nome
    contem o texto digitado, ordenados por ADP (melhor jogador primeiro).
    Quem ja foi draftado nao aparece mais na lista."""
    chave = normalizar(texto_digitado)
    if not chave:
        return []

    draftados = jogadores_draftados()
    ids = {
        jid
        for chave_catalogo, lista_ids in INDICE_NOMES.items()
        if chave in chave_catalogo
        for jid in lista_ids
        if jid not in draftados
    }

    candidatos = [buscar_jogador_por_id(jid) for jid in ids]
    candidatos.sort(key=lambda j: ADP.get(j["id"], 9999))
    return candidatos[:limite]


@app.route("/buscar")
def buscar():
    texto = request.args.get("q", "")
    return jsonify({"resultados": buscar_candidatos(texto)})


@app.route("/")
def board():
    return render_template("board.html", num_times=NUM_TIMES)


@app.route("/control")
def control():
    return render_template("control.html", num_times=NUM_TIMES)


@app.route("/estado")
def get_estado():
    return jsonify(estado)


@app.route("/stream")
def stream():
    """SSE: manda o estado toda vez que muda, sem o board precisar perguntar
    (polling). ETAPA 6 - antes disso o board dava fetch em /estado a cada 1.5s."""
    fila: queue.Queue = queue.Queue()
    _ouvintes.append(fila)

    def gerar():
        try:
            # manda o estado atual assim que conecta, antes de esperar qualquer mudanca
            yield f"data: {json.dumps(estado, ensure_ascii=False)}\n\n"
            while True:
                try:
                    dados = fila.get(timeout=15)
                    yield f"data: {dados}\n\n"
                except queue.Empty:
                    yield ": heartbeat\n\n"  # mantem a conexao viva
        finally:
            _ouvintes.remove(fila)

    return Response(gerar(), mimetype="text/event-stream")


@app.route("/times", methods=["POST"])
def salvar_times():
    """Edita nome do time e/ou dono de um slot. Body: {"slot": 1, "nome_time": "...", "dono": "..."}"""
    dados = request.get_json(silent=True) or {}
    slot = str(dados.get("slot", ""))
    if slot not in {str(n) for n in range(1, NUM_TIMES + 1)}:
        return jsonify({"ok": False, "erro": f"slot invalido: {slot}"}), 400

    info = estado["times"].setdefault(slot, {})
    if "nome_time" in dados:
        info["nome_time"] = dados["nome_time"].strip()
    if "dono" in dados:
        info["dono"] = dados["dono"].strip()

    salvar_estado()
    return jsonify({"ok": True, "times": estado["times"]})


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
        elif jogador["id"] in jogadores_draftados():
            erro = f"{jogador['nome']} ja foi draftado"
    elif nome:
        jogador, erro = buscar_jogador_por_nome(nome)
    else:
        erro = "informe 'nome' ou 'player_id'"

    if erro:
        return jsonify({"ok": False, "erro": erro}), 400

    numero_pick = len(estado["picks"]) + 1
    rodada, slot = calcular_rodada_e_slot(numero_pick)
    time_info = TIMES_NFL.get(jogador["time"], {})
    adp, veredito = calcular_veredito(numero_pick, jogador["id"])
    fim_de_rodada = eh_fim_de_rodada(numero_pick)

    pick = {
        "pick": numero_pick,
        "rodada": rodada,
        "slot": slot,
        "player_id": jogador["id"],
        "nome": jogador["nome"],
        "posicao": jogador["posicao"],
        "time_nfl": jogador["time"],
        "cor_time": time_info.get("cor", "#333333"),
        "adp": adp,
        "veredito": veredito,
        "fim_de_rodada": fim_de_rodada,
        "comentario_rodada": None,
        "ts": time.time(),
    }
    estado["picks"].append(pick)
    salvar_estado()

    if fim_de_rodada:
        comentar_rodada_em_segundo_plano(numero_pick, rodada)

    return jsonify({"ok": True, "pick": pick})


@app.route("/desfazer", methods=["POST"])
def desfazer():
    if not estado["picks"]:
        return jsonify({"ok": False, "erro": "nenhum pick pra desfazer"}), 400
    removido = estado["picks"].pop()
    salvar_estado()
    return jsonify({"ok": True, "removido": removido})


@app.route("/reset", methods=["POST"])
def resetar():
    estado["picks"] = []
    salvar_estado()
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
    # threaded=True e obrigatorio: sem isso, a conexao aberta de /stream
    # (SSE) trava o unico worker do servidor de desenvolvimento e nada mais
    # responde (nem o POST /pick) enquanto o board estiver conectado.
    app.run(host="0.0.0.0", port=5000, debug=True, threaded=True)
