import { useEffect, useRef, useState } from 'react'
import useWorkspace from './useWorkspace.js'
import Icon from './components/Icon.jsx'
import MediaTile from './components/MediaTile.jsx'
import { AVATARS, COPY, REACTIONS, cameraMessage, mediaError, readPreference, roomError, savePreference } from './i18n.js'

const titleCase = value => value[0].toUpperCase() + value.slice(1)
function fullscreen() { const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); action?.catch(() => {}) }
function Profile({ name, setName, avatar, setAvatar, t }) {
  return <div className="profile-editor"><label className="field-label" htmlFor="display-name">{t.name}</label><input id="display-name" value={name} maxLength={24} onChange={e => setName(e.target.value)} autoComplete="nickname" placeholder="Alex" />
    <span className="field-label avatar-label">{t.character}</span><div className="avatar-options" role="group" aria-label={t.character}>{AVATARS.map(id => <button type="button" key={id} className={avatar === id ? 'selected' : ''} aria-pressed={avatar === id} aria-label={`${t.character}: ${titleCase(id)}`} onClick={() => setAvatar(id)}><img src={`/models/${id}-preview.png`} alt="" /><span>{titleCase(id)}</span>{avatar === id && <i><Icon name="check" size={10} /></i>}</button>)}</div>
  </div>
}
function Control({ icon, label, title, active, disabled, onClick, busy, danger }) {
  return <button className={`control ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} aria-label={title || label} aria-pressed={active === undefined ? undefined : active} disabled={disabled || busy} onClick={onClick} title={title || label}><span className="control-symbol">{busy ? <span className="spinner" /> : <Icon name={icon} />}</span><span>{label}</span></button>
}
export default function App() {
  const [locale, setLocale] = useState(() => readPreference('language', 'en') === 'zh' ? 'zh' : 'en')
  const [name, setName] = useState(() => readPreference('name', 'Alex').slice(0, 24))
  const [avatar, setAvatar] = useState(() => { const saved = readPreference('avatar', 'alex'); return AVATARS.includes(saved) ? saved : 'alex' })
  const [panel, setPanel] = useState(() => innerWidth < 760 ? null : 'people')
  const [modal, setModal] = useState(() => new URLSearchParams(location.search).has('room') ? 'join' : null)
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get('room') || '')
  const [chatText, setChatText] = useState(''), [copied, setCopied] = useState(false), [formError, setFormError] = useState('')
  const modalRef = useRef(null), chatEnd = useRef(null), copyTimer = useRef(null)
  const t = COPY[locale]
  const { container: sceneContainerRef, video: localVideoRef, ...w } = useWorkspace({ name, avatar, locale })
  const reactToGesture = w.react
  const joined = w.room.status === 'joined', connecting = w.room.status === 'connecting'
  const gestureActive = !['idle', 'error'].includes(w.vision.state)
  const gestureLoading = ['requesting', 'loading'].includes(w.vision.state)
  const localAddress = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname)
  const inviteURL = joined ? `${location.origin}${location.pathname}?room=${encodeURIComponent(w.room.roomId)}` : ''
  const participants = joined ? w.room.participants : [{ id: 'preview', name: name || 'Alex', avatar, media: { audio: w.mediaState.microphone, video: w.mediaState.camera } }]
  const count = joined ? participants.length : 1
  useEffect(() => { savePreference('language', locale); document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; document.title = `Together, Apart — ${COPY[locale].room}` }, [locale])
  useEffect(() => { savePreference('name', name) }, [name])
  useEffect(() => { savePreference('avatar', avatar) }, [avatar])
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [w.room.messages, panel])
  useEffect(() => {
    const keydown = e => {
      if (modal || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return
      const item = REACTIONS.find(r => r.key === e.key)
      if (item && !e.repeat) reactToGesture(item.type)
      if (e.key.toLowerCase() === 'f' && !e.repeat) fullscreen()
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [modal, reactToGesture])
  useEffect(() => {
    if (!modal) return
    const previous = document.activeElement
    const frame = requestAnimationFrame(() => modalRef.current?.querySelector('input, button')?.focus())
    const keydown = e => {
      if (e.key === 'Escape') { setModal(null); return }
      if (e.key !== 'Tab') return
      const elements = [...(modalRef.current?.querySelectorAll('button:not([disabled]), input, a[href]') || [])]
      const first = elements[0], last = elements.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', keydown); previous?.focus() }
  }, [modal])
  async function connect(kind) {
    if (!name.trim()) { setFormError('invalidName'); return }
    setFormError('')
    try {
      await w.connect(kind, joinCode.trim())
      setModal(null); setPanel('people')
    } catch { /* The room client exposes actionable failure state. */ }
  }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteURL); setCopied(true); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 2500) }
    catch { document.querySelector('#invite-link')?.select() }
  }
  function sendChat(e) { e.preventDefault(); if (!chatText.trim()) return; if (w.sendChat(chatText.trim())) setChatText('') }
  const profile = <Profile name={name} setName={setName} avatar={avatar} setAvatar={id => { setAvatar(id); w.focus() }} t={t} />
  const currentError = formError ? t[formError] : w.room.error ? roomError(w.room.error, locale) : null
  return <>
    <div className="meeting-app" inert={modal ? true : undefined}>
      <header className="topbar">
        <a className="wordmark" href="/" onClick={e => e.preventDefault()} aria-label="Together, Apart"><span className="brand-mark"><i /><i /></span><span>Together<span className="brand-light">, Apart</span></span></a>
        <div className="room-heading"><span className="header-slash">/</span><span>{t.room}</span><span className={`connection-dot ${joined ? 'live' : ''}`} /><small>{joined ? t.connected : t.preview}</small></div>
        <div className="top-actions"><button className="language-button" onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')} aria-label={locale === 'en' ? '切换到中文' : 'Switch to English'}><Icon name="globe" size={15} /><span>{locale === 'en' ? 'EN' : '中文'}</span></button><button className="plain-button help-top" aria-label={t.help} onClick={() => setModal('help')}><Icon name="help" size={18} /></button><button className="button primary small" onClick={() => { setFormError(''); setModal(joined ? 'invite' : 'start') }}><Icon name={joined ? 'link' : 'plus'} size={15} />{joined ? t.invite : t.create}</button></div>
      </header>
      <main className={`meeting-body ${panel ? '' : 'panel-closed'}`}>
        <nav className="navigation-rail" aria-label={t.settings}>
          {['people', 'chat', 'gestures'].map(item => <button className={panel === item ? 'selected' : ''} aria-label={t[item]} aria-pressed={panel === item} key={item} onClick={() => setPanel(panel === item ? null : item)}><Icon name={item === 'gestures' ? 'hand' : item} size={21} />{item === 'people' && joined && <small>{count}</small>}</button>)}
          <div className="rail-bottom"><button aria-label={t.settings} onClick={() => setModal('profile')}><img src={`/models/${avatar}-preview.png`} alt="" /></button></div>
        </nav>
        <section className="stage-region" aria-label={t.room}>
          <div className="scene-canvas" ref={sceneContainerRef} />
          <div className="stage-heading"><span className="studio-label">{t.studioLabel}</span><h1>{t.room}</h1><p><span className={`tiny-dot ${joined ? 'live' : ''}`} />{joined ? `${count} / 6 ${t.actualPeople}` : t.preview}</p></div>
          {!w.ready && !w.sceneError && <div className="scene-loading"><span className="spinner" />{t.loading}</div>}
          {w.sceneError && <div className="scene-loading">{t.sceneError}</div>}
          <div className="video-strip">
            <div className={`media-tile local-video ${w.mediaState.cameraCaptured ? '' : 'audio-only'}`}><video ref={localVideoRef} muted autoPlay playsInline aria-label={t.camera} /><span className="media-name">{name || 'Alex'} <small>({!w.mediaState.camera && w.mediaState.cameraCaptured ? t.onlyYou : t.you})</small><Icon name={w.mediaState.microphone ? 'mic' : 'micOff'} size={12} /></span>{w.vision.state === 'calibrating' && <span className="calibration-note">{t.calibrating}</span>}</div>
            {Object.entries(w.streams).map(([id, stream]) => <MediaTile key={id} stream={stream} participant={participants.find(p => p.id === id)} t={t} />)}
          </div>
          <div className="stage-bottom"><div className="view-controls"><button className={w.viewMode === 'follow' ? 'active' : ''} aria-label={t.focus} title={t.focus} onClick={w.focus}><Icon name="focus" size={18} /><span>{t.focus}</span></button><button className={w.viewMode === 'room' ? 'active' : ''} aria-label={t.overview} title={t.overview} onClick={w.overview}><Icon name="grid" size={17} /></button><i /><button aria-label={t.zoomOut} title={t.zoomOut} onClick={() => w.zoom(-0.15)}><Icon name="minus" size={17} /></button><button aria-label={t.zoomIn} title={t.zoomIn} onClick={() => w.zoom(0.15)}><Icon name="plus" size={17} /></button><button aria-label={t.fullscreen} title={t.fullscreen} onClick={fullscreen}><Icon name="expand" size={16} /></button></div><span className="walking-hint">{t.move}<span>{t.keys}</span></span></div>
        </section>
        {panel && <aside className="inspector" aria-label={t[panel]}>
          <div className="inspector-top"><h2>{t[panel]}{panel === 'people' && <span>{count}</span>}</h2><button className="plain-button" aria-label={t.hidePanel} onClick={() => setPanel(null)}><Icon name="close" size={17} /></button></div>
          {panel === 'people' && <div className="inspector-scroll">
            {!joined ? <><div className="join-intro"><h3>{t.welcome}</h3><p>{t.subtitle}</p></div>{!modal && profile}<div className="room-entry"><button className="button primary full" disabled={connecting} onClick={() => connect('create')}><Icon name="plus" size={16} />{connecting ? t.joining : t.create}</button><button className="button secondary full" disabled={connecting} onClick={() => { setFormError(''); setModal('join') }}><Icon name="arrow" size={16} />{t.join}</button><p className="small-note">{t.roomCapacity}</p>{currentError && <p className="error-message" role="alert">{currentError}</p>}</div><div className="preview-explanation"><Icon name="people" size={17} /><p>{t.previewNote}</p></div></> : <><p className="section-caption">{t.participants}</p><div className="participant-list">{participants.map(p => <div className="participant" key={p.id}><img src={`/models/${p.avatar || 'alex'}-preview.png`} alt="" /><div><strong>{p.name}{p.id === w.room.selfId && <small>{t.you}</small>}</strong><span>{titleCase(p.avatar || 'alex')}</span></div><Icon name={p.media?.audio ? 'mic' : 'micOff'} size={16} /></div>)}</div>{count === 1 && <p className="empty-description">{t.noPeers}</p>}<button className="button secondary full" onClick={() => setModal('invite')}><Icon name="link" size={15} />{t.invite}</button><div className="room-details"><span>{t.roomCode}</span><code>{w.room.roomId}</code><p>{t.roomEmpty}</p></div><button className="text-link" onClick={() => setModal('profile')}>{t.settings}<Icon name="arrow" size={14} /></button></>}
            <button className="inspector-help" onClick={() => setModal('help')}><Icon name="help" size={16} />{t.help}<Icon name="arrow" size={14} /></button>
          </div>}
          {panel === 'chat' && <><div className="chat-messages">{!joined ? <p className="empty-description">{t.chatJoin}</p> : !w.room.messages.length ? <p className="empty-description">{t.noMessages}</p> : w.room.messages.map(message => <div className={`chat-message ${message.participantId === w.room.selfId ? 'own' : ''}`} key={message.id}><div><strong>{message.name}</strong><time>{new Date(message.timestamp).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</time></div><p>{message.text}</p></div>)}<div ref={chatEnd} /></div><form className="chat-compose" onSubmit={sendChat}><input aria-label={t.chatPlaceholder} placeholder={t.chatPlaceholder} value={chatText} maxLength={500} disabled={!joined} onChange={e => setChatText(e.target.value)} /><button disabled={!joined || !chatText.trim()} aria-label={t.send}><Icon name="arrow" size={18} /></button></form></>}
          {panel === 'gestures' && <div className="inspector-scroll"><div className="gesture-profile"><img src={`/models/${avatar}-preview.png`} alt="" /><div><strong>{name || 'Alex'}</strong><span>{t.gesturesBinding}</span></div><span className={`tiny-dot ${gestureActive ? 'live' : ''}`} /></div><p className="panel-description">{t.gestureIntro}</p><button className={`button full ${gestureActive ? 'secondary' : 'primary'}`} id="enable-gestures" disabled={w.mediaState.busy?.camera} onClick={w.toggleGestures}>{gestureLoading ? <span className="spinner" /> : <Icon name="hand" size={17} />}{gestureActive ? t.gesturesOff : t.enableGestures}</button><p className={`recognition-status ${w.vision.state === 'error' ? 'error-message' : ''}`} role="status">{cameraMessage(w.vision, locale)}</p>{gestureActive && <><div className="recognition-meta"><span>{w.vision.metrics?.facePresent ? t.tracked : t.notTracked}</span><span>{w.vision.metrics?.handsCount || 0} {t.hands}</span></div>{w.vision.state === 'calibrating' && <progress max="1" value={w.vision.metrics?.calibrationProgress || 0} aria-label={t.calibrating} />}<button className="text-link" onClick={w.calibrate}><Icon name="reset" size={13} />{t.calibrate}</button></>}<div className="gesture-mappings">{REACTIONS.map(item => <div key={item.type}><span className="mapping-emoji">{item.emoji}</span><div><strong>{t[`${item.type}Action`]}<Icon name="arrow" size={12} /><span>{t[item.type]}</span></strong><p>{t[`${item.type}Hint`]}</p></div></div>)}</div><p className="small-note">{t.bubbleHint}</p><div className="reaction-feed"><h3>{t.recent}</h3>{w.events.length ? w.events.slice(0, 4).map(event => <div key={event.id}><span>{REACTIONS.find(r => r.type === event.type)?.emoji}</span><strong>{event.local ? name || 'Alex' : event.name}</strong><small>{event.source === 'camera' ? t.detected : t.manual}</small></div>) : <p>{t.noReactions}</p>}</div><p className="privacy-copy">{t.gesturePrivacy}</p></div>}
        </aside>}
      </main>
      <footer className="meeting-controls"><div className="call-status"><span className={`connection-dot ${joined ? 'live' : ''}`} /><div><strong>{joined ? t.connected : t.preview}</strong><span>{joined ? `${count} / 6` : t.localOnly}</span></div></div><div className="device-controls"><Control icon={w.mediaState.microphone ? 'mic' : 'micOff'} label={t.mic} title={w.mediaState.microphone ? t.micOff : t.micOn} active={w.mediaState.microphone} disabled={!joined} busy={w.mediaState.busy?.microphone} onClick={w.toggleMic} /><Control icon={w.mediaState.camera ? 'camera' : 'cameraOff'} label={t.camera} title={w.mediaState.camera ? t.cameraOff : t.cameraOn} active={w.mediaState.camera} busy={w.mediaState.busy?.camera} onClick={w.toggleCamera} /><Control icon="hand" label={t.gestures} title={gestureActive ? t.gesturesOff : t.gesturesOn} active={gestureActive} busy={w.mediaState.busy?.camera} onClick={() => { setPanel('gestures'); w.toggleGestures() }} /><Control icon="share" label={w.mediaState.screen ? t.stopShare : t.share} title={w.mediaState.screen ? t.screenOff : t.screenOn} active={w.mediaState.screen} disabled={!joined} busy={w.mediaState.busy?.screen} onClick={w.toggleShare} />{joined && <Control icon="leave" label={t.leave} danger onClick={w.leave} />}</div><div className="quick-reactions" role="group" aria-label={t.reactions}>{REACTIONS.map(item => <button key={item.type} aria-label={t[item.type]} title={`${t[item.type]} (${item.key})`} onClick={() => w.react(item.type)} disabled={!w.ready}><span>{item.emoji}</span><kbd>{item.key}</kbd></button>)}</div></footer>
      {(w.mediaState.error || (w.room.error && !modal)) && <div className="toast error-message" role="alert">{w.mediaState.error ? mediaError(w.mediaState.error, locale) : roomError(w.room.error, locale)}</div>}
    </div>
    {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setModal(null) }}><section className={`dialog ${modal === 'help' ? 'help-dialog' : ''}`} role="dialog" aria-modal="true" ref={modalRef} aria-label={modal === 'help' ? t.help : modal === 'invite' ? t.invite : t.settings}>
      <div className="dialog-header"><span className="dialog-kicker">TOGETHER, APART</span><button className="plain-button" aria-label={t.close} onClick={() => setModal(null)}><Icon name="close" /></button></div>
      {['profile', 'start', 'join'].includes(modal) && <><h2>{modal === 'profile' ? t.profileTitle : modal === 'join' ? t.joinHeading : t.startHeading}</h2><p className="dialog-description">{modal === 'profile' ? t.gesturesBinding : t.roomIntro}</p>{profile}{modal === 'join' && <label className="join-code-label">{t.roomLink}<input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder={t.roomPlaceholder} onKeyDown={e => { if (e.key === 'Enter') connect('join') }} /></label>}{currentError && modal !== 'profile' && <p className="error-message" role="alert">{currentError}</p>}<button className="button primary full" disabled={connecting || (modal === 'join' && !joinCode.trim())} onClick={() => modal === 'profile' ? setModal(null) : connect(modal === 'join' ? 'join' : 'create')}>{connecting ? <><span className="spinner" />{t.joining}</> : modal === 'profile' ? t.save : modal === 'join' ? t.join : t.create}<Icon name="arrow" size={16} /></button>{modal !== 'profile' && <p className="small-note">{t.videoPrivacy}</p>}</>}
      {modal === 'invite' && <><h2>{t.invite}</h2><p className="dialog-description">{t.inviteNote}</p><label className="field-label" htmlFor="invite-link">{t.roomLink}</label><div className="invite-field"><input id="invite-link" value={inviteURL} readOnly onFocus={e => e.target.select()} /><button className="button primary" onClick={copyInvite}>{copied ? <Icon name="check" size={17} /> : <Icon name="link" size={17} />}{copied ? t.copied : t.copyLink}</button></div>{localAddress && <p className="local-address-note"><Icon name="help" size={18} />{t.localLinkNote}</p>}<p className="small-note">{t.roomCapacity}</p></>}
      {modal === 'help' && <><h2>{t.helpTitle}</h2><ol className="help-steps">{[1, 2, 3, 4].map(step => <li key={step}><span>0{step}</span><p>{t[`helpStep${step}`]}</p></li>)}</ol><div className="keyboard-guide">{t.helpShortcuts}</div>{localAddress && <p className="local-address-note">{t.localLinkNote}</p>}<div className="help-links"><a href="/models.html" target="_blank" rel="noreferrer">{t.models} ↗</a></div></>}
    </section></div>}
  </>
}
