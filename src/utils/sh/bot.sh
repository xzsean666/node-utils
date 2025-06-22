#!/bin/bash

# Check if command is provided
if [ $# -eq 0 ]; then
    echo "Error: Please provide command parameters"
    echo "Usage: ./bot.sh <command>"
    echo "Example: ./bot.sh 'main/src/index.js --type day --param1 value1'"
    exit 1
fi

COMMAND="$*"  # Get all parameters as one string

# Create lock file name based on command (replace spaces and special chars with underscores)
LOCK_FILE="/tmp/bot_lock_$(echo "$COMMAND" | sed 's/[^a-zA-Z0-9]/_/g').lock"
LOG_FILE="/app/logs/$COMMAND.log"

# Function to cleanup lock file
cleanup() {
    rm -f "$LOCK_FILE"
    echo "$(date): $COMMAND 脚本清理锁文件" >> $LOG_FILE
}

# Set trap to cleanup on script exit or interruption
trap cleanup EXIT INT TERM

# Check if script is already running
if [ -f "$LOCK_FILE" ]; then
    echo "$(date): $COMMAND 脚本正在执行中，跳过本次执行" >> $LOG_FILE
    echo "脚本正在执行中，跳过本次执行"
    exit 0
fi

# Create lock file with current PID
echo $$ > "$LOCK_FILE"

echo "$(date): 开始执行 $COMMAND 脚本" >> $LOG_FILE

YARN_PATH="/usr/local/bin/yarn"
NODE_PATH="/usr/local/bin/node"

$NODE_PATH $COMMAND >> $LOG_FILE 2>&1
EXIT_CODE=$?

echo "$(date): $COMMAND 脚本执行完成，退出码: $EXIT_CODE" >> $LOG_FILE

# Exit with the same code as the Node.js process
exit $EXIT_CODE