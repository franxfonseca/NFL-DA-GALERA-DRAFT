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

// mutar so afeta esse navegador (o board continua gerando/recebendo audio
// normal) - fica salvo entre recarregamentos da pagina
let mutado = localStorage.getItem("narracaoMutada") === "1";
let audioNarracaoAtual = null; // ultimo Audio() criado, pra poder parar na hora se mutar no meio da fala

function atualizarBotaoMutar() {
    const botao = document.getElementById("btn-mutar");
    botao.textContent = mutado ? "🔇" : "🔊";
    botao.title = mutado ? "Ativar narração" : "Mutar narração";
    botao.classList.toggle("mutado", mutado);
}

document.getElementById("btn-mutar").addEventListener("click", () => {
    mutado = !mutado;
    localStorage.setItem("narracaoMutada", mutado ? "1" : "0");
    atualizarBotaoMutar();
    if (mutado) {
        // corta na hora qualquer fala em andamento, nao so a proxima
        speechSynthesis.cancel();
        if (audioNarracaoAtual) audioNarracaoAtual.pause();
    }
});

atualizarBotaoMutar();

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

// sempre a versao mais nova e completa do estado - usada pra conferir se o
// audio_pick de um pick ja ficou pronto, sem depender do snapshot antigo
// capturado quando o pick entrou na fila de revelacao
let estadoMaisRecente = null;

// TEMPO_ESPERA_AUDIO_PICK_MS: quanto tempo a narracao de um pick espera pelo
// audio "bonito" da ElevenLabs antes de desistir e usar o TTS local do
// navegador. Escolha consciente do Francisco: o show pode segurar a fala por
// ate 3s (o resto da coreografia - foto borrada, "escolha numero X" - ja
// esta na tela nesse meio tempo), mas nunca fica esperando pra sempre.
const TEMPO_ESPERA_AUDIO_PICK_MS = 3000;
const esperandoAudioPick = new Map(); // numero do pick -> resolve(url|null)

function aguardarAudioPick(numeroPick) {
    const jaPronto = estadoMaisRecente?.picks?.find((p) => p.pick === numeroPick)?.audio_pick;
    if (jaPronto) return Promise.resolve(jaPronto);

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            esperandoAudioPick.delete(numeroPick);
            resolve(null);
        }, TEMPO_ESPERA_AUDIO_PICK_MS);
        esperandoAudioPick.set(numeroPick, (url) => {
            clearTimeout(timer);
            esperandoAudioPick.delete(numeroPick);
            resolve(url);
        });
    });
}

// ETAPA 7: analise da IA sobre a RODADA inteira (nao por pick) - chega depois,
// rodando em segundo plano no servidor, so no ultimo pick de cada rodada.
const comentariosRodada = {}; // numero da rodada -> texto

function criarCardPick(pick) {
    const card = document.createElement("div");
    card.className = "pick-card";
    card.dataset.pick = pick.pick;
    card.style.setProperty("--cor-time", pick.cor_time);

    const img = document.createElement("img");
    img.className = "foto";
    img.src = `/img/players/${pick.player_id}.png`;
    img.alt = pick.nome;

    const texto = document.createElement("div");
    texto.className = "texto";

    const nome = document.createElement("div");
    nome.className = "nome";
    nome.textContent = pick.nome;

    const info = document.createElement("div");
    info.className = "info";
    info.textContent = `${pick.posicao} - ${pick.time_nfl}`;

    const rodada = document.createElement("div");
    rodada.className = "rodada";
    // sem "Rodada X" aqui - ja fica obvio pela posicao vertical na coluna,
    // e o card e estreito demais pra caber o texto inteiro sem cortar
    rodada.textContent = `Pick ${pick.pick}`;

    texto.append(nome, info, rodada);

    const logo = document.createElement("img");
    logo.className = "logo-time";
    logo.src = `/img/logos/${pick.time_nfl}.png`;
    logo.alt = pick.time_nfl;
    // sem logo baixado pra esse time - some em vez de mostrar o icone
    // quebrado (degradacao silenciosa, regra 3 do projeto)
    logo.onerror = () => { logo.style.display = "none"; };

    card.append(img, texto, logo);
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

const TEMPO_COMENTARISTA_NA_TELA_MS = 40 * 1000; // 40 segundos
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
    // so colunas de time de verdade tem data-slot - a coluna de rodadas
    // (a esquerda) nao tem nome-dono, entao fica de fora desse seletor
    document.querySelectorAll(".coluna[data-slot]").forEach((coluna) => {
        const slot = coluna.dataset.slot;
        const info = times[slot] || {};
        coluna.querySelector(".nome-time").textContent = info.nome_time || `Time ${slot}`;
        coluna.querySelector(".nome-dono").textContent = info.dono || "";
    });
}

function redesenharBoard(picks) {
    // reconstroi tudo do zero - usado na 1a carga da pagina e depois de um
    // desfazer/reset, onde nao faz sentido rodar a coreografia de novo.
    // So limpa colunas de time (com data-slot) - a coluna de rodadas (a
    // esquerda) tem a mesma classe .coluna-picks mas nao pode ser limpa aqui
    document.querySelectorAll(".coluna[data-slot] .coluna-picks").forEach((coluna) => {
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
    if (mutado) return;
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
    if (mutado) return;
    if (!urlAudio) {
        falar(textoFallback);
        return;
    }
    const audio = new Audio(urlAudio);
    audioNarracaoAtual = audio;
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
    // a picagem ja aparece na tela na hora (acima), mas a NARRACAO espera
    // ate 3s pelo audio bonito da ElevenLabs antes de cair pro TTS local -
    // nunca fica em silencio, so pode demorar um pouco mais pra falar
    const audioPronto = await aguardarAudioPick(pick.pick);
    narrarPick(audioPronto, `Escolha número ${pick.pick}. ${pick.nome}.`);

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

// da pick 24 em diante (fim da rodada 2), o reveal em tela cheia some -
// as primeiras rodadas sao o momento de suspense, depois disso so atrasa o
// show. O pick continua narrado e aparece no board, so sem a coreografia
const ULTIMA_PICK_COM_REVELACAO_CHEIA = 24;

async function revelarPickSimples(pick) {
    // sem overlay: o card aparece na hora e so a narracao acontece (com a
    // mesma espera de ate 3s pelo audio bonito da ElevenLabs)
    adicionarCardNaColuna(pick);
    const audioPronto = await aguardarAudioPick(pick.pick);
    narrarPick(audioPronto, `Escolha número ${pick.pick}. ${pick.nome}.`);
    await esperar(2000); // da tempo da fala tocar antes do proximo pick da fila
}

async function processarFila() {
    if (revelando) return;
    revelando = true;
    while (filaRevelacao.length) {
        const pick = filaRevelacao.shift();
        if (pick.pick <= ULTIMA_PICK_COM_REVELACAO_CHEIA) {
            await revelarPick(pick);
            adicionarCardNaColuna(pick);
        } else {
            await revelarPickSimples(pick);
        }
    }
    revelando = false;
}

function processarEstado(estado) {
    estadoMaisRecente = estado;
    atualizarCabecalhos(estado.times || {});
    registrarComentariosRodada(estado.picks);

    // resolve esperas pendentes de audio_pick (ver aguardarAudioPick) - o
    // audio pode ter ficado pronto na ElevenLabs enquanto o board esperava
    // pra narrar um pick que estava na fila de revelacao
    for (const pick of estado.picks) {
        if (pick.audio_pick && esperandoAudioPick.has(pick.pick)) {
            esperandoAudioPick.get(pick.pick)(pick.audio_pick);
        }
    }

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
