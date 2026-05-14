#!/bin/bash
export PATH="/Users/malin/.nvm/versions/node/v24.11.0/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/Users/malin"

cd /Users/malin/repo-bloomer/terminal-bridge
exec npx tsx src/server/index.ts
