#!/bin/bash

# Check if command is provided
if [ $# -eq 0 ]; then
    echo "Error: Please provide command parameters"
    echo "Usage: ./bot.sh <command>"
    echo "Example: ./bot.sh 'main/src/index.js --type day --param1 value1'"
    exit 1
fi

COMMAND="$*"  # Get all parameters as one string


LOG_FILE="/app/logs/$COMMAND.log"

echo "$(date): 开始执行 $COMMAND 脚本" >> $LOG_FILE

cd /app/common/rpc-monitor-service

YARN_PATH="/usr/local/bin/yarn"
NODE_PATH="/usr/local/bin/node"

$NODE_PATH $COMMAND >> $LOG_FILE 2>&1

echo "$(date): $COMMAND 脚本执行完成" >> $LOG_FILE