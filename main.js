const rpc = require("discord-rpc");
const request = require("axios");
const prettyMilliseconds = require("pretty-ms");
const fs = require("fs");

const quickCheckInterval = 8000;
const fullUpdateInterval = 45000;
const retryInterval = 30000;
const reconnectBaseDelay = 10000;
const reconnectMaxDelay = 120000;
const extendedReconnectDelay = 30000;
const cacheExpiry = 5 * 60 * 1000;
const maxCacheEntries = 100;
const lastFmTimeout = 15000;
const lastFmEndpoint = "https://ws.audioscrobbler.com/2.0/";

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync("config.json", "utf8"));
    const missing = [];

    if (!parsed.clientId) missing.push("clientId");
    if (!parsed.apiKey) missing.push("apiKey");
    if (!parsed.username) missing.push("username");

    if (missing.length > 0) {
      throw new Error(`Missing required config keys: ${missing.join(", ")}`);
    }

    return parsed;
  } catch (error) {
    console.error("Failed to load config.json:", safeErrorMessage(error));
    process.exit(1);
  }
}

const config = readConfig();

const state = {
  client: null,
  reconnectTimer: null,
  updateTimer: null,
  updateInFlight: false,
  reconnectAttempts: 0,
  lastFmErrors: 0,
  lastTrack: null,
  isNowPlaying: false,
  lastFullUpdate: 0,
  trackCache: new Map(),
  stopping: false,
};

function safeErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || JSON.stringify(error);
}

function formatNumber(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function truncate(value, maxLength) {
  const str = value == null ? "" : String(value);
  if (str.length <= maxLength) return str;
  return `${str.slice(0, Math.max(0, maxLength - 3))}...`;
}

function getDiscordErrorType(error) {
  const message = safeErrorMessage(error).toLowerCase();
  if (message.includes("rpc_connection_timeout")) return "RPC_CONNECTION_TIMEOUT";
  if (message.includes("connection closed") || message.includes("pipe") || message.includes("econnrefused")) {
    return "connection closed";
  }
  return "discord error";
}

function looksLikeDiscordError(error) {
  const message = safeErrorMessage(error).toLowerCase();
  return (
    message.includes("discord") ||
    message.includes("rpc") ||
    message.includes("ipc") ||
    message.includes("connection closed") ||
    message.includes("could not connect") ||
    message.includes("setactivity")
  );
}

function clearUpdateTimer() {
  if (!state.updateTimer) return;
  clearTimeout(state.updateTimer);
  state.updateTimer = null;
}

function clearReconnectTimer() {
  if (!state.reconnectTimer) return;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

function scheduleUpdate(delayMs, force = false) {
  if (state.stopping) return;

  clearUpdateTimer();
  state.updateTimer = setTimeout(() => {
    state.updateTimer = null;
    runUpdate(force).catch((error) => {
      console.error("Update loop crashed:", safeErrorMessage(error));
      scheduleUpdate(getLastFmRetryDelay(), false);
    });
  }, delayMs);
}

function scheduleReconnect(reason) {
  if (state.stopping || state.reconnectTimer) return;

  let delay = Math.min(reconnectBaseDelay * Math.pow(2, state.reconnectAttempts), reconnectMaxDelay);
  if (reason === "RPC_CONNECTION_TIMEOUT" || reason === "connection closed") {
    delay = Math.max(delay, extendedReconnectDelay);
  }

  state.reconnectAttempts += 1;

  console.log(`Reconnecting after ${Math.round(delay / 1000)}s due to ${reason}...`);

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectDiscord();
  }, delay);
}

function destroyClient(client) {
  if (!client) return;

  try {
    if (client.transport && typeof client.transport.removeAllListeners === "function") {
      client.transport.removeAllListeners("error");
    }
  } catch (_) {
    // no-op
  }

  try {
    client.removeAllListeners();
  } catch (_) {
    // no-op
  }

  try {
    client.destroy();
  } catch (_) {
    // no-op
  }
}

async function connectDiscord() {
  if (state.stopping || state.client) return;

  const client = new rpc.Client({ transport: "ipc" });
  state.client = client;

  const handleDisconnect = (reason) => {
    if (state.client !== client) return;

    console.log(`Disconnected from Discord (${reason}).`);
    state.client = null;
    clearUpdateTimer();
    destroyClient(client);
    scheduleReconnect(reason);
  };

  client.on("ready", () => {
    if (state.client !== client) return;

    console.log("Connected to Discord!");
    state.reconnectAttempts = 0;
    scheduleUpdate(0, true);
  });

  client.on("disconnected", () => {
    handleDisconnect("connection closed");
  });

  if (client.transport && typeof client.transport.on === "function") {
    client.transport.on("error", (error) => {
      console.error("Discord connection error:", safeErrorMessage(error));
      handleDisconnect(getDiscordErrorType(error));
    });
  }

  try {
    await client.login({ clientId: config.clientId });
  } catch (error) {
    if (state.client !== client) return;

    console.error("Discord login error:", safeErrorMessage(error));
    state.client = null;
    destroyClient(client);
    scheduleReconnect(getDiscordErrorType(error));
  }
}

