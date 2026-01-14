const rpc = require("discord-rpc");
const axios = require("axios");
const prettyMilliseconds = require("pretty-ms");
const fs = require("fs");
const config = JSON.parse(fs.readFileSync("config.json"));

const quickCheckInterval = 8000;
const fullUpdateInterval = 45000;
const retryInterval = 30000;
const restartInterval = 2 * 60 * 60 * 1000;
const reconnectDelay = 10000;
const extendedReconnectDelay = 30000;
const cacheExpiry = 5 * 60 * 1000;

let rp;
let reconnecting = false;
let lastTrack = null;
let trackCache = new Map();
let lastFullUpdate = 0;
let consecutiveErrors = 0;
let isNowPlaying = false;
let lastNowPlayingCheck = 0;

function formatNumber(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function createClient() {
  if (reconnecting || rp) return;
  rp = new rpc.Client({ transport: "ipc" });
  rp.on("ready", () => {
    console.log("Connected to Discord!");
    consecutiveErrors = 0;
    updateStatus(true);
  });
  rp.on("disconnected", () => {
    console.log("Disconnected from Discord!");
    rp = null;
    reconnect("connection closed");
  });
  rp.transport.on("error", (error) => {
    console.error("Discord connection error:", error);
    rp = null;
    consecutiveErrors++;
    reconnect(error.message.includes('RPC_CONNECTION_TIMEOUT') ? "RPC_CONNECTION_TIMEOUT" : "error");
  });
  try {
    await rp.login({ clientId: config.clientId });
  } catch (error) {
    console.error("Discord login error:", error);
    rp = null;
    consecutiveErrors++;
    reconnect(error.message.includes('RPC_CONNECTION_TIMEOUT') ? "RPC_CONNECTION_TIMEOUT" : "login error");
  }
}

function reconnect(errorType = "default") {
  if (reconnecting) return;
  reconnecting = true;
  let delay = Math.min(reconnectDelay * Math.pow(2, consecutiveErrors), 120000);
  if (errorType === "RPC_CONNECTION_TIMEOUT" || errorType === "connection closed") {
    delay = Math.max(delay, extendedReconnectDelay);
  }
  console.log(`Reconnecting after ${delay / 1000}s due to ${errorType}...`);
  setTimeout(() => {
    reconnecting = false;
    createClient();
  }, delay);
}

function getCacheKey(artist, trackName) {
  return `${artist}:::${trackName}`.toLowerCase();
}

function getCachedTrackData(artist, trackName) {
  const key = getCacheKey(artist, trackName);
  const cached = trackCache.get(key);
  if (cached && Date.now() - cached.timestamp < cacheExpiry) {
    return cached.data;
  }
  return null;
}

function setCachedTrackData(artist, trackName, data) {
  const key = getCacheKey(artist, trackName);
  trackCache.set(key, { data, timestamp: Date.now() });
  if (trackCache.size > 100) {
    const oldestKey = trackCache.keys().next().value;
    trackCache.delete(oldestKey);
  }
}

async function quickNowPlayingCheck() {
  try {
    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params: {
        method: "user.getrecenttracks",
        user: config.username,
        api_key: config.apiKey,
        format: "json",
        limit: "1",
      },
      timeout: 15000,
    });
    const recenttracks = response.data.recenttracks;
    if (!recenttracks || !recenttracks.track[0]) return null;
    const track = recenttracks.track[0];
    lastNowPlayingCheck = Date.now();
    return {
      artist: track.artist["#text"],
      trackName: track.name,
      nowPlaying: !!track["@attr"],
      fullTrackData: track,
      totalScrobbles: recenttracks["@attr"].total,
    };
  } catch (error) {
    console.error("Quick check failed:", error.message);
    if (error.response?.status === 500) {
      console.log("Last.fm 500 error; retrying...");
    } else if (error.code === 'EAI_AGAIN') {
      console.log("DNS failure; retrying...");
    }
    consecutiveErrors++;
    return null;
  }
}

