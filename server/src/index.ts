import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { customAlphabet } from "nanoid";
import { pickWordPair } from "./words.js";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeRoomCode = customAlphabet(alphabet, 6);

const TURN_MS = 20_000;

type Phase = "lobby" | "drawing" | "voting" | "results";

type DrawEvent = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  size: number;
  tool: "brush" | "eraser";
};

type Player = {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  wins: number;
  losses: number;
};

type RoomState = {
  code: string;
  players: Player[];
  phase: Phase;
  hostId: string;
  turnIndex: number;
  round: number;
  imposterId: string | null;
  realWord: string | null;
  fakeWord: string | null;
  currentDrawerId: string | null;
  drawing: DrawEvent[];
  chat: { playerId: string; name: string; message: string; ts: number }[];
  votes: Record<string, string>;
  leaderboard: Record<string, { wins: number; losses: number }>;
  turnEndsAt: number | null;
  timerRef?: NodeJS.Timeout;
};

const rooms = new Map<string, RoomState>();
const socketToRoom = new Map<string, string>();

const app = express();
app.use(cors());
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

function roomView(room: RoomState) {
  return {
    code: room.code,
    phase: room.phase,
    players: room.players,
    turnIndex: room.turnIndex,
    round: room.round,
    imposterId: room.phase === "results" ? room.imposterId : null,
    currentDrawerId: room.currentDrawerId,
    drawing: room.drawing,
    chat: room.chat.slice(-60),
    turnEndsAt: room.turnEndsAt,
    leaderboard: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      wins: room.leaderboard[p.id]?.wins ?? p.wins,
      losses: room.leaderboard[p.id]?.losses ?? p.losses
    }))
  };
}

function emitRoom(room: RoomState) {
  io.to(room.code).emit("room:update", roomView(room));
}

function broadcastWords(room: RoomState) {
  room.players.forEach((p) => {
    io.to(p.id).emit("word:assigned", {
      word: p.id === room.imposterId ? room.fakeWord : room.realWord,
      isImposter: p.id === room.imposterId
    });
  });
}

function clearTimer(room: RoomState) {
  if (room.timerRef) clearTimeout(room.timerRef);
}

function startTurn(room: RoomState) {
  if (room.players.length === 0) return;

  if (room.turnIndex >= room.players.length) {
    room.phase = "voting";
    room.currentDrawerId = null;
    room.turnEndsAt = null;
    emitRoom(room);
    io.to(room.code).emit("phase:voting");
    return;
  }

  room.phase = "drawing";
  room.currentDrawerId = room.players[room.turnIndex]?.id ?? null;
  room.turnEndsAt = Date.now() + TURN_MS;
  room.drawing = [];
  emitRoom(room);
  io.to(room.code).emit("turn:started", {
    drawerId: room.currentDrawerId,
    turnEndsAt: room.turnEndsAt
  });

  clearTimer(room);
  room.timerRef = setTimeout(() => {
    room.turnIndex += 1;
    startTurn(room);
  }, TURN_MS + 100);
}

function startGame(room: RoomState) {
  if (room.players.length < 3) return;

  room.round += 1;
  room.turnIndex = 0;
  room.votes = {};

  const imposter = room.players[Math.floor(Math.random() * room.players.length)];
  const { realWord, fakeWord } = pickWordPair();
  room.imposterId = imposter.id;
  room.realWord = realWord;
  room.fakeWord = fakeWord;

  broadcastWords(room);
  io.to(room.code).emit("sfx", "turn");
  startTurn(room);
}

