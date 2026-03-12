import { useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { Message, Task } from "@/types";

interface UseWebSocketProps {
  onTaskUpdate?: (task: Task) => void;
  onNewMessage?: (message: Message) => void;
  onTaskCreated?: (task: Task) => void;
  onTaskDeleted?: (taskId: string) => void;
}

export function useWebSocket({
  onTaskUpdate,
  onNewMessage,
  onTaskCreated,
  onTaskDeleted,
}: UseWebSocketProps = {}) {
  const socketRef = useRef<Socket | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const handlersRef = useRef<UseWebSocketProps>({});

  useEffect(() => {
    handlersRef.current = {
      onTaskUpdate,
      onNewMessage,
      onTaskCreated,
      onTaskDeleted,
    };
  }, [onTaskUpdate, onNewMessage, onTaskCreated, onTaskDeleted]);

  const connect = useCallback(() => {
    if (socketRef.current) {
      return socketRef.current;
    }

    const socket = io({
      path: "/api/proxy/tasks",
      transports: ["polling", "websocket"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    socket.on("connect", () => {
      console.log("Connected to WebSocket server");
    });

    socket.on("disconnect", (reason) => {
      console.log("Disconnected from WebSocket server", reason);
    });

    socket.on("connect_error", (error) => {
      console.error("WebSocket connection error:", error.message);
    });

    socket.on("task_updated", (task: Task) => {
      console.log("Task updated:", task);
      handlersRef.current.onTaskUpdate?.(task);
    });

    socket.on("new_message", (message: Message) => {
      console.log("New message:", message);
      handlersRef.current.onNewMessage?.(message);
    });

    socket.on("task_created", (task: Task) => {
      console.log("Task created:", task);
      handlersRef.current.onTaskCreated?.(task);
    });

    socket.on("task_deleted", (taskId: string) => {
      console.log("Task deleted:", taskId);
      handlersRef.current.onTaskDeleted?.(taskId);
    });

    socketRef.current = socket;
    return socket;
  }, []);

  const joinTask = useCallback(
    (taskId: string) => {
      const socket = socketRef.current || connect();
      if (currentTaskIdRef.current) {
        socket.emit("leave_task", currentTaskIdRef.current);
      }
      socket.emit("join_task", taskId);
      currentTaskIdRef.current = taskId;
      console.log(`Joined task room: ${taskId}`);
    },
    [connect],
  );

  const leaveTask = useCallback(() => {
    const socket = socketRef.current;
    if (socket && currentTaskIdRef.current) {
      socket.emit("leave_task", currentTaskIdRef.current);
      console.log(`Left task room: ${currentTaskIdRef.current}`);
      currentTaskIdRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
      currentTaskIdRef.current = null;
    }
  }, []);

  // Initialize connection on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    socket: socketRef.current,
    joinTask,
    leaveTask,
    disconnect,
    isConnected: socketRef.current?.connected || false,
  };
}
