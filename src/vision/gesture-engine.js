// Pure, time-based recognizer. Angles are degrees (positive pitch looks down).
// Positions and palm size use the same image-width coordinate system. The
// controller supplies landmarks, never model gesture/category predictions.
export const GESTURE_DEFAULTS = Object.freeze({
  calibrationMs: 1200,
  calibrationSamples: 8,
  calibrationTolerance: 5,
  maxFrameGapMs: 350,
  nodDipDegrees: 12,
  nodReturnDegrees: 5,
  nodMinMs: 180,
  nodMaxMs: 1400,
  nodCooldownMs: 1800,
  raiseHoldMs: 600,
  raiseReleaseMs: 250,
  raiseMissingReleaseMs: 1200,
  raiseCooldownMs: 2500,
  clapNearPalms: 1.6,
  clapFarPalms: 3.2,
  clapMinMs: 100,
  clapMaxMs: 1000,
  clapCooldownMs: 1400,
})

const finite = Number.isFinite
const validPoint = p => p && finite(p.x) && finite(p.y)
const validFace = f => f && [f.pitch, f.yaw, f.roll, f.raiseLine, f.scale].every(finite) && f.scale > 0
const facingCamera = f => validFace(f) && Math.abs(f.yaw) < 30 && Math.abs(f.roll) < 25

export function createGestureEngine(options = {}) {
  const config = { ...GESTURE_DEFAULTS, ...options }
  let calibrated, calibrationProgress, neutralPitch, samples, lastTime
  let nod, clap, raise, lastEmitted
  let metrics = { facePresent: false, handsCount: 0, pitch: null, palmDistance: null, raiseProgress: 0 }

  function resetMotion() {
    nod = { phase: 'idle', since: 0, armed: false }
    clap = { phase: 'idle', since: 0 }
    raise = { id: null, since: 0, latched: false, loweredSince: null, missingSince: null }
  }

  function calibrate() {
    calibrated = false
    calibrationProgress = 0
    neutralPitch = 0
    samples = []
    lastTime = -Infinity
    lastEmitted = { nod: -Infinity, clap: -Infinity, raise: -Infinity }
    resetMotion()
  }

  function emit(type, timestamp, events) {
    if (timestamp - lastEmitted[type] < config[`${type}CooldownMs`]) return
    lastEmitted[type] = timestamp
    events.push({ type, source: 'camera', timestamp })
  }

  function updateNod(face, timestamp, events) {
    if (!facingCamera(face)) {
      nod = { phase: 'idle', since: 0, armed: false }
      return
    }
    const delta = face.pitch - neutralPitch
    if (nod.phase === 'down') {
      const elapsed = timestamp - nod.since
      if (elapsed > config.nodMaxMs || delta < -config.nodReturnDegrees) {
        nod = { phase: 'idle', since: 0, armed: false }
      } else if (Math.abs(delta) <= config.nodReturnDegrees) {
        if (elapsed >= config.nodMinMs) emit('nod', timestamp, events)
        nod = { phase: 'idle', since: 0, armed: true }
      }
    } else if (Math.abs(delta) <= config.nodReturnDegrees) {
      nod.armed = true
    } else if (nod.armed && delta >= config.nodDipDegrees) {
      nod = { phase: 'down', since: timestamp, armed: false }
    } else if (delta < -config.nodDipDegrees) {
      nod.armed = false
    }
  }

  function updateRaise(face, hands, timestamp, events) {
    metrics.raiseProgress = 0
    if (!hands.length) {
      raise.id = null
      raise.loweredSince = null
      // A lowered hand commonly leaves the camera. Require a continuous
      // absence before rearming, so brief occlusion cannot repeat a held raise.
      raise.missingSince ??= timestamp
      if (timestamp - raise.missingSince >= config.raiseMissingReleaseMs) raise.latched = false
      return
    }
    raise.missingSince = null
    if (!validFace(face)) {
      raise.id = null
      raise.loweredSince = null
      return
    }
    const line = face.raiseLine - face.scale * 0.06
    const raised = hands.find(h => h.wrist.y < line && h.palm.y < line)
    if (!raised) {
      raise.id = null
      raise.loweredSince ??= timestamp
      if (timestamp - raise.loweredSince >= config.raiseReleaseMs) raise.latched = false
      return
    }
    raise.loweredSince = null
    if (raise.latched) {
      metrics.raiseProgress = 1
      return
    }
    if (raise.id !== raised.id) {
      raise.id = raised.id
      raise.since = timestamp
    }
    metrics.raiseProgress = Math.min(1, (timestamp - raise.since) / config.raiseHoldMs)
    if (metrics.raiseProgress >= 1) {
      emit('raise', timestamp, events)
      raise.latched = true
    }
  }

  function updateClap(hands, timestamp, events) {
    metrics.palmDistance = null
    if (hands.length !== 2) {
      // Missing/occluded hands are unknown measurements, never zero distance.
      clap = { phase: 'idle', since: 0 }
      return
    }
    const [a, b] = hands
    const distance = Math.hypot(a.palm.x - b.palm.x, a.palm.y - b.palm.y) / ((a.scale + b.scale) / 2)
    metrics.palmDistance = distance
    if (clap.phase !== 'idle' && timestamp - clap.since > config.clapMaxMs) clap.phase = 'idle'
    if (clap.phase === 'idle') {
      if (distance >= config.clapFarPalms) clap = { phase: 'open', since: timestamp }
    } else if (clap.phase === 'open') {
      // Remaining open is a resting pose; time the cycle from convergence.
      if (distance >= config.clapFarPalms) clap.since = timestamp
      else if (distance <= config.clapNearPalms) clap.phase = 'closed'
    } else if (distance >= config.clapFarPalms) {
      if (timestamp - clap.since >= config.clapMinMs) emit('clap', timestamp, events)
      clap = { phase: 'open', since: timestamp }
    }
  }

  function process({ timestamp, face = null, hands = [] }) {
    if (!finite(timestamp) || timestamp <= lastTime) return []
    if (timestamp - lastTime > config.maxFrameGapMs) {
      const latched = raise.latched
      resetMotion()
      raise.latched = latched
      samples = []
      if (!calibrated) calibrationProgress = 0
    }
    lastTime = timestamp
    const visibleHands = hands.filter(h => h && h.id != null && validPoint(h.palm) && validPoint(h.wrist) && finite(h.scale) && h.scale > 0)
    metrics = { ...metrics, facePresent: !!validFace(face), handsCount: visibleHands.length, pitch: validFace(face) ? face.pitch : null }
    if (!calibrated) {
      if (!facingCamera(face)) {
        samples = []
        calibrationProgress = 0
        return []
      }
      if (samples.some(s => Math.abs(s.pitch - face.pitch) > config.calibrationTolerance)) samples = []
      samples.push({ timestamp, pitch: face.pitch })
      calibrationProgress = Math.min(1, (timestamp - samples[0].timestamp) / config.calibrationMs)
      if (calibrationProgress === 1 && samples.length >= config.calibrationSamples) {
        neutralPitch = samples.reduce((sum, s) => sum + s.pitch, 0) / samples.length
        calibrated = true
        nod.armed = true
        samples = []
      }
      return []
    }
    const events = []
    updateNod(face, timestamp, events)
    updateRaise(face, visibleHands, timestamp, events)
    updateClap(visibleHands, timestamp, events)
    return events
  }

  function getState() {
    return { calibrated, calibrationProgress, neutralPitch, ...metrics, nodPhase: nod.phase, clapPhase: clap.phase }
  }

  calibrate()
  return { process, calibrate, getState }
}