function computeVoting(room: RoomState) {
  const tally: Record<string, number> = {};
  Object.values(room.votes).forEach((targetId) => {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  });

  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const suspected = sorted[0]?.[0];
  const imposterWins = suspected !== room.imposterId;

  if (room.imposterId) {
    room.players.forEach((p) => {
      room.leaderboard[p.id] = room.leaderboard[p.id] ?? { wins: p.wins, losses: p.losses };
      if (imposterWins) {
        if (p.id === room.imposterId) room.leaderboard[p.id].wins += 1;
        else room.leaderboard[p.id].losses += 1;
      } else {
        if (p.id === room.imposterId) room.leaderboard[p.id].losses += 1;
        else room.leaderboard[p.id].wins += 1;
      }
    });
  }

  room.phase = "results";
  room.turnEndsAt = null;
  emitRoom(room);
  io.to(room.code).emit("phase:results", {
    suspected,
    imposterId: room.imposterId,
    realWord: room.realWord,
    tally,
    imposterWins
  });
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }: { name: string }, cb) => {
    const code = makeRoomCode();
    const player: Player = { id: socket.id, name: name?.slice(0, 24) || "Host", isHost: true, connected: true, wins: 0, losses: 0 };

    const room: RoomState = {
      code,
      players: [player],
      phase: "lobby",
      hostId: socket.id,
      turnIndex: 0,
      round: 0,
      imposterId: null,
      realWord: null,
      fakeWord: null,
      currentDrawerId: null,
      drawing: [],
      chat: [],
      votes: {},
      leaderboard: { [player.id]: { wins: 0, losses: 0 } },
      turnEndsAt: null
    };

    rooms.set(code, room);
    socketToRoom.set(socket.id, code);
    socket.join(code);
    emitRoom(room);
    cb?.({ code, playerId: socket.id });
  });

  socket.on("room:join", ({ code, name }: { code: string; name: string }, cb) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return cb?.({ error: "Lobby nicht gefunden." });

    const player: Player = { id: socket.id, name: name?.slice(0, 24) || "Spieler", isHost: false, connected: true, wins: 0, losses: 0 };
    room.players.push(player);
    room.leaderboard[player.id] = { wins: 0, losses: 0 };

    socketToRoom.set(socket.id, room.code);
    socket.join(room.code);
    emitRoom(room);
    cb?.({ code: room.code, playerId: socket.id });
  });

  socket.on("game:start", () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    startGame(room);
  });

  socket.on("draw:stroke", (stroke: DrawEvent) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.currentDrawerId !== socket.id || room.phase !== "drawing") return;
    room.drawing.push(stroke);
    socket.to(code).emit("draw:stroke", stroke);
  });

  socket.on("chat:send", ({ message }: { message: string }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    const msg = { playerId: socket.id, name: player.name, message: message.slice(0, 200), ts: Date.now() };
    room.chat.push(msg);
    io.to(code).emit("chat:new", msg);
  });

  socket.on("vote:submit", ({ targetId }: { targetId: string }) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.phase !== "voting") return;
    room.votes[socket.id] = targetId;
    emitRoom(room);

    if (Object.keys(room.votes).length >= room.players.length) {
      io.to(code).emit("sfx", "voting");
      computeVoting(room);
    }
  });

  socket.on("imposter:guess", ({ guess }: { guess: string }, cb) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || socket.id !== room.imposterId) return;

    const correct = guess.trim().toLowerCase() === room.realWord?.toLowerCase();
    if (correct) {
      room.phase = "results";
      room.players.forEach((p) => {
        room.leaderboard[p.id] = room.leaderboard[p.id] ?? { wins: 0, losses: 0 };
        if (p.id === socket.id) room.leaderboard[p.id].wins += 1;
        else room.leaderboard[p.id].losses += 1;
      });
      emitRoom(room);
      io.to(code).emit("phase:results", {
        suspected: null,
        imposterId: room.imposterId,
        realWord: room.realWord,
        tally: room.votes,
        imposterWins: true,
        guessedWord: guess
      });
    }

    cb?.({ correct });
  });

  socket.on("round:next", () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    startGame(room);
  });

  socket.on("disconnect", () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    socketToRoom.delete(socket.id);
    const room = rooms.get(code);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);
    delete room.leaderboard[socket.id];

    if (room.hostId === socket.id && room.players[0]) {
      room.hostId = room.players[0].id;
      room.players[0].isHost = true;
    }

    if (room.players.length === 0) {
      clearTimer(room);
      rooms.delete(code);
      return;
    }

    emitRoom(room);
  });
});

const PORT = Number(process.env.PORT || 3001);
httpServer.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
