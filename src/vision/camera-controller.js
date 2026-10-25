import { createGestureEngine } from './gesture-engine.js'

const DEGREES = 180 / Math.PI
const FRAME_INTERVAL = 1000 / 12
const INITIAL_METRICS = { facePresent: false, handsCount: 0, fps: 0, calibrationProgress: 0, raiseProgress: 0, delegate: null }

// Raw camera coordinates are never mirrored. CSS may mirror only the preview.
// MediaPipe MatrixData is column-major; XYZ rotations use its basis vectors.
export function landmarksToFrame(faceResult, handResult, timestamp, width, height) {
  const aspect = height / width
  const point = p => ({ x: p.x, y: p.y * aspect })
  const distance = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect)
  const landmarks = faceResult?.faceLandmarks?.[0]
  const matrix = faceResult?.facialTransformationMatrixes?.[0]?.data
  let face = null
  if (landmarks?.[263] && matrix?.length === 16 && matrix.every(Number.isFinite)) {
    const scale = Math.hypot(matrix[0], matrix[1], matrix[2])
    if (scale > 0) face = {
      pitch: Math.atan2(matrix[6], matrix[10]) * DEGREES,
      yaw: Math.asin(Math.max(-1, Math.min(1, -matrix[2] / scale))) * DEGREES,
      roll: Math.atan2(matrix[1], matrix[0]) * DEGREES,
      raiseLine: (landmarks[33].y + landmarks[263].y) * aspect / 2,
      scale: distance(landmarks[33], landmarks[263]),
    }
  }
  const hands = (handResult?.landmarks ?? []).flatMap((points, index) => {
    if (!points[17] || !points[9] || !points[0]) return []
    const palmPoints = [0, 5, 9, 13, 17].map(i => points[i])
    if (palmPoints.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return []
    const palm = {
      x: palmPoints.reduce((sum, p) => sum + p.x, 0) / palmPoints.length,
      y: palmPoints.reduce((sum, p) => sum + p.y, 0) * aspect / palmPoints.length,
    }
    return [{
      id: handResult.handedness?.[index]?.[0]?.categoryName ?? `hand-${index}`,
      wrist: point(points[0]), palm,
      scale: Math.max(distance(points[0], points[9]), distance(points[5], points[17])),
    }]
  })
  return { timestamp, face, hands }
}

function closeModels(models) {
  for (const task of [models?.face, models?.hand]) {
    try { task?.close() } catch { /* Continue releasing the other task. */ }
  }
}

async function loadModels({ isCancelled, onProgress }) {
  // This import, the Wasm runtime, and local model requests happen after start.
  const { FilesetResolver, FaceLandmarker, HandLandmarker } = await import('@mediapipe/tasks-vision')
  if (isCancelled()) return null
  const base = import.meta.env?.BASE_URL ?? '/'
  const vision = await FilesetResolver.forVisionTasks(`${base}wasm`)
  if (isCancelled()) return null
  for (const delegate of ['GPU', 'CPU']) {
    const models = { face: null, hand: null, delegate }
    try {
      models.face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate },
        runningMode: 'VIDEO', numFaces: 1,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.55, minFacePresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      })
      if (isCancelled()) { closeModels(models); return null }
      models.hand = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.55, minTrackingConfidence: 0.55,
      })
      if (isCancelled()) { closeModels(models); return null }
      return models
    } catch (error) {
      closeModels(models)
      if (isCancelled()) return null
      if (delegate === 'CPU') throw error
      onProgress('GPU 初始化失败，正在尝试 CPU 识别…')
    }
  }
}

function errorMessage(error, phase) {
  switch (error?.name) {
    case 'NotAllowedError': case 'SecurityError': return '摄像头权限未获允许。请在浏览器地址栏允许摄像头，然后重试。'
    case 'NotFoundError': case 'DevicesNotFoundError': return '未找到摄像头。请连接摄像头，然后重试。'
    case 'NotReadableError': case 'TrackStartError': return '摄像头无法打开，可能正被其他应用占用。关闭占用摄像头的应用后重试。'
    case 'OverconstrainedError': return '摄像头不支持当前视频设置。请切换摄像头或浏览器后重试。'
    default:
      if (phase === 'loading') return '本地识别模型加载失败。请检查 models 和 wasm 资源是否完整，刷新后重试。'
      if (phase === 'inference') return '摄像头识别中断。请关闭摄像头后重新开启；若仍失败，请更新浏览器。'
      return '摄像头视频启动失败。请检查设备与浏览器权限后重试。'
  }
}

