#node main.js > /dev/null 2>&1 &
git pull
node_modules/.bin/pm2 start main.js
