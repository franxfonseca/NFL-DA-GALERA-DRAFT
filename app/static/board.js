// ETAPA 3: board ainda usa polling simples. SSE entra na etapa 6.

const INTERVALO_MS = 1500;
let ultimoEstadoTexto = "";

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

function redesenharBoard(picks) {
    // reconstroi tudo do zero - evita qualquer estado desencontrado entre o
    // que ta na tela e o que veio do servidor (ex: depois de um "desfazer")
    document.querySelectorAll(".coluna-picks").forEach((coluna) => {
        coluna.innerHTML = "";
    });
    for (const pick of picks) {
        const coluna = document.querySelector(`.coluna[data-slot="${pick.slot}"] .coluna-picks`);
        if (coluna) {
            coluna.appendChild(criarCardPick(pick));
        }
    }
}

async function atualizar() {
    try {
        const resposta = await fetch("/estado");
        const estado = await resposta.json();

        // so redesenha se algo realmente mudou - senao a animacao de entrada
        // dos cards ficaria reiniciando a cada 1.5s sem necessidade
        const estadoTexto = JSON.stringify(estado.picks);
        if (estadoTexto === ultimoEstadoTexto) {
            return;
        }
        ultimoEstadoTexto = estadoTexto;

        redesenharBoard(estado.picks);
    } catch (erro) {
        // regra do projeto: falha aqui nao pode aparecer na tela do projetor
        console.error("falha ao buscar /estado:", erro);
    }
}

atualizar();
setInterval(atualizar, INTERVALO_MS);
