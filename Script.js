/* ========================================================
   FAMILLE JOSEPH — Audio Conferencing App
   Uses WebRTC (via PeerJS) + BroadcastChannel for
   same-origin tab sync, with a simple signaling simulation.
   For production: replace signaling with a WebSocket server.
   ======================================================== */

// ── STATE ──────────────────────────────────────────────
let myName = '';
let myId   = generateId(8);
let roomCode = '';
let isMuted  = false;
let isSpeakerOn = true;
let localStream = null;
let peers = {}; // peerId → RTCPeerConnection
let callStart = null;
let durationTimer = null;
let participants = {}; // id → { name, muted, speaking }
let channel = null;     // BroadcastChannel
let handRaised = false;

// ── UTILS ───────────────────────────────────────────────
function generateId(len) {
  return Math.random().toString(36).substring(2, 2 + len).toUpperCase();
}
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}
function scrollToApp() {
  document.getElementById('app').scrollIntoView({ behavior: 'smooth' });
}
function showCreate() { /* handled by default flow */ }
function showJoin()   { scrollToApp(); /* join flow */ }

// ── IDENTITY ────────────────────────────────────────────
function proceedToLobby() {
  const nameInput = document.getElementById('user-name').value.trim();
  if (!nameInput) { showToast('⚠️ Veuillez entrer votre nom'); return; }
  myName = nameInput;
  document.getElementById('identity-panel').classList.remove('active');
  document.getElementById('lobby-panel').style.display = 'block';
  document.getElementById('greeting-name').textContent = myName.split(' ')[0];
}

function showJoinForm() {
  const jf = document.getElementById('join-form');
  jf.style.display = jf.style.display === 'none' ? 'block' : 'none';
}

// ── MICROPHONE ──────────────────────────────────────────
async function getMic() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return true;
  } catch (e) {
    document.getElementById('mic-modal').classList.remove('hidden');
    return false;
  }
}
async function requestMic() {
  document.getElementById('mic-modal').classList.add('hidden');
  const ok = await getMic();
  if (ok) showToast('🎙️ Microphone autorisé !');
}

// ── CREATE ROOM ──────────────────────────────────────────
async function createRoom() {
  const ok = await getMic();
  if (!ok) return;
  roomCode = generateRoomCode();
  enterRoom();
}

// ── JOIN ROOM ──────────────────────────────────────────
async function joinRoom() {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  if (code.length < 4) { showToast('⚠️ Code invalide'); return; }
  const ok = await getMic();
  if (!ok) return;
  roomCode = code;
  enterRoom();
}

// ── ENTER ROOM ───────────────────────────────────────────
function enterRoom() {
  // Hide lobby, show room
  document.getElementById('lobby-panel').style.display = 'none';
  document.getElementById('room-panel').classList.add('active');
  document.getElementById('live-badge').style.display = 'flex';
  document.getElementById('pcount').style.display = 'block';
  document.getElementById('room-code-display').textContent = roomCode;

  // Add self
  participants[myId] = { name: myName, muted: false, speaking: false, self: true };
  renderParticipants();

  // BroadcastChannel (same browser tabs / site)
  channel = new BroadcastChannel('fj-room-' + roomCode);
  channel.onmessage = handleChannelMessage;

  // Announce join
  broadcast({ type: 'join', id: myId, name: myName });

  // Start audio analysis
  startAudioAnalysis();

  // Timer
  callStart = Date.now();
  durationTimer = setInterval(updateDuration, 1000);

  systemChat('Vous avez rejoint la réunion · Code: ' + roomCode);
  showToast('✅ Réunion rejointe ! Code: ' + roomCode);
}

// ── BROADCAST CHANNEL HANDLING ───────────────────────────
function broadcast(msg) {
  if (channel) channel.postMessage(msg);
}

function handleChannelMessage(event) {
  const msg = event.data;
  if (msg.id === myId) return; // ignore own messages

  if (msg.type === 'join') {
    if (!participants[msg.id]) {
      participants[msg.id] = { name: msg.name, muted: false, speaking: false };
      renderParticipants();
      systemChat(msg.name + ' a rejoint la réunion');
      // Reply with our info
      broadcast({ type: 'presence', id: myId, name: myName, muted: isMuted });
    }
  } else if (msg.type === 'presence') {
    if (!participants[msg.id]) {
      participants[msg.id] = { name: msg.name, muted: msg.muted, speaking: false };
      renderParticipants();
    }
  } else if (msg.type === 'leave') {
    const name = participants[msg.id]?.name || 'Un membre';
    delete participants[msg.id];
    renderParticipants();
    systemChat(name + ' a quitté la réunion');
  } else if (msg.type === 'mute') {
    if (participants[msg.id]) {
      participants[msg.id].muted = msg.muted;
      renderParticipants();
    }
  } else if (msg.type === 'speaking') {
    if (participants[msg.id]) {
      participants[msg.id].speaking = msg.speaking;
      renderParticipants();
    }
  } else if (msg.type === 'chat') {
    addChat(msg.name, msg.text);
  } else if (msg.type === 'hand') {
    systemChat('✋ ' + msg.name + ' lève la main');
  }
}

