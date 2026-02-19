import { FormEvent, useEffect, useMemo, useState } from 'react'
import { socket } from './lib/socket'
import { DrawingCanvas } from './components/DrawingCanvas'

type Player = { id: string; name: string; isHost: boolean; wins: number; losses: number }
type ChatMsg = { playerId: string; name: string; message: string; ts: number }
type RoomView = {
  code: string
  phase: 'lobby' | 'drawing' | 'voting' | 'results'
  players: Player[]
  turnIndex: number
  round: number
  imposterId: string | null
  currentDrawerId: string | null
  drawing: any[]
  chat: ChatMsg[]
  turnEndsAt: number | null
  leaderboard: { id: string; name: string; wins: number; losses: number }[]
}

export function App() {
  const [connected, setConnected] = useState(false)
  const [name, setName] = useState('')
  const [roomCodeInput, setRoomCodeInput] = useState('')
  const [room, setRoom] = useState<RoomView | null>(null)
  const [playerId, setPlayerId] = useState('')
  const [word, setWord] = useState<string | null>(null)
  const [isImposter, setIsImposter] = useState(false)
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [color, setColor] = useState('#38bdf8')
  const [size, setSize] = useState(4)
  const [message, setMessage] = useState('')
  const [guess, setGuess] = useState('')
  const [darkMode, setDarkMode] = useState(true)

  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }, [darkMode])

  useEffect(() => {
    socket.connect()
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('room:update', (payload) => setRoom(payload))
    socket.on('word:assigned', ({ word: assigned, isImposter }) => {
      setWord(assigned)
      setIsImposter(isImposter)
    })
    socket.on('draw:stroke', (stroke) => {
      setRoom((prev) => (prev ? { ...prev, drawing: [...prev.drawing, stroke] } : prev))
    })
    socket.on('chat:new', (msg) => {
      setRoom((prev) => (prev ? { ...prev, chat: [...prev.chat, msg] } : prev))
    })
    socket.on('sfx', (kind: 'turn' | 'voting') => {
      const ctx = new AudioContext()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = kind === 'turn' ? 740 : 400
      g.gain.value = 0.04
      o.connect(g)
      g.connect(ctx.destination)
      o.start()
      o.stop(ctx.currentTime + 0.2)
    })

    return () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    const urlCode = new URLSearchParams(window.location.search).get('code')
    if (urlCode) setRoomCodeInput(urlCode.toUpperCase())
  }, [])

  const isHost = useMemo(() => room?.players.find((p) => p.id === playerId)?.isHost, [room, playerId])
  const currentDrawer = room?.players.find((p) => p.id === room.currentDrawerId)
  const isMyTurn = room?.currentDrawerId === playerId
  const timerLeft = room?.turnEndsAt ? Math.max(0, Math.ceil((room.turnEndsAt - Date.now()) / 1000)) : null

  const createRoom = () => {
    socket.emit('room:create', { name }, (res: { code?: string; playerId?: string; error?: string }) => {
      if (res.error) return alert(res.error)
      if (res.code) {
        setPlayerId(res.playerId || '')
        window.history.replaceState({}, '', `?code=${res.code}`)
      }
    })
  }

  const joinRoom = () => {
    socket.emit('room:join', { code: roomCodeInput.toUpperCase(), name }, (res: any) => {
      if (res.error) return alert(res.error)
      setPlayerId(res.playerId)
      window.history.replaceState({}, '', `?code=${res.code}`)
    })
  }

  const sendMessage = (e: FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return
    socket.emit('chat:send', { message })
    setMessage('')
  }

  const submitGuess = () => {
    socket.emit('imposter:guess', { guess }, (res: { correct: boolean }) => {
      alert(res.correct ? 'Richtig! Du gewinnst als Imposter.' : 'Leider falsch.')
    })
  }

  if (!room) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4 text-slate-100">
        <h1 className="text-3xl font-black">🎨 Drawing Imposter</h1>
        <p className="text-sm text-slate-300">Multiplayer Drawing Game mit Lobby-Code und Echtzeit-Sync</p>
        <input className="rounded bg-slate-800 p-3" placeholder="Dein Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={createRoom} className="rounded bg-cyan-500 p-3 font-semibold text-slate-950">Lobby erstellen</button>
          <button onClick={joinRoom} className="rounded bg-emerald-500 p-3 font-semibold text-slate-950">Lobby beitreten</button>
        </div>
        <input className="rounded bg-slate-800 p-3 uppercase" placeholder="Code (z.B. ABC123)" value={roomCodeInput} onChange={(e) => setRoomCodeInput(e.target.value)} />
        <div className="text-xs text-slate-400">Status: {connected ? 'Verbunden' : 'Nicht verbunden'}</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 p-2 text-slate-100 md:p-4">
      <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">Lobby {room.code} · Runde {room.round}</h2>
              <p className="text-sm text-slate-300">Wort: <strong>{word ?? 'Warte auf Start…'}</strong> {isImposter ? '(Imposter)' : ''}</p>
            </div>
            <div className="text-sm">Timer: <span className="font-bold">{timerLeft ?? '-'}s</span></div>
          </header>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTool('brush')} className={`rounded px-3 py-1 ${tool === 'brush' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-700'}`}>Pinsel</button>
            <button onClick={() => setTool('eraser')} className={`rounded px-3 py-1 ${tool === 'eraser' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-700'}`}>Radierer</button>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 rounded" />
            <input type="range" min={2} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <button onClick={() => setDarkMode((s) => !s)} className="rounded bg-slate-700 px-3 py-1">Dark-Mode</button>
          </div>

          <DrawingCanvas
            enabled={room.phase === 'drawing' && isMyTurn}
            color={color}
            size={size}
            tool={tool}
            strokes={room.drawing}
            onStroke={(stroke) => {
              setRoom((prev) => (prev ? { ...prev, drawing: [...prev.drawing, stroke] } : prev))
              socket.emit('draw:stroke', stroke)
            }}
          />

          <div className="rounded bg-slate-800 p-2 text-sm">
            Phase: <strong>{room.phase}</strong> · Aktueller Zeichner: <strong>{currentDrawer?.name ?? '---'}</strong>
          </div>

          {room.phase === 'voting' && (
            <div className="rounded-lg border border-amber-500 bg-amber-500/10 p-3">
              <h3 className="mb-2 font-bold">Voting: Wer ist der Imposter?</h3>
              <div className="flex flex-wrap gap-2">
                {room.players.map((p) => (
                  <button key={p.id} onClick={() => socket.emit('vote:submit', { targetId: p.id })} className="rounded bg-amber-400 px-3 py-2 text-slate-900">{p.name}</button>
                ))}
              </div>
            </div>
          )}

          {isImposter && room.phase !== 'lobby' && (
            <div className="rounded border border-fuchsia-500 bg-fuchsia-500/10 p-3">
              <h3 className="font-semibold">Imposter Guess</h3>
              <div className="mt-2 flex gap-2">
                <input className="flex-1 rounded bg-slate-800 p-2" value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="Echtes Wort eingeben" />
                <button className="rounded bg-fuchsia-500 px-3 py-2 font-semibold text-slate-950" onClick={submitGuess}>Einreichen</button>
              </div>
            </div>
          )}

          {room.phase === 'results' && (
            <div className="rounded border border-emerald-500 bg-emerald-500/10 p-3">
              <p>Runde beendet. Der Imposter war: <strong>{room.players.find((p) => p.id === room.imposterId)?.name ?? '?'}</strong></p>
              {isHost && <button onClick={() => socket.emit('round:next')} className="mt-2 rounded bg-emerald-500 px-3 py-2 font-semibold text-slate-950">Nächste Runde</button>}
            </div>
          )}
        </section>

        <aside className="space-y-3">
          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <h3 className="mb-2 font-bold">Spieler</h3>
            <ul className="space-y-1 text-sm">
              {room.players.map((p) => (
                <li key={p.id} className="flex justify-between rounded bg-slate-800 px-2 py-1">
                  <span>{p.name} {p.isHost ? '👑' : ''}</span>
                  <span>{p.wins}W/{p.losses}L</span>
                </li>
              ))}
            </ul>
            {isHost && room.phase === 'lobby' && (
              <button onClick={() => socket.emit('game:start')} className="mt-3 w-full rounded bg-cyan-500 py-2 font-semibold text-slate-950">Spiel starten</button>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <h3 className="mb-2 font-bold">Chat</h3>
            <div className="mb-2 h-44 space-y-1 overflow-y-auto rounded bg-slate-800 p-2 text-sm">
              {room.chat.map((m, i) => <p key={i}><strong>{m.name}:</strong> {m.message}</p>)}
            </div>
            <form onSubmit={sendMessage} className="flex gap-2">
              <input className="flex-1 rounded bg-slate-800 p-2 text-sm" value={message} onChange={(e) => setMessage(e.target.value)} />
              <button className="rounded bg-slate-700 px-3">Senden</button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <h3 className="mb-2 font-bold">Leaderboard</h3>
            <ul className="space-y-1 text-sm">
              {[...room.leaderboard].sort((a, b) => b.wins - a.wins).map((entry) => (
                <li key={entry.id} className="flex justify-between rounded bg-slate-800 px-2 py-1">
                  <span>{entry.name}</span>
                  <span>{entry.wins}W/{entry.losses}L</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  )
}