async function getDetailedTrackInfo(artist, trackName) {
  const cached = getCachedTrackData(artist, trackName);
  if (cached) return cached;
  try {
    const response = await axios.get("http://ws.audioscrobbler.com/2.0/", {
      params: {
        method: "track.getInfo",
        user: config.username,
        track: trackName,
        artist: artist,
        api_key: config.apiKey,
        format: "json",
      },
      timeout: 15000,
    });
    const data = { playcount: response.data.track?.userplaycount || "0" };
    setCachedTrackData(artist, trackName, data);
    return data;
  } catch (error) {
    console.error("Detailed track info failed:", error.message);
    return { playcount: "0" };
  }
}

async function updateStatus(force = false) {
  if (!rp) {
    console.log("No Discord connection; reconnecting...");
    reconnect();
    return;
  }
  const quickCheck = await quickNowPlayingCheck();
  if (!quickCheck) {
    setTimeout(updateStatus, Math.min(retryInterval * Math.pow(2, consecutiveErrors), 120000));
    return;
  }
  const currentTrackId = `${quickCheck.artist}:::${quickCheck.trackName}`;
  const lastTrackId = lastTrack ? `${lastTrack.artist}:::${lastTrack.trackName}` : null;
  const trackChanged = currentTrackId !== lastTrackId;
  const nowPlayingChanged = isNowPlaying !== quickCheck.nowPlaying;
  const needsFullUpdate = Date.now() - lastFullUpdate > fullUpdateInterval;

  if (!force && !trackChanged && !nowPlayingChanged && !needsFullUpdate) {
    setTimeout(updateStatus, quickCheckInterval);
    return;
  }

  isNowPlaying = quickCheck.nowPlaying;
  let detailedInfo = { playcount: lastTrack?.playcount || "0" };
  if (trackChanged || needsFullUpdate) {
    detailedInfo = await getDetailedTrackInfo(quickCheck.artist, quickCheck.trackName);
    lastFullUpdate = Date.now();
  }

  const track = quickCheck.fullTrackData;
  const images = track.image || [];
  let coverURL = images.length && images[images.length - 1]["#text"]?.trim() ? images[images.length - 1]["#text"].trim() : "default_cover";
  let albumName = track.album["#text"] || quickCheck.trackName;
  if (albumName === "Unknown Album") {
    albumName = quickCheck.trackName;
  }

  const data = {
    artist: quickCheck.artist,
    album: albumName,
    trackName: quickCheck.trackName,
    playcount: detailedInfo.playcount,
    scrobbles: quickCheck.totalScrobbles,
    whenScrobbled: track["@attr"],
    scrobbleStatus: track["@attr"] ? "Now scrobbling." : `Last scrobbled ${prettyMilliseconds(Date.now() - (track.date?.uts * 1000 || 0))} ago.`,
    cover: coverURL,
  };

  const activity = {
    type: 3,
    details: data.trackName,
    state: `by ${data.artist} on ${data.album}`,
    largeImageKey: data.cover !== "default_cover" ? data.cover : "default_cover",
    largeImageText: `${data.playcount} plays`,
    smallImageKey: data.whenScrobbled ? "playing" : "stopped",
    smallImageText: data.scrobbleStatus,
    buttons: [
      {
        label: `${formatNumber(data.scrobbles)} ${config.label}`,
        url: JSON.parse(config.clickable) ? `https://www.last.fm/user/${config.username}` : "javascript:void(0);",
      },
    ],
  };

  await rp.setActivity(activity);
  lastTrack = data;
  consecutiveErrors = 0;
  console.log(trackChanged ? `Track changed: ${data.trackName} by ${data.artist}` : nowPlayingChanged ? `Status: ${isNowPlaying ? 'Playing' : 'Stopped'}` : "Refreshed");
  setTimeout(updateStatus, quickCheckInterval);
}

function cleanupAndRestart() {
  if (rp) {
    rp.clearActivity()
      .then(() => {
        rp.destroy();
        rp = null;
        console.log("RPC closed for restart.");
        setTimeout(main, extendedReconnectDelay);
      })
      .catch((error) => {
        console.error("Clear activity error:", error);
        rp = null;
        setTimeout(main, extendedReconnectDelay);
      });
  } else {
    setTimeout(main, extendedReconnectDelay);
  }
}

function main() {
  console.log("Starting Last.fm Discord RPC...");
  trackCache.clear();
  consecutiveErrors = 0;
  createClient();
  setTimeout(() => {
    console.log("Restarting...");
    cleanupAndRestart();
  }, restartInterval);
}

main();
