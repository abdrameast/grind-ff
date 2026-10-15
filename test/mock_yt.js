(function () {
  // Two fake playlists: JSR (34 videos, one of the 35 reference tracks missing) and JSRF (35 videos).
  const JSR = ['Let Mom Sleep', 'Humming the Bassline', 'O.K.!? House!!!!!?????', "That's Enough", 'Everybody Jump Around',
    'Dunny Boy Williamson Show', 'Sneakman', "'Bout the City", 'Mischievous Boy', 'Sweet Soul Brother', 'Rock It On',
    'Super Brothers', 'Magical Girl', 'Yellow Bream', 'Miller Ball Breakers', 'Up-Set Attack', 'On the Bowl (A. Fargus Mix)',
    'Funky Radio', 'Yappie Feet', 'Electric Tooth Brush', 'Dragula (Si Non Oscillas, Noli Tintinnare Mix)', 'Slow',
    'Just Got Wicked', 'Patrol Knob', 'Improvise', 'Recipe for the Perfect Afro', /* Many Styles missing */
    'Funky Plucker!', 'Improvise (Instrumental)', "Moody's Shuffle", 'Grace & Glory', 'Jet Set Medley', 'Jet Set Station',
    'Jet Set Groove #1', 'Jet Set Groove #2'];
  const LISTS = {
    'PLE3VL-5NEtZiefRHaaTUGnU7JhOkbd3mT': JSR.map((t, i) => ({ id: 'jsr' + String(i).padStart(2, '0'), title: 'Jet Set Radio OST - ' + t, dur: /Groove|Station/.test(t) ? 11 : 180 + i })),
    'PLE3VL-5NEtZjU9Ne8KSJbPgI9HfRcZRP0': Array.from({ length: 35 }, (_, i) => ({ id: 'jsrf' + String(i).padStart(2, '0'), title: i === 0 ? 'Hideki Naganuma - The Concept of Love' : i === 8 ? 'Hideki Naganuma - Jet Set Station #2' : 'JSRF Artist ' + i + ' - Future Track ' + i, dur: i === 8 ? 13 : 200 + i })),
  };
  window.__mockLists = LISTS;
  const blockedIds = new Set(['jsr05', 'jsrf05']);
  function Player(el, opts) {
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    const ifr = document.createElement('iframe');
    ifr.id = 'yt';
    ifr.setAttribute('srcdoc', '<body style="margin:0;background:#c00;color:#fff;font:20px sans-serif;display:grid;place-items:center;height:100vh">MOCK YT</body>');
    node.replaceWith(ifr);
    this.ev = opts.events || {};
    this.list = LISTS[opts.playerVars.list] || [];
    this.state = -1; this.idx = 0; this.t = 0; this.last = performance.now();
    setTimeout(() => { this.ev.onReady && this.ev.onReady({ target: this }); this._emit(5); }, 300);
    setInterval(() => this._advance(), 250);
    window.__mockPlayer = this;
  }
  Player.prototype._emit = function (s) { this.state = s; this.ev.onStateChange && this.ev.onStateChange({ data: s, target: this }); };
  Player.prototype._cur = function () { return this.list[this.idx] || { id: '', title: '', dur: 0 }; };
  Player.prototype._advance = function () {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (this.state === 1) {
      this.t += dt * (window.__ytSpeed || 1);
      if (this.t >= this._cur().dur) { this._emit(0); this._load((this.idx + 1) % this.list.length, true); }
    }
  };
  Player.prototype._load = function (i, play) {
    this.idx = i; this.t = 0;
    if (blockedIds.has(this._cur().id)) { this._emit(-1); setTimeout(() => this.ev.onError && this.ev.onError({ data: 150, target: this }), 120); return; }
    if (play) { this._emit(-1); this._emit(3); setTimeout(() => { if (this.state === 3) this._emit(1); }, 350); } else this._emit(5);
  };
  Player.prototype._swapList = function (o, play) {
    const id = typeof o === 'string' ? o : o.list;
    const old = this.list;
    this.list = [];             // YouTube returns nothing for a moment while the new list loads
    setTimeout(() => { this.list = LISTS[id] || old; this._load((o && o.index) || 0, play); }, 450);
  };
  Player.prototype.loadPlaylist = function (o) { this._swapList(o, true); };
  Player.prototype.cuePlaylist = function (o) { this._swapList(o, false); };
  Player.prototype.playVideo = function () {
    if (window.__ytBlockAutoplay) { this.ev.onAutoplayBlocked && this.ev.onAutoplayBlocked({}); return; }
    this._emit(3);
    setTimeout(() => { if (this.state === 3) this._emit(1); }, 350);
  };
  Player.prototype.pauseVideo = function () { this._emit(2); };
  Player.prototype.nextVideo = function () { this._load((this.idx + 1) % this.list.length, true); };
  Player.prototype.previousVideo = function () { this._load((this.idx - 1 + this.list.length) % this.list.length, true); };
  Player.prototype.playVideoAt = function (i) { this._load(i, true); };
  Player.prototype.seekTo = function (s) { this.t = s; };
  Player.prototype.setVolume = function () {};
  Player.prototype.mute = function () {};
  Player.prototype.unMute = function () {};
  Player.prototype.setShuffle = function () {};
  Player.prototype.setLoop = function () {};
  Player.prototype.getPlaylist = function () { return this.list.map((v) => v.id); };
  Player.prototype.getPlaylistIndex = function () { return this.idx; };
  Player.prototype.getVideoData = function () { const c = this._cur(); return { video_id: c.id, title: c.title, author: 'Mock Channel' }; };
  Player.prototype.getCurrentTime = function () { return this.t; };
  Player.prototype.getDuration = function () { return blockedIds.has(this._cur().id) ? 0 : this._cur().dur; };
  Player.prototype.getPlayerState = function () { return this.state; };
  window.YT = { Player };
  setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 50);
})();