function getCacheKey(artist, trackName) {
  return `${artist}:::${trackName}`.toLowerCase();
}

function removeExpiredCacheEntries() {
  const now = Date.now();
  for (const [key, value] of state.trackCache.entries()) {
    if (!value || now - value.timestamp >= cacheExpiry) {
      state.trackCache.delete(key);
    }
  }
}

function getCachedTrackData(artist, trackName) {
  removeExpiredCacheEntries();

  const key = getCacheKey(artist, trackName);
  const cached = state.trackCache.get(key);

  if (cached && Date.now() - cached.timestamp < cacheExpiry) {
    return cached.data;
  }

  return null;
}

function setCachedTrackData(artist, trackName, data) {
  const key = getCacheKey(artist, trackName);
  state.trackCache.set(key, { data, timestamp: Date.now() });

  if (state.trackCache.size > maxCacheEntries) {
    const oldestKey = state.trackCache.keys().next().value;
    state.trackCache.delete(oldestKey);
  }
}

function getLastFmRetryDelay() {
  const exponent = Math.max(0, state.lastFmErrors - 1);
  return Math.min(retryInterval * Math.pow(2, exponent), reconnectMaxDelay);
}

async function requestLastFm(params) {
  const response = await request.get(lastFmEndpoint, {
    timeout: lastFmTimeout,
    params,
  });
  return response.data;
}

async function quickNowPlayingCheck() {
  try {
    const response = await requestLastFm({
      method: "user.getrecenttracks",
      user: config.username,
      api_key: config.apiKey,
      format: "json",
      limit: "1",
    });

    const recentTracks = response && response.recenttracks;
    const trackList = recentTracks && recentTracks.track;
    const track = Array.isArray(trackList) ? trackList[0] : trackList;

    if (!track) return null;

    state.lastFmErrors = 0;

    return {
      artist: (track.artist && track.artist["#text"]) || "Unknown Artist",
      trackName: track.name || "Unknown Track",
      nowPlaying: !!track["@attr"],
      fullTrackData: track,
      totalScrobbles: (recentTracks && recentTracks["@attr"] && recentTracks["@attr"].total) || "0",
    };
  } catch (error) {
    state.lastFmErrors += 1;
    console.error("Quick check failed:", safeErrorMessage(error));
    return null;
  }
}

async function getDetailedTrackInfo(artist, trackName) {
  const cached = getCachedTrackData(artist, trackName);
  if (cached) return cached;

  try {
    const response = await requestLastFm({
      method: "track.getInfo",
      user: config.username,
      track: trackName,
      artist,
      api_key: config.apiKey,
      format: "json",
    });

    const track = response && response.track;
    const playcount = (track && track.userplaycount) || "0";
    const data = { playcount: String(playcount) };

    setCachedTrackData(artist, trackName, data);
    return data;
  } catch (error) {
    console.error("Detailed track info failed:", safeErrorMessage(error));
    return { playcount: state.lastTrack ? state.lastTrack.playcount : "0" };
  }
}

function buildPresenceData(quickCheck, playcount) {
  const track = quickCheck.fullTrackData || {};
  const images = Array.isArray(track.image) ? track.image : [];
  const bestImage = images.length > 0 && images[images.length - 1] ? images[images.length - 1]["#text"] : "";
  const coverURL = bestImage && bestImage.trim() ? bestImage.trim() : "default_cover";

  let albumName = track.album && track.album["#text"] ? track.album["#text"] : quickCheck.trackName;
  if (albumName === "Unknown Album") {
    albumName = quickCheck.trackName;
  }

  const scrobbleUts = track.date && track.date.uts ? Number(track.date.uts) : 0;
  const scrobbleAge = scrobbleUts > 0 ? Math.max(0, Date.now() - scrobbleUts * 1000) : 0;

  return {
    artist: quickCheck.artist,
    album: albumName,
    trackName: quickCheck.trackName,
    playcount: String(playcount || "0"),
    scrobbles: quickCheck.totalScrobbles || "0",
    whenScrobbled: track["@attr"],
    scrobbleStatus: track["@attr"]
      ? "Now scrobbling."
      : `Last scrobbled ${prettyMilliseconds(scrobbleAge)} ago.`,
    cover: coverURL,
  };
}

