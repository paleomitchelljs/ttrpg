#!/bin/bash
# Double-click in Finder to launch the Dragon Maze zone editor: starts the dev
# server and opens the editor in your browser. Close this Terminal window (or
# Ctrl-C) to stop the server.
cd "$(dirname "$0")" || exit 1
npm run editor
