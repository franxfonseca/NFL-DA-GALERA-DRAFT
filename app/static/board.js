// ETAPA 3: board ainda usa polling simples. SSE entra na etapa 6.

const INTERVALO_MS = 1500;
let ultimoPickMostrado = 0;

function criarCardPick(pick) {
    const card = document.createElement("div");
    card.className = "pick-card";
    card.style.setProperty("--cor-time", pick.cor_time);

    const img = document.createElement("img");
    img.src = `/img/players/${pick.player_id}.png`;
    img.alt = pick.nome;

    const nome = document.createElement("div");
    nome.className = "nome";
    nome.textContent = pick.nome;

    const info = document.createElement("div");
    info.className = "info";
    info.textContent = `${pick.posicao} - ${pick.time_nfl}`;

    const rodada = document.createElement("div");
    rodada.className = "rodada";
    rodada.textContent = `Rodada ${pick.rodada} - Pick ${pick.pick}`;

    card.append(img, nome, info, rodada);
    return card;
}

async function atualizar() {
    try {
        const resposta = await fetch("/estado");
        const estado = await resposta.json();
        const picks = estado.picks;

        if (picks.length === ultimoPickMostrado) {
            return;
        }

        // picks novos chegaram desde a ultima checagem - so anexa eles
        const novos = picks.slice(ultimoPickMostrado);
        for (const pick of novos) {
            const coluna = document.querySelector(`.coluna[data-slot="${pick.slot}"] .coluna-picks`);
            if (coluna) {
                coluna.appendChild(criarCardPick(pick));
            }
        }
        ultimoPickMostrado = picks.length;
    } catch (erro) {
        // regra do projeto: falha aqui nao pode aparecer na tela do projetor
        console.error("falha ao buscar /estado:", erro);
    }
}

atualizar();
setInterval(atualizar, INTERVALO_MS);
