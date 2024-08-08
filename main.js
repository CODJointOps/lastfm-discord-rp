const rpc = require("discord-rpc");
const fetch = require("request-promise");
const prettyMilliseconds = require("pretty-ms");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("config.json"));

const updateInterval = 5000;
const retryInterval = 30000;
const restartInterval = 2 * 60 * 60 * 1000;
const reconnectDelay = 10000;
const extendedReconnectDelay = 90000;

let rp;
let startTime = Date.now();
let reconnecting = false;
let lastTrack = null;
let currentClient = null;

function formatNumber(number) {
  var x = number.split(".");
  var x1 = x[0];
  var x2 = x.length > 1 ? "." + x[1] : "";
  var rgx = /(\d+)(\d{3})/;
  while (rgx.test(x1)) {
    x1 = x1.replace(rgx, "$1" + "," + "$2");
  }
  return x1 + x2;
}

function createClient() {
  if (reconnecting || currentClient) return;

  rp = new rpc.Client({ transport: "ipc" });
  currentClient = rp;

  rp.on("ready", () => {
    console.log("Connected to Discord!");
    updateStatus();
  });

  rp.on("disconnected", () => {
    console.log("Disconnected from Discord!");
    rp = null;
    currentClient = null;
    reconnect("connection closed");
  });

  rp.transport.on("error", (error) => {
    console.error("Error with Discord connection:", error);
    rp = null;
    currentClient = null;
    if (error.message.includes('RPC_CONNECTION_TIMEOUT')) {
      reconnect("RPC_CONNECTION_TIMEOUT");
    } else if (error.message.includes('connection closed')) {
      reconnect("connection closed");
    } else {
      reconnect();
    }
  });

  rp.login({ clientId: config.clientId }).catch((error) => {
    console.error("Error connecting to Discord:", error);
    rp = null;
    currentClient = null;
    if (error.message.includes('RPC_CONNECTION_TIMEOUT')) {
      reconnect("RPC_CONNECTION_TIMEOUT");
    } else if (error.message.includes('connection closed')) {
      reconnect("connection closed");
    } else {
      reconnect();
    }
  });
}

function reconnect(errorType) {
  if (reconnecting) return;
  reconnecting = true;

  let delay = reconnectDelay;
  if (errorType === "RPC_CONNECTION_TIMEOUT" || errorType === "connection closed") {
    delay = extendedReconnectDelay;
    console.log(`Encountered ${errorType}, waiting for ${extendedReconnectDelay / 1000} seconds before reconnecting...`);
  }

  setTimeout(() => {
    reconnecting = false;
    createClient();
  }, delay);
}

async function updateStatus() {
  try {
    const data = await fetchCurrentScrobble(config.username);
    if (!data || !rp) {
      console.log("Reconnecting to Discord...");
      reconnect();
      return;
    }

    if (lastTrack && lastTrack.trackName === data.trackName && lastTrack.artist === data.artist) {
      console.log("Same track, skipping update.");
      setTimeout(updateStatus, updateInterval);
      return;
    }

    lastTrack = data;

    await rp.setActivity({
      largeImageKey: data.cover !== "default_cover" ? data.cover : "default_cover",
      largeImageText: `${data.playcount} plays.`,
      smallImageKey: data.whenScrobbled ? "playing" : "stopped",
      smallImageText: data.scrobbleStatus,
      details: data.trackName,
      state: `${data.artist} - ${data.album}`,
      buttons: [
        {
          label: `${formatNumber(data.scrobbles)} ${config.label}`,
          url: JSON.parse(config.clickable) ? `https://www.last.fm/user/${config.username}/` : "javascript:void(0);"
        },
      ],
    });

    console.log("Discord status updated. Current track: " + data.trackName + ", Artist: " + data.artist);

    setTimeout(updateStatus, updateInterval);
  } catch (error) {
    console.error("Failed to update status:", error);
    rp = null;
    currentClient = null;
    reconnect();
  }
}

async function fetchCurrentScrobble(user) {
  let lastTrackName;
  let lastArtist;
  try {
    const optionsGetTrack = {
      uri: "http://ws.audioscrobbler.com/2.0/",
      json: true,
      qs: {
        method: "user.getrecenttracks",
        user: user,
        api_key: config.apiKey,
        format: "json",
        limit: "1",
      },
    };

    const lastTrack = await fetch(optionsGetTrack);

    if (!lastTrack.recenttracks.track[0]) {
      console.error("No track data in recenttracks");
      return null;
    }

    lastArtist = lastTrack.recenttracks.track[0].artist["#text"];
    lastTrackName = lastTrack.recenttracks.track[0].name;

    const options = {
      uri: "http://ws.audioscrobbler.com/2.0/",
      json: true,
      qs: {
        method: "track.getInfo",
        user: user,
        track: lastTrackName,
        artist: lastArtist,
        api_key: config.apiKey,
        format: "json",
      },
    };

    const rData = await fetch(options);

    let playcount = "0";
    if (rData.track && rData.track.userplaycount) {
      playcount = rData.track.userplaycount;
    } else {
      console.warn("No track data in track.getInfo for track: " + lastTrackName + " by artist: " + lastArtist);
    }

    let images = lastTrack.recenttracks.track[0].image;
    let coverURL = images && images[images.length - 1]["#text"].trim() ? images[images.length - 1]["#text"].trim() : "default_cover";

    let albumName = lastTrack.recenttracks.track[0].album["#text"];
    if (!albumName || albumName === "Unknown Album") {
      albumName = lastTrackName;
    }
    
    const data = {
      artist: lastArtist,
      album: albumName,
      trackName: lastTrackName,
      playcount: playcount,
      scrobbles: lastTrack.recenttracks["@attr"].total,
      whenScrobbled: lastTrack.recenttracks.track[0]["@attr"],
      scrobbleStatus: !lastTrack.recenttracks.track[0]["@attr"] ? `Last scrobbled ${prettyMilliseconds(Date.now() - lastTrack.recenttracks.track[0].date.uts * 1000)} ago.` : "Now scrobbling.",
      cover: coverURL,
    };

    return data;
  } catch (error) {
    console.error("Failed to fetch current scrobble for track: " + lastTrackName + " by artist: " + lastArtist, error);
    return null;
  }
}

function cleanupAndRestart() {
  if (rp) {
    rp.clearActivity().then(() => {
      rp.destroy();
      rp = null;
      currentClient = null;
      console.log("RPC connection closed.");
      setTimeout(main, extendedReconnectDelay);
    }).catch(error => {
      console.error("Error clearing activity:", error);
      rp = null;
      currentClient = null;
      setTimeout(main, extendedReconnectDelay);
    });
  } else {
    setTimeout(main, extendedReconnectDelay);
  }
}

function main() {
  createClient();
  setTimeout(() => {
    console.log("Restarting internal logic...");
    cleanupAndRestart();
  }, restartInterval);
}

main();