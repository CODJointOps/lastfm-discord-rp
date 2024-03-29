# lastfm-discord-rp

A nodejs script to show your current listening status on [lastfm](https://last.fm).

## Installation

Open the folder you wish to install to and start a terminal or cmd in that folder.
Type ```git clone https://git.deadzone.lol/Wizzard/lastfm-discord-rp```.

Open the console in which you downloaded the program in and
type ```npm i``` to install necessary necessary.

## Running

Rename "config.example.json" to "config.json and fill it out with the correct information.
After that, open the scripts folder and run either start.bat or start.sh depending on OS.

## FAQ


### How do I run this with pc startup?

#### FOR WINDOWS

Simply go into the scripts folder and
right click "start.bat" and select "Create Shortcut".
Then press "Windows key + R", in the run box type "shell:startup".
After that simply copy the shortcut of the bat file to that folder.

#### FOR LINUX

Go to ~/.config/autostart and create a new file called "lastfm.desktop"
In this file put the following

```
[Desktop Entry]
Type=Application
Exec=bash -c "cd ~/Desktop/lastfm/scripts && ./start.sh"
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Name[en_US]=LastFM
Name=LastFM
Comment[en_US]=Start LastFM
Comment=Start LastFM
```
Make sure to replace the line ```Exec=bash -c "cd ~/Desktop/lastfm/scripts && ./start.sh"``` with your correct information.

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
