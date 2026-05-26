
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ベイゴマバトル</title>
  <link rel="stylesheet" href="css/style.css" />
</head>
<body>

  <!-- ─── Main Layout ─────────────────────────────────────────── -->
  <div id="app">

    <!-- Left: Arena -->
    <div id="arena-wrap">
      <canvas id="arena"></canvas>
    </div>

    <!-- Right: UI Panel -->
    <div id="panel">

      <h1 id="game-title">ベイゴマ<span>バトル</span></h1>

      <!-- Top Selection (shown before launch) -->
      <section id="selection-section" class="panel-section">
        <h2>こまを えらぶ</h2>
        <div id="top-cards"></div>

        <!-- Three-view display canvas -->
        <div id="three-view-wrap">
          <canvas id="three-view-canvas" width="240" height="110"></canvas>
          <div id="three-view-label"></div>
        </div>

        <button id="confirm-btn" class="btn-primary" disabled>けってい！</button>
      </section>

      <!-- Match Info (shown during battle) -->
      <section id="match-section" class="panel-section hidden">
        <div id="match-tops">
          <div class="match-top-card" id="player-card">
            <div class="match-top-label">あなた</div>
            <canvas class="match-top-view" width="80" height="80"></canvas>
            <div class="match-top-name" id="player-top-name"></div>
            <div class="spin-bar-wrap">
              <div class="spin-bar" id="player-spin-bar"></div>
            </div>
          </div>

          <div id="vs-label">VS</div>

          <div class="match-top-card" id="cpu-card">
            <div class="match-top-label">CPU</div>
            <canvas class="match-top-view" width="80" height="80"></canvas>
            <div class="match-top-name" id="cpu-top-name"></div>
            <div class="spin-bar-wrap">
              <div class="spin-bar" id="cpu-spin-bar"></div>
            </div>
          </div>
        </div>

        <div id="personality-display">
          CPU: <span id="personality-label"></span>
        </div>

        <button id="launch-btn" class="btn-primary" style="margin-top:12px">
          なげる！
        </button>

        <button id="restart-btn" class="btn-primary hidden" style="margin-top:8px">
          もう一回
        </button>
      </section>

      <!-- Player Stats -->
      <section id="stats-section" class="panel-section">
        <h2>スキル</h2>
        <div id="skill-display">
          <div id="skill-bar-wrap">
            <div id="skill-bar"></div>
          </div>
          <div id="skill-value"></div>
        </div>
      </section>

      <!-- Match History -->
      <section id="history-section" class="panel-section">
        <h2>せんせき</h2>
        <div id="history-list"></div>
        <button id="reset-btn" class="btn-small">リセット</button>
      </section>

    </div><!-- /panel -->
  </div><!-- /app -->

  <!-- ─── Scripts ──────────────────────────────────────────────── -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js"></script>
  <script src="js/tops.js"></script>
  <script src="js/physics.js"></script>
  <script src="js/game.js"></script>
  <script src="js/main.js"></script>

  <!-- ─── UI Logic ─────────────────────────────────────────────── -->
  <script>
    // ── Top Selection ──────────────────────────────────────────

    let _selectedTopId   = null;
    let _onSelectionDone = null;

    // Called by main.js initGame()
    function showTopSelection(callback) {
      _onSelectionDone = callback;
      _selectedTopId   = null;

      document.getElementById('selection-section').classList.remove('hidden');
      document.getElementById('match-section').classList.add('hidden');
      document.getElementById('confirm-btn').disabled = true;

      _buildTopCards();
      _updateHistory();
      _updateStats();
    }

    function _buildTopCards() {
      const container = document.getElementById('top-cards');
      container.innerHTML = '';

      Tops.TOP_ORDER.forEach(id => {
        const def  = Tops.TOP_DEFS[id];
        const card = document.createElement('div');
        card.className  = 'top-card';
        card.dataset.id = id;

        card.innerHTML = `
          <div class="top-card-swatch" style="background:${def.color}"></div>
          <div class="top-card-name">${def.hiragana}</div>
          <div class="top-card-stats">
            ${_statBar('スピン', def.spinDuration / 60)}
            ${_statBar('ちから', def.impactForce / 1.5)}
            ${_statBar('あんてい', def.stability)}
          </div>
        `;

        card.addEventListener('click', () => _selectTop(id));
        container.appendChild(card);
      });
    }

    function _statBar(label, value) {
      const pct = Math.round(Math.min(value, 1) * 100);
      return `
        <div class="stat-row">
          <span class="stat-label">${label}</span>
          <div class="stat-bar-bg">
            <div class="stat-bar-fill" style="width:${pct}%"></div>
          </div>
        </div>`;
    }

    function _selectTop(id) {
      _selectedTopId = id;

      // Highlight selected card
      document.querySelectorAll('.top-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.id === id);
      });

      // Update three-view canvas
      const canvas = document.getElementById('three-view-canvas');
      Tops.drawThreeView(canvas, id);
      document.getElementById('three-view-label').textContent = Tops.TOP_DEFS[id].hiragana;

      document.getElementById('confirm-btn').disabled = false;
    }

    document.getElementById('confirm-btn').addEventListener('click', () => {
      if (!_selectedTopId) return;

      // Hide selection, show match UI
      document.getElementById('selection-section').classList.add('hidden');
      document.getElementById('match-section').classList.remove('hidden');

      // Trigger game start
      if (_onSelectionDone) _onSelectionDone(_selectedTopId);

      // Update match UI once game state is ready
      requestAnimationFrame(_updateMatchUI);
    });

    document.getElementById('launch-btn').addEventListener('click', () => {
      if (typeof handlePlayerLaunchButton === 'function') {
        handlePlayerLaunchButton();
      }
    });

    // ── Match UI ───────────────────────────────────────────────

    function _updateMatchUI() {
      const gs = Game.getGameState();
      if (!gs.playerTop || !gs.cpuTop) return;

      // Player top view
      const pCanvas = document.querySelector('#player-card .match-top-view');
      Tops.drawThreeView(pCanvas, gs.playerTop.defId);
      document.getElementById('player-top-name').textContent = gs.playerTop.def.hiragana;

      // CPU top view
      const cCanvas = document.querySelector('#cpu-card .match-top-view');
      Tops.drawThreeView(cCanvas, gs.cpuTop.defId);
      document.getElementById('cpu-top-name').textContent = gs.cpuTop.def.hiragana;

      // Personality
      const personalityMap = {
        aggressive: 'こうげき',
        defensive:  'ぼうぎょ',
        standard:   'ふつう',
      };
      document.getElementById('personality-label').textContent =
        personalityMap[gs.cpuPersonality] || gs.cpuPersonality;

      // Start spin bar update loop
      _updateSpinBars();
    }

    function _updateSpinBars() {
      const gs = Game.getGameState();
      if (gs.phase === 'result') return;

      if (gs.playerTop) {
        const pct = Math.round(gs.playerTop.spinSpeed * 100);
        document.getElementById('player-spin-bar').style.width = pct + '%';
        document.getElementById('player-spin-bar').style.background =
          _spinColor(gs.playerTop.spinSpeed);
      }
      if (gs.cpuTop) {
        const pct = Math.round(gs.cpuTop.spinSpeed * 100);
        document.getElementById('cpu-spin-bar').style.width = pct + '%';
        document.getElementById('cpu-spin-bar').style.background =
          _spinColor(gs.cpuTop.spinSpeed);
      }

      requestAnimationFrame(_updateSpinBars);
    }

    function _spinColor(speed) {
      if (speed > 0.5) return '#4dff91';
      if (speed > 0.2) return '#FFD700';
      return '#FF6644';
    }

    // ── Stats ──────────────────────────────────────────────────

    function _updateStats() {
      const gs  = Game.getGameState();
      const pct = gs.playerSkill;
      document.getElementById('skill-bar').style.width  = pct + '%';
      document.getElementById('skill-value').textContent = `Lv ${gs.playerSkill}`;
    }

    // ── History ────────────────────────────────────────────────

    function _updateHistory() {
      const history = Game.getMatchHistory();
      const list    = document.getElementById('history-list');
      list.innerHTML = '';

      if (history.length === 0) {
        list.innerHTML = '<div class="history-empty">まだ せんせきなし</div>';
        return;
      }

      history.slice(0, 10).forEach(entry => {
        const row  = document.createElement('div');
        row.className = 'history-row';
        const icon = entry.result === 'player_win' ? '⭕' :
                     entry.result === 'cpu_win'    ? '❌' : '△';
        const date = new Date(entry.date);
        const dateStr = `${date.getMonth()+1}/${date.getDate()}`;
        row.innerHTML = `<span class="history-icon">${icon}</span>
                         <span class="history-date">${dateStr}</span>
                         <span class="history-skill">Lv${entry.skill}</span>`;
        list.appendChild(row);
      });
    }

    document.getElementById('reset-btn').addEventListener('click', () => {
      if (confirm('せんせきを リセットしますか？')) {
        Game.resetProgress();
        _updateHistory();
        _updateStats();
      }
    });
  </script>

</body>
</html>
