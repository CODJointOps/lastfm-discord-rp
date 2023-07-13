# lastfm-discord-rp

A nodejs script to show your current listening status on [lastfm](https://last.fm).

## Installation

Open the console in which you downloaded the program in
type ```npm i``` to install necessary necessary.

## Running

Open the scripts folder and run either start.bat or start.sh depending on OS.

## FAQ

### How do I run this with pc startup?

On windows to do this, simply go into the scripts folder and
right click "start.bat" and select "Create Shortcut".
Then press "Windows key + R", in the run box type "shell:startup".
After that simply copy the shortcut of the bat file to that folder.

For linux, go to ~/.config/autostart and create a new file called "lastfm.desktop"
In this file put the following

```
[Desktop Entry]
Type=Application
Exec=bash -c "cd ~/Desktop/lastfm && ./start"
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Name[en_US]=LastFM
Name=LastFM
Comment[en_US]=Start LastFM
Comment=Start LastFM
```

## License

Copyright (C) 2023 Deadzone.lol


Licensed under the Apache License, Version 2.0 (the "License").
You may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