// Optional runtime injection keeps permission/cancellation/resource ownership
// testable without opening a real camera. UI callers need only the callbacks.
export function createCameraController({ onReaction = () => {}, onStatus = () => {} } = {}, runtime = {}) {
  const mediaDevices = runtime.mediaDevices ?? globalThis.navigator?.mediaDevices
  const requestFrame = runtime.requestFrame ?? (callback => requestAnimationFrame(callback))
  const cancelFrame = runtime.cancelFrame ?? (id => cancelAnimationFrame(id))
  const now = runtime.now ?? (() => performance.now())
  const initializeModels = runtime.loadModels ?? loadModels
  const engine = createGestureEngine()
  let state = { state: 'idle', message: '摄像头已关闭', metrics: { ...INITIAL_METRICS } }
  let session = null
  let disposed = false

  function getState() { return { ...state, metrics: { ...state.metrics } } }
  function publish(nextState, message, metrics = {}) {
    state = { state: nextState, message, metrics: { ...state.metrics, ...metrics } }
    if (!disposed) onStatus(getState())
  }
  function release(s) {
    if (s.frameId != null) { cancelFrame(s.frameId); s.frameId = null }
    if (s.stream) {
      for (const track of s.stream.getTracks()) {
        track.removeEventListener?.('ended', s.onEnded)
        if (s.ownsStream) track.stop()
      }
      if (s.ownsStream && s.video.srcObject === s.stream) { s.video.pause(); s.video.srcObject = null }
      s.stream = null
    }
    closeModels(s.models)
    s.models = null
  }
  function current(s) { return !disposed && !s.cancelled && session === s }
  function fail(s, message) {
    if (!current(s)) return
    s.cancelled = true
    release(s)
    session = null
    publish('error', message, { ...INITIAL_METRICS })
  }
  function tick(s, timestamp) {
    if (!current(s)) return
    s.frameId = null
    const video = s.video
    if (timestamp - s.lastInference >= FRAME_INTERVAL && video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== s.lastVideoTime) {
      const previous = s.lastInference
      s.lastInference = timestamp
      s.lastVideoTime = video.currentTime
      try {
        const started = now()
        const faceResult = s.models.face.detectForVideo(video, timestamp)
        const handResult = s.models.hand.detectForVideo(video, timestamp)
        const frame = landmarksToFrame(faceResult, handResult, timestamp, video.videoWidth, video.videoHeight)
        const reactions = engine.process(frame)
        const metrics = engine.getState()
        const fps = Number.isFinite(previous) ? Math.min(12, 1000 / (timestamp - previous)) : 0
        s.fps = s.fps ? 0.8 * s.fps + 0.2 * fps : fps
        let message
        if (!metrics.calibrated) {
          message = metrics.facePresent ? '请正视镜头并保持不动，正在校准…' : '请让整张脸进入画面，开始校准。'
        } else if (!metrics.facePresent) {
          message = '没有检测到脸。请正视镜头，并检查光线与遮挡。'
        } else if (!metrics.handsCount) {
          message = '识别已开启。举手或鼓掌时，请让手腕与双手进入画面。'
        } else {
          message = '识别已开启：点头后回正；举手保持片刻；双手靠近后分开。'
        }
        publish(metrics.calibrated ? 'running' : 'calibrating', message, {
          ...metrics, fps: Math.round(s.fps * 10) / 10, inferenceMs: Math.round(now() - started), delegate: s.models.delegate,
        })
        for (const reaction of reactions) { if (current(s)) onReaction(reaction) }
      } catch (error) {
        fail(s, errorMessage(error, 'inference'))
        return
      }
    }
    if (current(s)) s.frameId = requestFrame(time => tick(s, time))
  }
  function start(video, { stream: sharedStream = null } = {}) {
    if (disposed) return Promise.resolve(false)
    if (session) return session.promise
    if (!sharedStream && (globalThis.isSecureContext === false || !mediaDevices?.getUserMedia)) {
      publish('error', '此环境无法访问摄像头。请使用支持摄像头的浏览器，通过 HTTPS 或 localhost 打开。')
      return Promise.resolve(false)
    }
    if (!video || typeof video.play !== 'function') {
      publish('error', '摄像头预览尚未准备好，请重试。')
      return Promise.resolve(false)
    }
    const s = { video, cancelled: false, stream: null, ownsStream: !sharedStream, models: null, frameId: null, lastVideoTime: -1, lastInference: -Infinity, fps: 0 }
    session = s
    s.onEnded = () => fail(s, '摄像头连接已断开或权限已撤销。请检查设备，然后重新开启。')
    engine.calibrate()
    publish('requesting', '正在请求摄像头权限…', { ...INITIAL_METRICS })
    s.promise = (async () => {
      let phase = 'requesting'
      try {
        s.stream = sharedStream ?? await mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' } })
        if (!current(s)) { release(s); return false }
        for (const track of s.stream.getVideoTracks()) track.addEventListener?.('ended', s.onEnded)
        video.muted = true
        video.playsInline = true
        if (video.srcObject !== s.stream) video.srcObject = s.stream
        await video.play()
        if (!current(s)) { release(s); return false }
        phase = 'loading'
        publish('loading', '正在加载本地人脸与手部模型…')
        s.models = await initializeModels({ isCancelled: () => !current(s), onProgress: message => { if (current(s)) publish('loading', message) } })
        if (!current(s)) { release(s); return false }
        if (!s.models?.face || !s.models?.hand) throw new Error('Model initialization was incomplete')
        publish('calibrating', '请正视镜头并保持不动，正在校准…', { delegate: s.models.delegate })
        s.frameId = requestFrame(timestamp => tick(s, timestamp))
        return true
      } catch (error) {
        if (current(s)) fail(s, errorMessage(error, phase))
        else release(s)
        return false
      }
    })()
    return s.promise
  }
  function stop() {
    if (session) {
      const s = session
      s.cancelled = true
      session = null
      release(s)
    }
    engine.calibrate()
    publish('idle', '摄像头已关闭', { ...INITIAL_METRICS })
  }
  function calibrate() {
    if (!session?.models || disposed) return
    engine.calibrate()
    publish('calibrating', '请正视镜头并保持不动，正在重新校准…', { calibrationProgress: 0, raiseProgress: 0 })
  }
  function dispose() { stop(); disposed = true }
  return { start, stop, calibrate, dispose, getState }
}
