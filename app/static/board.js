// ETAPA 3: board ainda usa polling simples. SSE entra na etapa 6.
// ETAPA 4: coreografia de revelacao (~5s por pick) + TTS + reach/steal.

const INTERVALO_MS = 1500;
let ultimoEstadoTexto = "";
let picksConhecidos = null; // null = board ainda nao carregou pela 1a vez

// o navegador so deixa Web Audio tocar de verdade depois de um clique do
// usuario na pagina - o board e uma tela passiva, entao pede isso uma vez
// so no comeco da noite (ver #desbloquear no board.html)
let audioCtx = null;

// voz escolhida pro TTS - fica salva no navegador desse board especifico
// (nao no servidor, porque cada dispositivo tem seu proprio conjunto de vozes)
let vozEscolhida = null;

function popularVozes() {
    const select = document.getElementById("select-voz");
    const vozes = speechSynthesis.getVoices();
    if (!vozes.length) return;

    select.innerHTML = "";
    // vozes em portugues primeiro, e o resto depois
    const ordenadas = [...vozes].sort((a, b) => {
        const aPt = a.lang.startsWith("pt") ? 0 : 1;
        const bPt = b.lang.startsWith("pt") ? 0 : 1;
        return aPt - bPt;
    });
    for (const voz of ordenadas) {
        const opcao = document.createElement("option");
        opcao.value = voz.name;
        opcao.textContent = `${voz.name} (${voz.lang})`;
        select.appendChild(opcao);
    }

    const salva = localStorage.getItem("vozEscolhida");
    if (salva && ordenadas.some((v) => v.name === salva)) {
        select.value = salva;
    }
}

// getVoices() pode vir vazio na primeira chamada e carregar so depois
popularVozes();
speechSynthesis.onvoiceschanged = popularVozes;

document.getElementById("btn-desbloquear").addEventListener("click", () => {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume();
    window.audioCtx = audioCtx; // pra dar F12 e conferir audioCtx.state se o som falhar na hora

    const nomeEscolhido = document.getElementById("select-voz").value;
    vozEscolhida = speechSynthesis.getVoices().find((v) => v.name === nomeEscolhido) || null;
    localStorage.setItem("vozEscolhida", nomeEscolhido);

    document.getElementById("desbloquear").classList.add("escondido");
});

// picks que chegaram e ainda vao passar pela coreografia de revelacao
const filaRevelacao = [];
let revelando = false;

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

function atualizarCabecalhos(times) {
    document.querySelectorAll(".coluna").forEach((coluna) => {
        const slot = coluna.dataset.slot;
        const info = times[slot] || {};
        coluna.querySelector(".nome-time").textContent = info.nome_time || `Time ${slot}`;
        coluna.querySelector(".nome-dono").textContent = info.dono || "";
    });
}

function redesenharBoard(picks) {
    // reconstroi tudo do zero - usado na 1a carga da pagina e depois de um
    // desfazer/reset, onde nao faz sentido rodar a coreografia de novo
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

function adicionarCardNaColuna(pick) {
    const coluna = document.querySelector(`.coluna[data-slot="${pick.slot}"] .coluna-picks`);
    if (coluna) {
        coluna.appendChild(criarCardPick(pick));
    }
}

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function falar(texto) {
    // TTS local via navegador - instantaneo, nao depende de rede.
    // Regra do projeto: falha aqui nao pode travar o show.
    try {
        const utter = new SpeechSynthesisUtterance(texto);
        utter.lang = "pt-BR";
        if (vozEscolhida) {
            utter.voice = vozEscolhida;
        }
        speechSynthesis.speak(utter);
    } catch (erro) {
        console.error("falha no TTS:", erro);
    }
}

function tocarSom(veredito) {
    // beep gerado na hora (Web Audio) - sem depender de arquivo de audio.
    // reaproveita o audioCtx desbloqueado no clique inicial; sem ele, nao
    // tem som (mas o resto da revelacao segue normal - nunca trava o show)
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const ganho = audioCtx.createGain();
        osc.connect(ganho);
        ganho.connect(audioCtx.destination);
        osc.frequency.value = veredito === "roubo" ? 880 : 200;
        osc.type = veredito === "roubo" ? "triangle" : "sawtooth";
        ganho.gain.setValueAtTime(0.15, audioCtx.currentTime);
        ganho.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.6);
    } catch (erro) {
        console.error("falha ao tocar som:", erro);
    }
}

