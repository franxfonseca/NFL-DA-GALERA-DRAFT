// ETAPA 4: coreografia de revelacao (~5s por pick) + TTS + reach/steal.
// ETAPA 6: SSE (/stream) no lugar do polling em /estado - o board so
// atualiza quando o servidor manda, sem ficar perguntando toda hora.

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

// ETAPA 7: analise da IA sobre a RODADA inteira (nao por pick) - chega depois,
// rodando em segundo plano no servidor, so no ultimo pick de cada rodada.
const comentariosRodada = {}; // numero da rodada -> texto

function criarCardPick(pick) {
    const card = document.createElement("div");
    card.className = "pick-card";
    card.dataset.pick = pick.pick;
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

function registrarComentariosRodada(picks) {
    for (const pick of picks) {
        if (pick.fim_de_rodada && pick.comentario_rodada && !comentariosRodada[pick.rodada]) {
            comentariosRodada[pick.rodada] = pick.comentario_rodada;
            // atualiza o rodape fixo assim que a IA responde, sem depender
            // do operador ter visto (ou nao) a tela cheia de revelacao
            atualizarComentarista(pick.rodada, pick.comentario_rodada);
        }
    }
}

const TEMPO_COMENTARISTA_NA_TELA_MS = 2 * 60 * 1000; // 2 minutos
let timerEsconderComentarista = null;

function atualizarComentarista(rodada, texto) {
    document.getElementById("comentarista-rodada").textContent = rodada;
    document.getElementById("comentarista-texto").textContent = texto;
    // "sobe" na tela quando um comentario novo chega - antes disso fica
    // escondido (altura 0), pra dar mais espaco pro board entre uma rodada
    // e outra
    document.getElementById("comentarista").classList.add("mostrar");

    // se um comentario novo chegar antes do anterior sumir, reinicia a
    // contagem - sempre fica 2min a partir do ULTIMO comentario mostrado
    clearTimeout(timerEsconderComentarista);
    timerEsconderComentarista = setTimeout(() => {
        document.getElementById("comentarista").classList.remove("mostrar");
    }, TEMPO_COMENTARISTA_NA_TELA_MS);
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

function narrarPick(urlAudio, textoFallback) {
    // toca o audio "bonito" da ElevenLabs (gerado em background no servidor
    // assim que o pick foi registrado) - se ainda nao tiver pronto ou falhar
    // ao carregar/tocar, cai pro TTS local na hora (nunca fica em silencio)
    if (!urlAudio) {
        falar(textoFallback);
        return;
    }
    const audio = new Audio(urlAudio);
    audio.onerror = () => falar(textoFallback);
    audio.play().catch(() => falar(textoFallback));
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
    // regra do projeto: narracao dispara IMEDIATAMENTE, sem esperar rede -
    // se o audio ElevenLabs desse pick ja estiver pronto (raro, a geracao
    // leva 1-2s), usa ele; senao cai pro TTS local na hora, sem atraso
    narrarPick(pick.audio_pick, `Escolha número ${pick.pick}. ${pick.nome}.`);

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

    await esperar(2000);

    // o resumo da rodada nao aparece em tela cheia - so no rodape fixo
    // (#comentarista), atualizado em segundo plano por registrarComentariosRodada.
    // Isso nao trava nem estende a coreografia desse pick.

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

function processarEstado(estado) {
    atualizarCabecalhos(estado.times || {});
    registrarComentariosRodada(estado.picks);

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
}

// EventSource reconecta sozinho se a conexao cair (comportamento padrao do
// navegador) - nao precisa de logica extra pra isso. Regra do projeto: um
// pick que nao chegou por causa da rede nunca pode travar o resto do show.
const fonte = new EventSource("/stream");
fonte.onmessage = (evento) => {
    try {
        processarEstado(JSON.parse(evento.data));
    } catch (erro) {
        console.error("falha ao processar estado do /stream:", erro);
    }
};
fonte.onerror = (erro) => {
    console.error("conexao SSE caiu, navegador vai tentar reconectar sozinho:", erro);
};
