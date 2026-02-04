(() => {
  // ===== DOM =====
  const boardEl = document.getElementById('board');
  const statusText = document.getElementById('statusText');
  const turnLabel = document.getElementById('turnLabel');
  const turnDot = document.getElementById('turnDot');
  const restartBtn = document.getElementById('restartBtn');
  const clearScoresBtn = document.getElementById('clearScoresBtn');

  const overlay = document.getElementById('overlay');
  const resultTitle = document.getElementById('resultTitle');
  const resultMsg = document.getElementById('resultMsg');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const confettiEl = document.getElementById('confetti');

  const winLine = document.getElementById('winLine');
  const boardWrap = document.getElementById('boardWrap');
  const scoreText = document.getElementById('scoreText');

  // Settings UI
  const settingsBtn = document.getElementById('settingsBtn');
  const sheetOverlay = document.getElementById('sheetOverlay');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');

  const themeSelect = document.getElementById('themeSelect');
  const markStyleSelect = document.getElementById('markStyleSelect');
  const firstPlayerSelect = document.getElementById('firstPlayerSelect');
  const lineThickness = document.getElementById('lineThickness');
  const lineThicknessValue = document.getElementById('lineThicknessValue');
  const soundsToggle = document.getElementById('soundsToggle');
  const reduceMotionToggle = document.getElementById('reduceMotionToggle');

  const resetSettingsBtn = document.getElementById('resetSettingsBtn');

  // ===== Game state =====
  const SIZE = 3;
  const cells = [];
  let board = Array(9).fill(null);
  let turn = 'X';
  let locked = false;

  const score = { X: 0, O: 0, T: 0 };

  const LINES = [
    [0,1,2], [3,4,5], [6,7,8],  // rows
    [0,3,6], [1,4,7], [2,5,8],  // cols
    [0,4,8], [2,4,6],           // diags
  ];

  // ===== Settings state (persisted) =====
  const STORAGE_KEY = 'ttt_settings_v3';

  const defaultSettings = {
    theme: 'dark',           // 'dark' | 'light'
    markStyle: 'solid',      // 'solid' | 'outline' | 'neon'
    firstPlayer: 'X',        // 'X' | 'O'
    winLine: 6,              // 3..10
    sounds: true,
    reduceMotion: false,
  };

  let settings = loadSettings();

  function sanitizeSettings(s){
    const allowedMark = new Set(['solid', 'outline', 'neon']);
    const allowedTheme = new Set(['dark', 'light']);
    const allowedFirst = new Set(['X', 'O']);

    const out = { ...defaultSettings, ...s };

    if (!allowedTheme.has(out.theme)) out.theme = defaultSettings.theme;
    if (!allowedMark.has(out.markStyle)) out.markStyle = defaultSettings.markStyle; // handles old "minimal"
    if (!allowedFirst.has(out.firstPlayer)) out.firstPlayer = defaultSettings.firstPlayer;

    out.winLine = Number(out.winLine);
    if (!Number.isFinite(out.winLine)) out.winLine = defaultSettings.winLine;
    out.winLine = Math.min(10, Math.max(3, out.winLine));

    out.sounds = !!out.sounds;
    out.reduceMotion = !!out.reduceMotion;

    return out;
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultSettings };
      const parsed = JSON.parse(raw);
      return sanitizeSettings(parsed);
    } catch {
      return { ...defaultSettings };
    }
  }

  function saveSettings(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function applySettingsToUI(){
    themeSelect.value = settings.theme;
    markStyleSelect.value = settings.markStyle;
    firstPlayerSelect.value = settings.firstPlayer;
    lineThickness.value = String(settings.winLine);
    lineThicknessValue.textContent = String(settings.winLine);
    soundsToggle.checked = !!settings.sounds;
    reduceMotionToggle.checked = !!settings.reduceMotion;
  }

  function applySettingsToApp(){
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.setAttribute('data-mark-style', settings.markStyle);
    document.documentElement.style.setProperty('--win-line', `${settings.winLine}px`);

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const reduce = settings.reduceMotion || !!prefersReduced;
    document.documentElement.setAttribute('data-reduce-motion', reduce ? 'true' : 'false');

    saveSettings();
  }

  // ===== Sound (tiny WebAudio beeps, optional) =====
  let audioCtx = null;

  function beep(freq = 440, duration = 0.06, type = 'sine', gain = 0.03){
    if (!settings.sounds) return;
    try{
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;

      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

      osc.connect(g);
      g.connect(audioCtx.destination);

      osc.start(t0);
      osc.stop(t0 + duration);
    } catch {
      // ignore
    }
  }

  function clickSound(){ beep(520, 0.04, 'triangle', 0.02); }
  function winSound(){
    beep(660, 0.08, 'sine', 0.03);
    setTimeout(() => beep(880, 0.10, 'sine', 0.03), 90);
  }
  function tieSound(){
    beep(300, 0.10, 'sine', 0.03);
    setTimeout(() => beep(240, 0.10, 'sine', 0.03), 120);
  }

  // ===== Game logic =====
  function buildBoard(){
    boardEl.innerHTML = '';
    cells.length = 0;

    for (let i = 0; i < 9; i++){
      const btn = document.createElement('button');
      btn.className = 'cell';
      btn.type = 'button';
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('aria-label', `Cell ${i+1}`);
      btn.dataset.idx = String(i);

      btn.addEventListener('click', () => onMove(i));
      btn.addEventListener('keydown', (e) => {
        const idx = i;
        const r = Math.floor(idx / SIZE), c = idx % SIZE;
        let nr = r, nc = c;
        if (e.key === 'ArrowUp') nr--;
        if (e.key === 'ArrowDown') nr++;
        if (e.key === 'ArrowLeft') nc--;
        if (e.key === 'ArrowRight') nc++;
        if (nr !== r || nc !== c){
          e.preventDefault();
          if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE){
            const nidx = nr * SIZE + nc;
            cells[nidx].focus();
          }
        }
      });

      cells.push(btn);
      boardEl.appendChild(btn);
    }
  }

  function setTurn(next){
    turn = next;
    turnLabel.textContent = `Turn: ${turn}`;
    turnDot.classList.toggle('x', turn === 'X');
    turnDot.classList.toggle('o', turn === 'O');

    statusText.innerHTML = `Your move: <strong style="color:${turn === 'X' ? 'var(--x)' : 'var(--o)'}">${turn}</strong>`;
  }

  function renderMark(i, mark){
    const el = cells[i];
    el.innerHTML = '';
    const span = document.createElement('span');
    span.className = `mark ${mark.toLowerCase()}`;
    span.textContent = mark; // always stable X/O
    el.appendChild(span);
  }

  function rerenderAllMarks(){
    for (let i = 0; i < board.length; i++){
      if (board[i]) renderMark(i, board[i]);
    }
  }

  function checkWinner(){
    for (const line of LINES){
      const [a,b,c] = line;
      if (board[a] && board[a] === board[b] && board[a] === board[c]){
        return { winner: board[a], line };
      }
    }
    if (board.every(v => v)) return { winner: 'T', line: null };
    return null;
  }

  function disableBoard(disabled){
    locked = disabled;
    for (const el of cells){
      el.classList.toggle('disabled', disabled);
      el.disabled = disabled;
    }
  }

  // ✅ FIXED win line: parent handles translate/rotate, ::before animates scale
  function showWinLine(line){
    winLine.classList.remove('show');
    winLine.style.opacity = '0';

    const [a,b,c] = line;
    const isRow = Math.floor(a/3) === Math.floor(b/3) && Math.floor(b/3) === Math.floor(c/3);
    const isCol = (a%3) === (b%3) && (b%3) === (c%3);

    let rotate = 0;
    let tx = 0, ty = 0;

    if (isRow){
      const row = Math.floor(a/3);
      ty = (-33 + row * 33);
      rotate = 0;
    } else if (isCol){
      const col = a % 3;
      tx = (-33 + col * 33);
      rotate = 90;
    } else {
      rotate = (a === 0) ? 45 : -45;
      tx = 0;
      ty = 0;
    }

    winLine.style.transform = `translate(${tx}%, ${ty}%) rotate(${rotate}deg)`;
    winLine.style.opacity = '1';

    void winLine.offsetWidth;
    winLine.classList.add('show');
  }

  function highlightWinningCells(line){
    for (const idx of line){
      cells[idx].classList.add('win');
    }
  }

  function clearHighlights(){
    for (const el of cells){
      el.classList.remove('win');
    }
    winLine.classList.remove('show');
    winLine.style.transform = '';
    winLine.style.opacity = '0';
  }

  function openModal(title, msg, withConfetti){
    resultTitle.textContent = title;
    resultMsg.textContent = msg;

    confettiEl.innerHTML = '';
    if (withConfetti && document.documentElement.getAttribute('data-reduce-motion') !== 'true'){
      const pieces = 26;
      for (let i=0;i<pieces;i++){
        const s = document.createElement('span');
        const left = Math.random() * 100;
        const delay = Math.random() * 180;
        const size = 6 + Math.random() * 8;
        s.style.left = `${left}%`;
        s.style.animationDelay = `${delay}ms`;
        s.style.width = `${size}px`;
        s.style.height = `${size}px`;

        const colors = ['var(--x)', 'var(--o)', 'var(--accent)'];
        s.style.background = colors[Math.floor(Math.random()*colors.length)];
        confettiEl.appendChild(s);
      }
    }

    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeModal(){
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function updateScore(){
    scoreText.textContent = `X: ${score.X} • O: ${score.O} • Ties: ${score.T}`;
  }

  function endGame(result){
    disableBoard(true);

    if (result.winner === 'T'){
      score.T++;
      updateScore();

      if (document.documentElement.getAttribute('data-reduce-motion') !== 'true'){
        boardWrap.parentElement?.classList.add('tieWobble');
        setTimeout(() => boardWrap.parentElement?.classList.remove('tieWobble'), 1100);
      }

      tieSound();
      openModal("It's a tie", "Nobody wins this round — clean slate?", false);
      statusText.innerHTML = `Result: <strong style="color:var(--muted)">Tie</strong>`;
      return;
    }

    const w = result.winner;
    score[w]++;
    updateScore();

    highlightWinningCells(result.line);
    showWinLine(result.line);

    winSound();
    openModal(`${w} wins!`, "Nice line. Want a rematch?", true);
    statusText.innerHTML = `Winner: <strong style="color:${w === 'X' ? 'var(--x)' : 'var(--o)'}">${w}</strong>`;
  }

  function onMove(i){
    if (locked) return;
    if (board[i]) return;

    clickSound();

    board[i] = turn;
    renderMark(i, turn);

    const res = checkWinner();
    if (res){
      endGame(res);
      return;
    }

    setTurn(turn === 'X' ? 'O' : 'X');
  }

  function restartGame({ keepTurn = false } = {}){
    closeModal();
    clearHighlights();

    board = Array(9).fill(null);
    for (const el of cells){
      el.innerHTML = '';
    }
    disableBoard(false);

    if (!keepTurn) turn = settings.firstPlayer;
    setTurn(turn);

    statusText.innerHTML = `Player <strong style="color:${turn === 'X' ? 'var(--x)' : 'var(--o)'}">${turn}</strong> goes first`;
  }

  function clearScore(){
    score.X = 0; score.O = 0; score.T = 0;
    updateScore();
  }

  // ===== Settings menu behavior =====
  function openSettings(){
    sheetOverlay.classList.add('show');
    sheetOverlay.setAttribute('aria-hidden', 'false');
    settingsBtn.setAttribute('aria-expanded', 'true');
    applySettingsToUI();
    setTimeout(() => themeSelect.focus(), 0);
  }

  function closeSettings(){
    sheetOverlay.classList.remove('show');
    sheetOverlay.setAttribute('aria-hidden', 'true');
    settingsBtn.setAttribute('aria-expanded', 'false');
    settingsBtn.focus();
  }

  function toggleSettings(){
    const isOpen = sheetOverlay.classList.contains('show');
    if (isOpen) closeSettings();
    else openSettings();
  }

  function resetSettings(){
    settings = { ...defaultSettings };
    applySettingsToUI();
    applySettingsToApp();
    rerenderAllMarks();
    restartGame({ keepTurn: false });
  }

  // Auto-apply
  function applyFromControls({ rerenderMarks = false } = {}){
    settings.theme = themeSelect.value;
    settings.markStyle = markStyleSelect.value;
    settings.firstPlayer = firstPlayerSelect.value;
    settings.winLine = Number(lineThickness.value);
    settings.sounds = !!soundsToggle.checked;
    settings.reduceMotion = !!reduceMotionToggle.checked;

    lineThicknessValue.textContent = String(settings.winLine);

    applySettingsToApp();
    if (rerenderMarks) rerenderAllMarks();

    setTurn(turn);
  }

  // Live update range + apply
  lineThickness.addEventListener('input', () => applyFromControls());
  themeSelect.addEventListener('change', () => applyFromControls());
  markStyleSelect.addEventListener('change', () => applyFromControls({ rerenderMarks: true }));
  firstPlayerSelect.addEventListener('change', () => applyFromControls());
  soundsToggle.addEventListener('change', () => applyFromControls());
  reduceMotionToggle.addEventListener('change', () => applyFromControls());

  // Open/close sheet
  settingsBtn.addEventListener('click', toggleSettings);
  closeSettingsBtn.addEventListener('click', closeSettings);
  sheetOverlay.addEventListener('click', (e) => {
    if (e.target === sheetOverlay) closeSettings();
  });

  resetSettingsBtn.addEventListener('click', resetSettings);

  // Escape closes settings OR result modal
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    if (sheetOverlay.classList.contains('show')){
      closeSettings();
      return;
    }
    if (overlay.classList.contains('show')){
      closeModal();
    }
  });

  // ===== Buttons =====
  restartBtn.addEventListener('click', () => restartGame({ keepTurn: false }));
  clearScoresBtn.addEventListener('click', clearScore);

  playAgainBtn.addEventListener('click', () => restartGame({ keepTurn: false }));
  closeModalBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // ===== Init =====
  applySettingsToApp();
  buildBoard();
  updateScore();
  restartGame({ keepTurn: false });
})();
