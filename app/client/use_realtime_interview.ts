import { useEffect, useState } from "react";
import type { SessionView } from "../shared/api";
import {
  RealtimeInterviewController,
  type RealtimeInterviewState
} from "./realtime";

interface UseRealtimeInterviewOptions {
  enabled: boolean;
  sessionVersion: number;
  onSessionView: (view: SessionView) => void;
}

export function useRealtimeInterview(options: UseRealtimeInterviewOptions) {
  const [state, setState] = useState<RealtimeInterviewState>("idle");
  const [assistantText, setAssistantText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [controller] = useState(() => {
    if (typeof document === "undefined") return null;
    return new RealtimeInterviewController({
      sessionVersion: options.sessionVersion,
      onStateChange: setState,
      onAssistantText: setAssistantText,
      onSessionView: options.onSessionView,
      onError: setError
    });
  });

  useEffect(() => {
    controller?.updateSessionVersion(options.sessionVersion);
  }, [controller, options.sessionVersion]);

  useEffect(() => {
    if (!options.enabled) controller?.stop();
  }, [controller, options.enabled]);

  useEffect(() => () => controller?.stop(), [controller]);

  return {
    state,
    assistantText,
    error,
    supported: options.enabled && RealtimeInterviewController.isSupported(),
    start: () => controller?.start() ?? Promise.resolve(),
    stop: () => controller?.stop()
  };
}
