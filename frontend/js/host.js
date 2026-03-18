const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

if (!roomId) {
    window.location.href = 'index.html';
}

document.getElementById('room-code-display').innerText = roomId;

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}/ws/host/${roomId}`);

let currentPoll = null;

ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    
    switch(data.type) {
        case 'poll_created':
            currentPoll = data.poll;
            showResultsView();
            renderResults();
            break;
        case 'poll_started':
            document.getElementById('poll-status').textContent = "Active";
            document.getElementById('poll-status').className = "poll-status-badge active";
            document.getElementById('btn-start-poll').classList.add('hidden');
            document.getElementById('btn-end-poll').classList.remove('hidden');
            if (!currentPoll.time) {
                document.getElementById('display-timer').textContent = "Infinite (No timer)";
            }
            break;
        case 'timer_update':
            document.getElementById('display-timer').textContent = `${data.time}s remaining`;
            break;
        case 'poll_ended':
            currentPoll = data.results;
            document.getElementById('poll-status').textContent = "Ended";
            document.getElementById('poll-status').className = "poll-status-badge inactive";
            document.getElementById('display-timer').textContent = "Ended";
            document.getElementById('btn-end-poll').classList.add('hidden');
            document.getElementById('btn-new-poll').classList.remove('hidden');
            renderResults();
            break;
        case 'vote_update':
            currentPoll = data.poll;
            renderResults();
            break;
        case 'chat_message':
            appendChatMessage(data.client_id, data.text);
            break;
    }
};

ws.onclose = () => {
    alert("Connection lost. Please refresh or create a new room.");
};

document.getElementById('enable-timer').addEventListener('change', (e) => {
    document.getElementById('poll-time').disabled = !e.target.checked;
    document.getElementById('poll-time').style.opacity = e.target.checked ? "1" : "0.5";
});

document.getElementById('btn-create-poll').addEventListener('click', () => {
    const question = document.getElementById('poll-question').value.trim();
    const optInputs = document.querySelectorAll('.opt-input');
    const options = [];
    optInputs.forEach(input => {
        if(input.value.trim()) options.push(input.value.trim());
    });
    
    // Read the time in minutes and convert to seconds if timer is enabled
    const timerEnabled = document.getElementById('enable-timer').checked;
    const timeInMinutes = parseFloat(document.getElementById('poll-time').value);
    const time = timerEnabled && !isNaN(timeInMinutes) ? Math.round(timeInMinutes * 60) : null;

    if (!question || options.length < 2) {
        alert("Enter a question and at least 2 options.");
        return;
    }

    ws.send(JSON.stringify({
        action: 'create_poll',
        question: question,
        options: options,
        time: time
    }));
});

document.getElementById('btn-start-poll').addEventListener('click', () => {
    ws.send(JSON.stringify({ action: 'start_poll' }));
});

document.getElementById('btn-end-poll').addEventListener('click', () => {
    ws.send(JSON.stringify({ action: 'end_poll' }));
});

document.getElementById('btn-new-poll').addEventListener('click', () => {
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('create-poll-section').classList.remove('hidden');
    document.getElementById('poll-status').textContent = "Inactive";
    document.getElementById('poll-status').className = "poll-status-badge inactive";
    document.getElementById('btn-new-poll').classList.add('hidden');
    document.getElementById('btn-end-poll').classList.add('hidden');
    document.getElementById('poll-question').value = '';
    document.querySelectorAll('.opt-input').forEach(i => i.value = '');
    document.getElementById('display-timer').textContent = '';
});

document.getElementById('toggle-chat').addEventListener('change', (e) => {
    ws.send(JSON.stringify({ action: 'toggle_chat', enabled: e.target.checked }));
});

function showResultsView() {
    document.getElementById('create-poll-section').classList.add('hidden');
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('btn-start-poll').classList.remove('hidden');
    document.getElementById('btn-end-poll').classList.add('hidden');
    document.getElementById('display-question').textContent = currentPoll.question;
    document.getElementById('display-timer').textContent = currentPoll.time ? `${currentPoll.time}s` : "Infinite (No timer)";
}

function renderResults() {
    const container = document.getElementById('results-container');
    container.innerHTML = '';
    
    let totalVotes = 0;
    currentPoll.options.forEach(opt => totalVotes += opt.votes);
    
    currentPoll.options.forEach(opt => {
        const percent = totalVotes === 0 ? 0 : Math.round((opt.votes / totalVotes) * 100);
        
        const div = document.createElement('div');
        div.className = 'result-item';
        div.innerHTML = `
            <div class="result-label">
                <span>${opt.text}</span>
                <span>${opt.votes} (${percent}%)</span>
            </div>
            <div class="result-bar-bg">
                <div class="result-bar-fill" style="width: ${percent}%"></div>
            </div>
        `;
        container.appendChild(div);
    });
}

function appendChatMessage(sender, text) {
    const msgs = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span>${sender}:</span> ${text}`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}
