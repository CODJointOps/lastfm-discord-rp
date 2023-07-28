const rpc = require("discord-rpc");
const fetch = require("request-promise");
const prettyMilliseconds = require("pretty-ms");
const fs = require("fs");

const config = JSON.parse(fs.readFileSync("config.json"));

const updateInterval = 5000;
const retryInterval = 30000;
const maxUptime = 6 * 60 * 60 * 1000; // Maximum uptime before restart (6 hours)

let rp;
let startTime = Date.now();

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
      largeImageKey: data.album !== data.trackName ? data.cover : "default_cover",
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

    // check if uptime exceeds maximum uptime
    if ((Date.now() - startTime) > maxUptime) {
      console.log("Max uptime reached, restarting process...");
      process.exit(0);
    }

    setTimeout(updateStatus, updateInterval);
  } catch (error) {
    console.error("Failed to update status:", error);
    rp = null;
    setTimeout(updateStatus, retryInterval);
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
    if (!albumName) {
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

