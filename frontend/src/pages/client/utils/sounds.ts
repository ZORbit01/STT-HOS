/**
 * Sound design utilities — synthesised UI sounds for voice feedback.
 * All functions use a shared AudioContext that is never used for mic capture.
 */

function _osc(
  ac: AudioContext, freq: number, type: OscillatorType,
  start: number, end: number, gainPeak: number,
) {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.connect(g); g.connect(ac.destination)
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(gainPeak, start + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, end)
  osc.start(start); osc.stop(end + 0.01)
}

export function playAccepted(ac: AudioContext) {
  const t = ac.currentTime
  _osc(ac, 783.99, 'sine', t, t + 0.18, 0.15)
  _osc(ac, 1046.5, 'sine', t + 0.14, t + 0.32, 0.12)
}

export function playRejected(ac: AudioContext) {
  const t = ac.currentTime
  _osc(ac, 311.13, 'sine', t, t + 0.22, 0.18)
  _osc(ac, 233.08, 'sine', t + 0.10, t + 0.28, 0.14)
  _osc(ac, 116.54, 'sine', t, t + 0.28, 0.08)
}

export function playListening(ac: AudioContext) {
  const t = ac.currentTime
  _osc(ac, 659.25, 'sine', t, t + 0.22, 0.12)
  _osc(ac, 880.00, 'sine', t + 0.10, t + 0.26, 0.08)
}

export function playReview(ac: AudioContext) {
  const t = ac.currentTime
  _osc(ac, 587.33, 'sine', t, t + 0.22, 0.14)
  _osc(ac, 740.00, 'sine', t + 0.08, t + 0.26, 0.08)
}

export function playTimeout(ac: AudioContext) {
  const t = ac.currentTime
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.connect(g); g.connect(ac.destination)
  osc.type = 'sine'
  osc.frequency.setValueAtTime(440, t)
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.3)
  g.gain.setValueAtTime(0.12, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  osc.start(t); osc.stop(t + 0.32)
}

// ────────────────────────────────────────────────────────────────────
// Visitor dashboard sounds — the calm "airport / elevator" arrival chime.
// That mellow public-announcement "bong" you hear before a gate call or
// when a lift reaches a floor: a soft bell tone with a gentle attack, a
// faint overtone for body, and a long ring-out as if in a large hall.
// Reassuring, never an alarm — anxious families are listening.
// ────────────────────────────────────────────────────────────────────

/**
 * One struck bell note: a fundamental plus a quiet inharmonic overtone
 * (≈2.76×, the hallmark of a real bell/chime), soft attack, long decay.
 */
function _chime(ac: AudioContext, freq: number, start: number, gainPeak: number, decay = 1.6) {
  const g = ac.createGain()
  g.connect(ac.destination)
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(gainPeak, start + 0.02)   // soft mallet attack
  g.gain.exponentialRampToValueAtTime(0.0001, start + decay)

  const fundamental = ac.createOscillator()
  fundamental.type = 'sine'
  fundamental.frequency.setValueAtTime(freq, start)
  fundamental.connect(g)
  fundamental.start(start); fundamental.stop(start + decay + 0.05)

  const overtone = ac.createOscillator()
  const og = ac.createGain()
  overtone.type = 'sine'
  overtone.frequency.setValueAtTime(freq * 2.76, start)    // bell-like partial
  og.gain.setValueAtTime(gainPeak * 0.28, start)
  og.gain.exponentialRampToValueAtTime(0.0001, start + decay * 0.55)
  overtone.connect(og); og.connect(ac.destination)
  overtone.start(start); overtone.stop(start + decay + 0.05)
}

/** A surgery advanced one step — a single soft elevator "ding". Plays often. */
export function playPhaseTransition(ac: AudioContext) {
  const t = ac.currentTime
  _chime(ac, 880.00, t, 0.10, 1.3)                         // A5, single note
}

/** Patient has left the OR — the classic airport descending two-tone "bing-bong". */
export function playPatientOut(ac: AudioContext) {
  const t = ac.currentTime
  _chime(ac, 987.77, t, 0.12, 1.5)                         // B5  ↓
  _chime(ac, 739.99, t + 0.42, 0.12, 1.9)                  // F#5  (high → low)
}

/** Case finished — a fuller three-note arrival chime that settles low and warm. */
export function playCaseComplete(ac: AudioContext) {
  const t = ac.currentTime
  _chime(ac, 1046.50, t, 0.11, 1.4)                        // C6  ↓
  _chime(ac, 783.99, t + 0.34, 0.12, 1.7)                  // G5  ↓
  _chime(ac, 523.25, t + 0.70, 0.13, 2.4)                  // C5  (long, settled resolve)
}