async function revelarPick(pick) {
    const overlay = document.getElementById("revelacao");
    const foto = document.getElementById("rev-foto");
    const numeroPick = document.getElementById("rev-pick");
    const nomeEl = document.getElementById("rev-nome");
    const infoEl = document.getElementById("rev-info");
    const veredictoEl = document.getElementById("rev-veredito");

    // reseta o visual de uma revelacao anterior antes de comecar essa
    foto.classList.remove("revelada");
    nomeEl.classList.remove("mostrar");
    infoEl.classList.remove("mostrar");
    veredictoEl.classList.remove("mostrar");
    veredictoEl.className = "revelacao-veredito";
    veredictoEl.textContent = "";

    numeroPick.textContent = pick.pick;
    foto.src = `/img/players/${pick.player_id}.png`;
    foto.style.setProperty("--cor-time", pick.cor_time);
    nomeEl.textContent = pick.nome;
    infoEl.textContent = `${pick.posicao} - ${pick.time_nfl}`;

    overlay.classList.add("ativa");
    falar(`Escolha número ${pick.pick}. ${pick.nome}.`);

    // 0s: anuncio + foto borrada entrando (ja aconteceu acima)
    await esperar(2000);

    // ~2s: nome e time explodem na tela
    foto.classList.add("revelada");
    nomeEl.classList.add("mostrar");
    infoEl.classList.add("mostrar");
    await esperar(1000);

    // ~1s: veredito reach/steal, se tiver ADP suficiente pra calcular
    if (pick.veredito === "roubo") {
        veredictoEl.textContent = "🔥 ROUBO";
        veredictoEl.classList.add("roubo");
        tocarSom("roubo");
    } else if (pick.veredito === "reach") {
        veredictoEl.textContent = "💀 REACH";
        veredictoEl.classList.add("reach");
        tocarSom("reach");
    }
    veredictoEl.classList.add("mostrar");

    // ~2s: espaco reservado pro comentario da IA (entra na etapa 7)
    await esperar(2000);

    overlay.classList.remove("ativa");
    await esperar(300); // da tempo do fade out antes do proximo pick comecar
}

async function processarFila() {
    if (revelando) return;
    revelando = true;
    while (filaRevelacao.length) {
        const pick = filaRevelacao.shift();
        await revelarPick(pick);
        adicionarCardNaColuna(pick);
    }
    revelando = false;
}

async function atualizar() {
    try {
        const resposta = await fetch("/estado");
        const estado = await resposta.json();

        atualizarCabecalhos(estado.times || {});

        if (picksConhecidos === null) {
            // 1a carga da pagina - mostra o que ja existe direto, sem coreografia
            redesenharBoard(estado.picks);
            picksConhecidos = estado.picks.length;
            ultimoEstadoTexto = JSON.stringify(estado.picks);
            return;
        }

        const estadoTexto = JSON.stringify(estado.picks);
        if (estadoTexto === ultimoEstadoTexto) {
            return;
        }
        ultimoEstadoTexto = estadoTexto;

        if (estado.picks.length < picksConhecidos) {
            // desfazer ou reset - redesenha tudo direto, sem fila de revelacao
            filaRevelacao.length = 0;
            redesenharBoard(estado.picks);
            picksConhecidos = estado.picks.length;
            return;
        }

        // picks novos - entram na fila e sao revelados um de cada vez
        const novos = estado.picks.slice(picksConhecidos);
        filaRevelacao.push(...novos);
        picksConhecidos = estado.picks.length;
        processarFila();
    } catch (erro) {
        // regra do projeto: falha aqui nao pode aparecer na tela do projetor
        console.error("falha ao buscar /estado:", erro);
    }
}

atualizar();
setInterval(atualizar, INTERVALO_MS);
