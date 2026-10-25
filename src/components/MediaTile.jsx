import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
export default function MediaTile({ stream, participant, t }) {
  const ref = useRef(null)
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    const video = ref.current
    video.srcObject = stream
    let active = true
    video.play().then(() => { if (active) setBlocked(false) }).catch(() => { if (active) setBlocked(true) })
    return () => { active = false; video.srcObject = null }
  }, [stream])
  const visible = participant?.media?.video || participant?.media?.screen
  return <div className={`media-tile ${participant?.media?.screen ? 'screen-tile' : ''} ${!visible && !blocked ? 'audio-only' : ''}`}>
    <video ref={ref} autoPlay playsInline aria-label={participant?.name} />
    {!visible && <img src={`/models/${participant?.avatar || 'alex'}-preview.png`} alt="" />}
    <span className="media-name">{participant?.name}<Icon name={participant?.media?.audio ? 'mic' : 'micOff'} size={12} /></span>
    {blocked && <button className="play-audio" onClick={() => ref.current.play().then(() => setBlocked(false)).catch(() => {})}>{t.unmutePlayback}</button>}
  </div>
}