// ── RENDER PARTICIPANTS ───────────────────────────────────
function renderParticipants() {
  const grid = document.getElementById('participants-grid');
  const count = Object.keys(participants).length;
  grid.innerHTML = '';
  document.getElementById('part-count').textContent = count;
  document.getElementById('pcount-num').textContent = count;
  document.getElementById('info-pcount').textContent = count;

  for (const [id, p] of Object.entries(participants)) {
    const initials = p.name.split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase();
    const tile = document.createElement('div');
    tile.className = 'participant-tile' +
      (p.speaking ? ' speaking' : '') +
      (p.muted ? ' muted' : '');
    tile.innerHTML = `
      <div class="participant-avatar">${initials}</div>
      <div class="participant-name">${p.name}${p.self ? ' (Vous)' : ''}</div>
      <div class="participant-status">${p.speaking ? '🎙️ parle...' : p.muted ? 'silencieux' : '🎧 écoute'}</div>
      ${p.muted ? '<div class="mute-indicator">🔇</div>' : ''}
    `;
    grid.appendChild(tile);
  }
}

// ── AUDIO ANALYSIS (speaking detection) ──────────────────
function startAudioAnalysis() {
  if (!localStream) return;
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(localStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let wasSpeaking = false;

  setInterval(() => {
    if (isMuted) {
      if (wasSpeaking) {
        wasSpeaking = false;
        participants[myId].speaking = false;
        renderParticipants();
        broadcast({ type: 'speaking', id: myId, speaking: false });
      }
      return;
    }
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const speaking = avg > 12;
    if (speaking !== wasSpeaking) {
      wasSpeaking = speaking;
      participants[myId].speaking = speaking;
      renderParticipants();
      broadcast({ type: 'speaking', id: myId, speaking });
    }
  }, 150);
}

// ── CONTROLS ──────────────────────────────────────────────
function toggleMute() {
  isMuted = !isMuted;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  }
  document.getElementById('mute-icon').textContent  = isMuted ? '🔇' : '🎙️';
  document.getElementById('mute-label').textContent = isMuted ? 'Activer' : 'Couper';
  const btn = document.getElementById('mute-btn');
  btn.className = 'ctrl-btn' + (isMuted ? ' muted-btn' : '');
  if (participants[myId]) participants[myId].muted = isMuted;
  renderParticipants();
  broadcast({ type: 'mute', id: myId, muted: isMuted });
}

function toggleSpeaker() {
  isSpeakerOn = !isSpeakerOn;
  document.getElementById('speaker-icon').textContent = isSpeakerOn ? '🔊' : '🔈';
  document.getElementById('speaker-btn').className = 'ctrl-btn' + (isSpeakerOn ? '' : ' muted-btn');
  showToast(isSpeakerOn ? '🔊 Haut-parleur activé' : '🔇 Haut-parleur désactivé');
}

function raiseHand() {
  handRaised = !handRaised;
  if (handRaised) {
    broadcast({ type: 'hand', id: myId, name: myName });
    showToast('✋ Main levée — les autres peuvent vous voir');
  } else {
    showToast('Main baissée');
  }
}

function showInvite() {
  copyCode();
  showToast('📤 Code copié ! Partagez-le pour inviter des membres');
}

function copyCode() {
  navigator.clipboard.writeText(roomCode).then(() => {
    showToast('📋 Code ' + roomCode + ' copié !');
  }).catch(() => {
    prompt('Copiez ce code de réunion:', roomCode);
  });
}

function leaveRoom() {
  broadcast({ type: 'leave', id: myId, name: myName });
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (channel) channel.close();
  clearInterval(durationTimer);
  // Reset UI
  document.getElementById('room-panel').classList.remove('active');
  document.getElementById('live-badge').style.display = 'none';
  document.getElementById('pcount').style.display = 'none';
  participants = {};
  // Show lobby
  document.getElementById('lobby-panel').style.display = 'block';
  showToast('👋 Vous avez quitté la réunion');
}

// ── CHAT ─────────────────────────────────────────────────
function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  addChat(myName, text);
  broadcast({ type: 'chat', id: myId, name: myName, text });
  input.value = '';
}

function addChat(name, text) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-name">${name}: </span><span class="chat-text">${escHtml(text)}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function systemChat(text) {
  const box = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.innerHTML = `<span class="chat-text">— ${text}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── DURATION ──────────────────────────────────────────────
function updateDuration() {
  const secs = Math.floor((Date.now() - callStart) / 1000);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  document.getElementById('call-duration').textContent = m + ':' + s;
}