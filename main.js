const rpc = require("discord-rpc");
const fetch = require("request-promise");
const prettyMilliseconds = require("pretty-ms");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("config.json"));

const updateInterval = 5000;
const retryInterval = 30000;

let rp;

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
  rp = new rpc.Client({ transport: "ipc" });

  rp.on("ready", () => {
    console.log("Connected to Discord!");
    updateStatus();
  });

  rp.on("disconnected", () => {
    console.log("Disconnected from Discord!");
    rp = null;
    setTimeout(createClient, retryInterval);
  });

  rp.login({ clientId: config.clientId }).catch((error) => {
    console.error("Error connecting to Discord:", error);
    rp = null;
    setTimeout(createClient, retryInterval);
  });
}

createClient();

async function updateStatus() {
  try {
    const data = await fetchCurrentScrobble(config.username);
    if (!data || !rp) {
      console.log("Reconnecting to Discord...");
      setTimeout(updateStatus, retryInterval);
      return;
    }

    await rp.setActivity({
      largeImageKey: data.album !== "Unknown Album" ? data.cover : "default_cover",
      largeImageText: `${data.playcount} plays.`,
      smallImageKey: data.whenScrobbled ? "playing" : "stopped",
      smallImageText: data.scrobbleStatus,
      details: data.trackName,
      state: `${data.artist} - ${data.album}`,
      buttons: [
        {
          label: `${formatNumber(data.scrobbles)} total shits.`,
          url: "javascript:void(0);",
        },
      ],
    });

    console.log("Discord status updated.");
    setTimeout(updateStatus, updateInterval);
  } catch (error) {
    console.error("Failed to update status:", error);
    rp = null;
    setTimeout(updateStatus, retryInterval);
  }
}

async function fetchCurrentScrobble(user) {
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

    let lastArtist = lastTrack.recenttracks.track[0].artist["#text"];
    let lastTrackName = lastTrack.recenttracks.track[0].name;

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

    let images = lastTrack.recenttracks.track[0].image;
    let coverURL = images && images[images.length - 1]["#text"].trim() ? images[images.length - 1]["#text"].trim() : "default_cover";

    const data = {
      artist: lastArtist,
      album: lastTrack.recenttracks.track[0].album["#text"] || "Unknown Album",
      trackName: lastTrackName,
      playcount: rData.track.userplaycount ? rData.track.userplaycount : "0",
      scrobbles: lastTrack.recenttracks["@attr"].total,
      whenScrobbled: lastTrack.recenttracks.track[0]["@attr"],
      scrobbleStatus: !lastTrack.recenttracks.track[0]["@attr"] ? `Last scrobbled ${prettyMilliseconds(Date.now() - lastTrack.recenttracks.track[0].date.uts * 1000)} ago.` : "Now scrobbling.",
      cover: coverURL,
    };

    return data;
  } catch (error) {
    console.error("Failed to fetch current scrobble:", error);
    return null;
  }
}

