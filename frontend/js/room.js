const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const username = urlParams.get('user') || 'Anonymous';

if (!roomId) {
    window.location.href = 'index.html';
}

document.getElementById('display-room-code').innerText = roomId;
document.getElementById('display-username').innerText = username;

const clientId = username.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Math.random().toString(36).substr(2, 4);

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}/ws/client/${roomId}/${clientId}`);

let hasVoted = false;
let currentPoll = null;

ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    
    switch(data.type) {
        case 'room_state':
            toggleChatUI(data.state.chat_enabled);
            currentPoll = data.state.poll;
            if (currentPoll) {
                if (currentPoll.status === 'active') {
                    if (hasVoted) {
                        showResults(currentPoll, true);
                    } else {
                        renderVoteUI(currentPoll);
                    }
                } else if (currentPoll.status === 'ended') {
                    showResults(currentPoll, false);
                } else {
                    // status === 'created', waiting for start
                    document.getElementById('waiting-msg').classList.remove('hidden');
                    document.getElementById('vote-section').classList.add('hidden');
                    document.getElementById('results-section').classList.add('hidden');
                }
            }
            break;
        case 'poll_created':
            hasVoted = false;
            currentPoll = data.poll;
            break;
        case 'poll_started':
            if (currentPoll) {
                currentPoll.active = true;
                currentPoll.time = data.time;
                renderVoteUI(currentPoll);
            }
            break;
        case 'timer_update':
            document.getElementById('poll-timer').textContent = data.time;
            break;
        case 'poll_ended':
            showResults(data.results, false);
            break;
        case 'vote_update':
            currentPoll = data.poll;
            if (hasVoted && currentPoll.active) {
                showResults(currentPoll, true);
            }
            break;
        case 'chat_message':
            appendChatMessage(data.client_id, data.text);
            break;
        case 'chat_toggled':
            toggleChatUI(data.enabled);
            break;
    }
};

ws.onclose = () => {
    alert("Connection lost or room missing.");
    window.location.href = 'index.html';
};

function renderVoteUI(poll) {
    document.getElementById('waiting-msg').classList.add('hidden');
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('vote-section').classList.remove('hidden');
    
    document.getElementById('poll-question').textContent = poll.question;
    
    if (poll.time) {
        document.getElementById('poll-timer').textContent = `${poll.time}s remaining`;
        document.getElementById('poll-timer').classList.remove('hidden');
    } else {
        document.getElementById('poll-timer').classList.add('hidden');
    }
    
    const container = document.getElementById('options-container');
    container.innerHTML = '';
    
    poll.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.textContent = opt.text;
        btn.onclick = () => submitVote(opt.id);
        container.appendChild(btn);
    });
    
    document.getElementById('vote-feedback').classList.add('hidden');
}

function submitVote(optId) {
    if(hasVoted) return;
    hasVoted = true;
    
    ws.send(JSON.stringify({ action: 'vote', option_id: optId }));
    
    document.querySelectorAll('.vote-btn').forEach(btn => btn.disabled = true);
    document.getElementById('vote-feedback').classList.remove('hidden');
    
    // Jump to live results immediately
    showResults(currentPoll, true);
}

function showResults(poll, isLive = false) {
    document.getElementById('waiting-msg').classList.add('hidden');
    document.getElementById('vote-section').classList.add('hidden');
    document.getElementById('results-section').classList.remove('hidden');
    
    if (isLive) {
        document.getElementById('results-header-text').textContent = "Live Results Update...";
        document.getElementById('results-header-text').style.color = "var(--primary)";
    } else {
        document.getElementById('results-header-text').textContent = "Poll Ended";
        document.getElementById('results-header-text').style.color = "var(--secondary)";
        document.getElementById('poll-timer').classList.add('hidden'); // ensure timer is gone
    }

    document.getElementById('res-poll-question').textContent = poll.question;
    const container = document.getElementById('results-container');
    container.innerHTML = '';
    
    let totalVotes = 0;
    poll.options.forEach(opt => totalVotes += opt.votes);
    
    poll.options.forEach(opt => {
        const percent = totalVotes === 0 ? 0 : Math.round((opt.votes / totalVotes) * 100);
        const div = document.createElement('div');
        div.className = 'result-item';
        div.innerHTML = `
            <div class="result-label">
                <span>${opt.text}</span>
                <span>${percent}%</span>
            </div>
            <div class="result-bar-bg">
                <div class="result-bar-fill" style="width: ${percent}%"></div>
            </div>
        `;
        container.appendChild(div);
    });
}

document.getElementById('btn-send-chat').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});

function sendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if(text) {
        ws.send(JSON.stringify({ action: 'chat', text: `${username}: ${text}` }));
        input.value = '';
    }
}

function appendChatMessage(sender, text) {
    const msgs = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    
    if (text.includes(': ')) {
        const parts = text.split(': ');
        div.innerHTML = `<span>${parts[0]}:</span> ${parts.slice(1).join(': ')}`;
    } else {
        div.innerHTML = `<span>${sender}:</span> ${text}`;
    }
    
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

function toggleChatUI(enabled) {
    const inputArea = document.getElementById('chat-input-area');
    const disabledMsg = document.getElementById('chat-disabled-msg');
    
    if (enabled) {
        inputArea.classList.remove('hidden');
        disabledMsg.classList.add('hidden');
    } else {
        inputArea.classList.add('hidden');
        disabledMsg.classList.remove('hidden');
    }
}