function buildActivity(data) {
  const clickable = toBoolean(config.clickable);
  const activity = {
    type: 3,
    details: truncate(data.trackName, 128),
    state: truncate(`by ${data.artist} on ${data.album}`, 128),
    largeImageKey: data.cover !== "default_cover" ? data.cover : "default_cover",
    largeImageText: truncate(`${data.playcount} plays`, 128),
    smallImageKey: data.whenScrobbled ? "playing" : "stopped",
    smallImageText: truncate(data.scrobbleStatus, 128),
  };

  if (clickable) {
    activity.buttons = [
      {
        label: truncate(`${formatNumber(data.scrobbles)} ${config.label || "scrobbles"}`, 32),
        url: `https://www.last.fm/user/${config.username}`,
      },
    ];
  }

  return activity;
}

async function runUpdate(force = false) {
  if (state.stopping) return;

  if (!state.client) {
    scheduleReconnect("connection closed");
    return;
  }

  if (state.updateInFlight) {
    scheduleUpdate(quickCheckInterval, force);
    return;
  }

  state.updateInFlight = true;

  try {
    const quickCheck = await quickNowPlayingCheck();

    if (!quickCheck) {
      scheduleUpdate(getLastFmRetryDelay(), false);
      return;
    }

    const currentTrackId = `${quickCheck.artist}:::${quickCheck.trackName}`;
    const lastTrackId = state.lastTrack ? `${state.lastTrack.artist}:::${state.lastTrack.trackName}` : null;

    const trackChanged = currentTrackId !== lastTrackId;
    const nowPlayingChanged = state.isNowPlaying !== quickCheck.nowPlaying;
    const needsFullUpdate = Date.now() - state.lastFullUpdate > fullUpdateInterval;

    if (!force && !trackChanged && !nowPlayingChanged && !needsFullUpdate) {
      scheduleUpdate(quickCheckInterval, false);
      return;
    }

    state.isNowPlaying = quickCheck.nowPlaying;

    let detailedInfo = { playcount: state.lastTrack ? state.lastTrack.playcount : "0" };
    if (trackChanged || needsFullUpdate) {
      detailedInfo = await getDetailedTrackInfo(quickCheck.artist, quickCheck.trackName);
      state.lastFullUpdate = Date.now();
    }

    const data = buildPresenceData(quickCheck, detailedInfo.playcount);
    const activity = buildActivity(data);

    const client = state.client;
    if (!client) {
      scheduleReconnect("connection closed");
      return;
    }

    await client.setActivity(activity);

    if (client !== state.client) {
      return;
    }

    state.lastTrack = data;

    if (trackChanged) {
      console.log(`Track changed: ${data.trackName} by ${data.artist}`);
    } else if (nowPlayingChanged) {
      console.log(`Status: ${state.isNowPlaying ? "Playing" : "Stopped"}`);
    } else {
      console.log("Refreshed");
    }

    scheduleUpdate(quickCheckInterval, false);
  } catch (error) {
    console.error("Failed to update status:", safeErrorMessage(error));

    if (looksLikeDiscordError(error)) {
      const reason = getDiscordErrorType(error);
      const client = state.client;
      state.client = null;
      clearUpdateTimer();
      destroyClient(client);
      scheduleReconnect(reason);
      return;
    }

    state.lastFmErrors += 1;
    scheduleUpdate(getLastFmRetryDelay(), false);
  } finally {
    state.updateInFlight = false;
  }
}

async function shutdown(signal) {
  if (state.stopping) return;

  state.stopping = true;
  console.log(`${signal} received. Shutting down...`);

  clearUpdateTimer();
  clearReconnectTimer();

  const client = state.client;
  state.client = null;

  if (client) {
    try {
      await client.clearActivity();
    } catch (_) {
      // no-op
    }
    destroyClient(client);
  }

  process.exit(0);
}

function main() {
  console.log("Starting Last.fm Discord RPC...");
  connectDiscord();

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });

  process.on("unhandledRejection", (error) => {
    console.error("Unhandled promise rejection:", safeErrorMessage(error));
  });

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", safeErrorMessage(error));

    if (looksLikeDiscordError(error)) {
      const client = state.client;
      state.client = null;
      clearUpdateTimer();
      destroyClient(client);
      scheduleReconnect(getDiscordErrorType(error));
    }
  });
}

main();
