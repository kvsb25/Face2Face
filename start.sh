#!/bin/bash

set -e

npm run rooms &
echo "Starting roomManager"
npm run wss &
echo "Starting wss"
npm run https &
echo "Starting https"

wait -n
exit 1