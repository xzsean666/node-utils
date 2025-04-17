#!/bin/bash

# Check if action is provided
if [ $# -lt 1 ]; then
    echo "Error: Please provide a command (start/stop/restart) and parameters"
    echo "Usage: ./bot.sh <start|stop|restart> <command>"
    echo "Example: ./bot.sh start 'main/src/index.js --type day --param1 value1'"
    exit 1
fi

ACTION=$1
shift  # Remove the first argument and keep the rest as COMMAND

# Ensure command is provided for start action
if [ "$ACTION" == "start" ] && [ $# -eq 0 ]; then
    echo "Error: Please provide command parameters for start"
    echo "Usage: ./bot.sh start <command>"
    exit 1
fi

COMMAND="$*"  # Get all remaining parameters as one string

# Ensure the logs directory exists
LOG_DIR="./logs"
if [ ! -d "$LOG_DIR" ]; then
    mkdir -p "$LOG_DIR"
fi

# Create a safe log file name by replacing spaces and special characters
SAFE_COMMAND=$(echo "$COMMAND" | tr -c '[:alnum:]' '_')
BACKUP_DATE=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="$LOG_DIR/${SAFE_COMMAND}_${BACKUP_DATE}.log"

echo "$(date): 开始执行 $COMMAND 脚本" >> $LOG_FILE

YARN_PATH="/usr/local/bin/yarn"
NODE_PATH="/usr/local/bin/node"

# Function to perform keeper operations
function keeper_operations() {
    echo "$(date): 执行 keeper 操作" >> $LOG_FILE
    # Add your keeper logic here
    # For example, check system status, clean up old logs, etc.
}

# Function to monitor and restart the process if it stops
function monitor_process() {
    while true; do
        if ! ps -p $1 > /dev/null; then
            echo "$(date): 检测到应用停止运行，正在重新启动..." >> $LOG_FILE
            nohup $NODE_PATH $COMMAND >> $LOG_FILE 2>&1 &
            NEW_PID=$!
            if [ -z "$NEW_PID" ]; then
                echo "$(date): 重新启动失败" >> $LOG_FILE
            else
                echo $NEW_PID > app.pid
                echo "$(date): 应用已重新启动，新的进程ID为 $NEW_PID" >> $LOG_FILE
            fi
        fi
        sleep 10
    done
}

# Start the application
function start_application() {
    keeper_operations

    # Clean up old PID files
    if [ -f app.pid ]; then
        rm app.pid
    fi
    if [ -f keeper.pid ]; then
        rm keeper.pid
    fi

    # Start the process and monitor it
    nohup $NODE_PATH $COMMAND >> $LOG_FILE 2>&1 &
    PID=$!
    if [ -z "$PID" ]; then
        echo "$(date): 启动失败" >> $LOG_FILE
        exit 1
    else
        echo $PID > app.pid
        echo "$(date): 应用已启动，进程ID为 $PID" >> $LOG_FILE
    fi

    # Start the monitor in the background and record its PID
    nohup bash -c "$(declare -f monitor_process); monitor_process $PID" >> $LOG_FILE 2>&1 &
    KEEPER_PID=$!
    echo $KEEPER_PID > keeper.pid
    echo "$(date): 监控进程已启动，进程ID为 $KEEPER_PID" >> $LOG_FILE

    echo "$(date): $COMMAND 脚本执行完成" >> $LOG_FILE
}

# Stop the application
function stop_application() {
    if [ -f keeper.pid ]; then
        KEEPER_PID=$(cat keeper.pid)
        echo "Terminating monitor process with PID: $KEEPER_PID"
        kill $KEEPER_PID
        if [ $? -eq 0 ]; then
            echo "$(date): 监控进程已成功终止" >> $LOG_FILE
            rm keeper.pid
        else
            echo "$(date): 无法终止监控进程" >> $LOG_FILE
        fi
    else
        echo "No running monitor process found."
    fi

    # Wait for a short period to ensure the monitor process is fully stopped
    sleep 2

    if [ -f app.pid ]; then
        PID=$(cat app.pid)
        echo "Terminating application process with PID: $PID"
        kill $PID
        sleep 1  # Wait a moment to check if the process is still running
        if ps -p $PID > /dev/null; then
            echo "Process $PID did not terminate, forcing kill"
            kill -9 $PID
        fi
        if [ $? -eq 0 ]; then
            echo "$(date): 应用进程已成功终止" >> $LOG_FILE
            rm app.pid
        else
            echo "$(date): 无法终止应用进程" >> $LOG_FILE
        fi
    else
        echo "No running application process found."
    fi
}

# Restart the application and its keeper
function restart_application() {
    stop_application
    sleep 5
    start_application
}

# Main logic
case $ACTION in
    start)
        start_application
        ;;
    stop)
        stop_application
        ;;
    restart)
        restart_application
        ;;
    *)
        echo "Invalid action. Use 'start', 'stop', or 'restart'."
        exit 1
        ;;
esac